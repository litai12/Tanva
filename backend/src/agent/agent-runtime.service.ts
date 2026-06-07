import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import {
  AgentEventType,
  AgentIntent,
  AgentPlanStep,
  AgentRunEvent,
  AgentRunRecord,
  AgentRunSummary,
  AgentToolName,
} from './agent.types';

type AgentEventSubscriber = (event: AgentRunEvent) => void;

type IntentDecision = {
  intent: AgentIntent;
  selectedTool: AgentToolName;
  workflow: string;
  shouldEnableWebSearch: boolean;
  steps: AgentPlanStep[];
};

const RUN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);
  private readonly runs = new Map<string, AgentRunRecord>();
  private readonly subscribers = new Map<string, Set<AgentEventSubscriber>>();

  createRun(dto: CreateAgentRunDto, userId: string): AgentRunSummary {
    this.cleanupExpiredRuns();

    const decision = this.decideIntent(dto);
    const now = new Date();
    const run: AgentRunRecord = {
      id: randomUUID(),
      userId,
      prompt: dto.prompt,
      status: 'queued',
      intent: decision.intent,
      selectedTool: decision.selectedTool,
      workflow: decision.workflow,
      createdAt: now,
      updatedAt: now,
      events: [],
    };

    this.runs.set(run.id, run);
    setTimeout(() => {
      void this.executeRun(run.id, dto, decision);
    }, 0);

    return this.toSummary(run);
  }

  getRun(runId: string, userId: string): AgentRunSummary {
    return this.toSummary(this.assertOwnedRun(runId, userId));
  }

  getEvents(runId: string, userId: string): AgentRunEvent[] {
    return [...this.assertOwnedRun(runId, userId).events];
  }

  subscribe(
    runId: string,
    userId: string,
    subscriber: AgentEventSubscriber,
  ): () => void {
    this.assertOwnedRun(runId, userId);
    const set = this.subscribers.get(runId) ?? new Set<AgentEventSubscriber>();
    set.add(subscriber);
    this.subscribers.set(runId, set);
    return () => {
      const current = this.subscribers.get(runId);
      current?.delete(subscriber);
      if (current && current.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  private async executeRun(
    runId: string,
    dto: CreateAgentRunDto,
    decision: IntentDecision,
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    try {
      run.status = 'running';
      run.updatedAt = new Date();
      this.emit(run, 'run_started', {
        title: '开始任务规划',
        message: 'Agent Runtime 已接管本次请求，正在分析意图与工具链路。',
      });

      await this.pause(80);
      this.emit(run, 'step_started', {
        title: '理解需求',
        message: this.describeIntent(decision.intent, dto.prompt),
        data: { stepId: 'understand' },
      });

      await this.pause(120);
      this.emit(run, 'step_completed', {
        title: '理解需求',
        message: `识别为 ${decision.workflow} 工作流。`,
        data: { stepId: 'understand', intent: decision.intent },
      });

      await this.pause(80);
      this.emit(run, 'plan', {
        title: '生成执行计划',
        message: '已拆分为可展示的任务步骤。',
        data: { steps: decision.steps },
      });

      for (const step of decision.steps) {
        await this.pause(70);
        this.emit(run, 'step_started', {
          title: step.title,
          message: step.detail,
          data: { stepId: step.id, tool: step.tool },
        });
        await this.pause(110);
        this.emit(run, 'step_completed', {
          title: step.title,
          message: '已准备好进入下一步。',
          data: { stepId: step.id, tool: step.tool },
        });
      }

      await this.pause(80);
      this.emit(run, 'tool_selected', {
        title: '选择执行工具',
        message: `建议调用 ${decision.selectedTool}。`,
        data: {
          selectedTool: decision.selectedTool,
          parameters: { prompt: dto.prompt },
          workflow: decision.workflow,
          intent: decision.intent,
          suggestedWebSearch: decision.shouldEnableWebSearch,
        },
      });

      run.status = 'completed';
      run.completedAt = new Date();
      run.updatedAt = run.completedAt;
      this.emit(run, 'final', {
        title: '规划完成',
        message: '已生成可视化步骤轨迹，后续由现有 AI 工具链路执行实际任务。',
        data: {
          selectedTool: decision.selectedTool,
          workflow: decision.workflow,
          suggestedWebSearch: decision.shouldEnableWebSearch,
        },
      });
      this.emit(run, 'done', {
        title: '完成',
        message: 'Agent trace complete.',
      });
    } catch (error) {
      run.status = 'failed';
      run.updatedAt = new Date();
      this.logger.warn(`Agent run failed: ${runId} ${(error as Error).message}`);
      this.emit(run, 'error', {
        title: 'Agent 规划失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
      this.emit(run, 'done', { title: '完成', message: 'Agent trace failed.' });
    }
  }

  private emit(
    run: AgentRunRecord,
    type: AgentEventType,
    payload: Omit<AgentRunEvent, 'id' | 'runId' | 'seq' | 'type' | 'timestamp'>,
  ): AgentRunEvent {
    const event: AgentRunEvent = {
      id: randomUUID(),
      runId: run.id,
      seq: run.events.length + 1,
      type,
      timestamp: new Date().toISOString(),
      ...payload,
    };
    run.events.push(event);
    run.updatedAt = new Date();

    const subscribers = this.subscribers.get(run.id);
    if (subscribers) {
      for (const subscriber of subscribers) {
        try {
          subscriber(event);
        } catch {}
      }
    }
    return event;
  }

  private decideIntent(dto: CreateAgentRunDto): IntentDecision {
    const prompt = (dto.prompt || '').trim();
    const lower = prompt.toLowerCase();
    const available = new Set(dto.availableTools ?? []);
    const hasImages = Boolean(dto.hasImages || (dto.imageCount ?? 0) > 0);

    const hasAny = (words: string[]) =>
      words.some((word) => lower.includes(word.toLowerCase()) || prompt.includes(word));

    const pickTool = (preferred: AgentToolName, fallback: AgentToolName): AgentToolName =>
      available.size === 0 || available.has(preferred) ? preferred : fallback;

    if (
      hasAny(['案例', '参考', '资料', '找', '搜', 'research', 'case', 'precedent', '教堂', '建筑'])
    ) {
      return {
        intent: 'research_cases',
        selectedTool: pickTool('chatResponse', 'chatResponse'),
        workflow: 'research_cases',
        shouldEnableWebSearch: true,
        steps: [
          {
            id: 'query',
            title: '拆解检索方向',
            detail: '提取建筑类型、风格、地点、用途等关键词，准备中英文检索词。',
            tool: 'webSearch',
          },
          {
            id: 'collect',
            title: '收集网页与图片',
            detail: '优先查找官方/媒体/设计平台来源，并保留可展示图片。',
            tool: 'imageSearch',
          },
          {
            id: 'rank',
            title: '筛选可信来源',
            detail: '按相关性、信息完整度和图片质量筛选案例。',
            tool: 'sourceRank',
          },
          {
            id: 'compose',
            title: '组织图文案例卡',
            detail: '把案例说明、来源链接和图片网格组合成结构化回答。',
            tool: 'chatResponse',
          },
        ],
      };
    }

    if (hasAny(['视频', '动效', '动画', 'video', 'motion'])) {
      return {
        intent: 'generate_video',
        selectedTool: pickTool('generateVideo', 'chatResponse'),
        workflow: 'video_generation',
        shouldEnableWebSearch: Boolean(dto.enableWebSearch),
        steps: [
          { id: 'brief', title: '整理视频简报', detail: '明确镜头、主体、动作和时长。' },
          { id: 'route', title: '选择视频模型', detail: '按模式和参考图选择视频生成链路。' },
          { id: 'execute', title: '准备执行视频任务', detail: '后续交给现有视频生成工具。', tool: 'generateVideo' },
        ],
      };
    }

    if (hasImages && hasAny(['融合', '合成', 'blend', 'mix'])) {
      return {
        intent: 'blend_images',
        selectedTool: pickTool('blendImages', 'editImage'),
        workflow: 'image_blend',
        shouldEnableWebSearch: Boolean(dto.enableWebSearch),
        steps: [
          { id: 'inspect', title: '分析参考图关系', detail: '判断主体、风格和融合目标。' },
          { id: 'prompt', title: '整理融合提示词', detail: '保持关键元素并降低冲突。' },
          { id: 'execute', title: '准备融合图像', detail: '后续交给现有融合工具。', tool: 'blendImages' },
        ],
      };
    }

    if (hasImages && hasAny(['分析', '描述', '看看', '识别', '是什么', 'analyze', 'describe'])) {
      return {
        intent: 'analyze_image',
        selectedTool: pickTool('analyzeImage', 'chatResponse'),
        workflow: 'image_analysis',
        shouldEnableWebSearch: Boolean(dto.enableWebSearch),
        steps: [
          { id: 'inspect', title: '读取图像上下文', detail: '识别图片内容与用户问题。' },
          { id: 'answer', title: '准备图像分析', detail: '后续交给现有图像分析工具。', tool: 'analyzeImage' },
        ],
      };
    }

    if (hasImages) {
      return {
        intent: 'edit_image',
        selectedTool: pickTool('editImage', 'chatResponse'),
        workflow: 'image_edit',
        shouldEnableWebSearch: Boolean(dto.enableWebSearch),
        steps: [
          { id: 'understand_edit', title: '理解编辑目标', detail: '识别要修改的区域、风格和保留元素。' },
          { id: 'prompt', title: '整理编辑提示词', detail: '把自然语言转成更明确的图像编辑 brief。' },
          { id: 'execute', title: '准备编辑图像', detail: '后续交给现有图像编辑工具。', tool: 'editImage' },
        ],
      };
    }

    if (hasAny(['矢量', 'svg', 'vector', '图标', '线稿'])) {
      return {
        intent: 'vector_graphic',
        selectedTool: pickTool('generatePaperJS', 'chatResponse'),
        workflow: 'vector_graphic',
        shouldEnableWebSearch: Boolean(dto.enableWebSearch),
        steps: [
          { id: 'geometry', title: '拆解图形结构', detail: '把需求拆成可生成的几何元素。' },
          { id: 'execute', title: '准备生成矢量图形', detail: '后续交给 PaperJS/向量工具。', tool: 'generatePaperJS' },
        ],
      };
    }

    if (hasAny(['画', '生成', '创建', '设计', '出图', '做一张', 'generate', 'draw', 'create'])) {
      return {
        intent: 'generate_image',
        selectedTool: pickTool('generateImage', 'chatResponse'),
        workflow: 'image_generation',
        shouldEnableWebSearch: Boolean(dto.enableWebSearch),
        steps: [
          { id: 'visual_brief', title: '整理视觉简报', detail: '提取主体、构图、材质、光线、风格和用途。' },
          { id: 'prompt', title: '优化生图提示词', detail: '在执行前把模糊需求转成可生成的画面 brief。' },
          { id: 'route', title: '选择模型参数', detail: '沿用当前模型档位、比例和清晰度设置。' },
          { id: 'execute', title: '准备生成图像', detail: '后续交给现有生图工具。', tool: 'generateImage' },
        ],
      };
    }

    return {
      intent: 'text_chat',
      selectedTool: pickTool('chatResponse', 'chatResponse'),
      workflow: 'text_chat',
      shouldEnableWebSearch: Boolean(dto.enableWebSearch),
      steps: [
        { id: 'clarify', title: '理解问题', detail: '判断是否需要上下文、资料或工具调用。' },
        { id: 'answer', title: '准备文本回答', detail: '后续交给现有文本对话工具。', tool: 'chatResponse' },
      ],
    };
  }

  private describeIntent(intent: AgentIntent, prompt: string): string {
    const preview = prompt.length > 42 ? `${prompt.slice(0, 42)}...` : prompt;
    const labels: Record<AgentIntent, string> = {
      research_cases: '资料/案例研究',
      generate_image: '图像生成',
      edit_image: '图像编辑',
      blend_images: '图像融合',
      analyze_image: '图像分析',
      generate_video: '视频生成',
      text_chat: '文本对话',
      vector_graphic: '矢量图形',
    };
    return `正在把「${preview}」识别为${labels[intent]}任务。`;
  }

  private assertOwnedRun(runId: string, userId: string): AgentRunRecord {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundException('Agent run not found');
    if (run.userId !== userId) throw new ForbiddenException('Forbidden agent run');
    return run;
  }

  private toSummary(run: AgentRunRecord): AgentRunSummary {
    return {
      id: run.id,
      status: run.status,
      intent: run.intent,
      selectedTool: run.selectedTool,
      workflow: run.workflow,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      completedAt: run.completedAt?.toISOString(),
    };
  }

  private cleanupExpiredRuns(): void {
    const now = Date.now();
    for (const [id, run] of this.runs.entries()) {
      if (now - run.createdAt.getTime() > RUN_TTL_MS) {
        this.runs.delete(id);
        this.subscribers.delete(id);
      }
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
