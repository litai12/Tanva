import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AIProviderFactory } from '../ai/ai-provider.factory';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import {
  AgentEventType,
  AgentIntent,
  AgentPlanStep,
  AgentResearchResult,
  AgentResearchSource,
  AgentResearchTextResult,
  AgentRunEvent,
  AgentRunRecord,
  AgentRunSummary,
  AgentToolName,
} from './agent.types';
import { VolcResearchSearchService, VolcResearchSearchPayload } from './volc-research-search.service';
import { XiaotAgentService } from './xiaot-agent.service';
import {
  assessXiaotPromptSafety,
  XIAOT_SAFETY_REFUSAL,
} from './xiaot-safety-policy';

type AgentEventSubscriber = (event: AgentRunEvent) => void;

type IntentDecision = {
  intent: AgentIntent;
  selectedTool: AgentToolName;
  workflow: string;
  shouldEnableWebSearch: boolean;
  steps: AgentPlanStep[];
};

type ResearchTextDraft = {
  text: string;
  keywords: string[];
  model?: string;
  providerName?: string | null;
  keywordExtractionMode?: ResearchKeywordExtractionMode;
  keywordExtractionSource?: ResearchKeywordExtractionSource;
  fallback?: boolean;
  webSearchResult?: unknown;
  metadata?: Record<string, unknown>;
};

type ResearchKeywordExtractionMode = 'hybrid' | 'ai' | 'rule';
type ResearchKeywordExtractionSource = 'hybrid' | 'ai' | 'rule' | 'rule_fallback' | 'prompt_fallback';

const RUN_TTL_MS = 60 * 60 * 1000;
const PROVIDER_DEFAULT_TEXT_MODELS: Record<string, string> = {
  gemini: 'gpt-5.6',
  'gemini-pro': 'gpt-5.6',
  banana: 'gpt-5.6',
  'banana-2.5': 'gpt-5.6',
  'banana-3.1': 'gpt-5.6',
  runninghub: 'gpt-5.6',
  midjourney: 'gpt-5.6',
  nano2: 'gpt-5.6',
  seedream5: 'gpt-5.6',
};

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);
  private readonly runs = new Map<string, AgentRunRecord>();
  private readonly subscribers = new Map<string, Set<AgentEventSubscriber>>();

  constructor(
    private readonly volcResearchSearch: VolcResearchSearchService,
    private readonly providerFactory: AIProviderFactory,
    private readonly config: ConfigService,
    private readonly xiaotAgent: XiaotAgentService,
  ) {}

  createRun(
    dto: CreateAgentRunDto,
    userId: string,
    teamId?: string,
  ): AgentRunSummary {
    this.cleanupExpiredRuns();

    // 普通 Auto/Research Agent 与小T共用同一站点边界。这里在意图选择、联网搜索、
    // 模型调用和画布执行之前终止，保证关闭小T也不能绕过。
    const safetyCategory = assessXiaotPromptSafety(dto.prompt);
    if (safetyCategory) {
      const now = new Date();
      const run: AgentRunRecord = {
        id: randomUUID(),
        userId,
        prompt: dto.prompt,
        status: 'queued',
        intent: 'text_chat',
        selectedTool: 'chatResponse',
        workflow: 'content_safety_refusal',
        createdAt: now,
        updatedAt: now,
        events: [],
      };
      this.runs.set(run.id, run);
      setTimeout(() => {
        run.status = 'running';
        this.emit(run, 'assistant_delta', {
          data: { delta: XIAOT_SAFETY_REFUSAL },
        });
        this.emit(run, 'final', {
          message: XIAOT_SAFETY_REFUSAL,
          data: { text: XIAOT_SAFETY_REFUSAL },
        });
        this.emit(run, 'done', {});
        run.status = 'completed';
        run.completedAt = new Date();
        run.updatedAt = new Date();
      }, 0);
      return this.toSummary(run);
    }

    // canvasAgent 模式：绕过本地 intent/plan 流程，直接经 new-api 流式调用小T。
    if (dto.mode === 'canvasAgent') {
      const now = new Date();
      const run: AgentRunRecord = {
        id: randomUUID(),
        userId,
        prompt: dto.prompt,
        status: 'queued',
        intent: 'text_chat',
        selectedTool: 'chatResponse',
        workflow: 'canvas_agent',
        createdAt: now,
        updatedAt: now,
        events: [],
      };
      this.runs.set(run.id, run);
      setTimeout(() => {
        run.status = 'running';
        run.updatedAt = new Date();
        this.xiaotAgent
          .run(dto, userId, (type, payload) => this.emit(run, type, payload), teamId)
          .then(() => {
            run.status = 'completed';
            run.completedAt = new Date();
            run.updatedAt = new Date();
          })
          .catch((error: unknown) => {
            run.status = 'failed';
            run.updatedAt = new Date();
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(`Xiaot canvasAgent run failed: ${run.id} ${message}`);
            this.emit(run, 'error', { title: '小T执行失败', message });
            this.emit(run, 'done', { title: '完成', message: 'Agent trace failed.' });
          });
      }, 0);
      return this.toSummary(run);
    }

    const decision = this.withOutputCountAwareness(
      dto,
      this.withContextAwareness(dto, this.decideIntent(dto)),
    );
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

      if (decision.intent !== 'research_cases') {
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
      }

      await this.pause(80);
      this.emit(run, 'tool_selected', {
        title: '选择执行工具',
        message: `建议调用 ${decision.selectedTool}。`,
        data: {
          selectedTool: decision.selectedTool,
          parameters: {
            prompt: dto.prompt,
            outputImageCount: this.getRequestedOutputImageCount(dto) ?? undefined,
          },
          workflow: decision.workflow,
          intent: decision.intent,
          suggestedWebSearch: decision.shouldEnableWebSearch,
        },
      });

      if (decision.intent === 'research_cases') {
        await this.pause(80);
        this.emit(run, 'step_started', {
          title: '生成文字回复',
          message: '正在通过联网回答用户问题。',
          data: { stepId: 'text-draft', tool: 'chatResponse' },
        });
        const draft = await this.buildResearchTextDraft(dto);
        this.emit(run, 'research_text', {
          title: '生成文字回复',
          message: '已先生成联网文字回答，准备从文字结果提取案例关键词。',
          data: {
            text: draft.text,
            keywords: draft.keywords,
            model: draft.model,
            providerName: draft.providerName,
            keywordExtractionMode: draft.keywordExtractionMode,
            keywordExtractionSource: draft.keywordExtractionSource,
            fallback: draft.fallback,
            webSearchResult: draft.webSearchResult,
            metadata: draft.metadata,
          },
        });
        this.emit(run, 'step_completed', {
          title: '生成文字回复',
          message: draft.fallback
            ? '联网文字回答未返回稳定结果，后续仅保留真实检索或无结果摘要。'
            : '已得到联网文字回答，准备从中提取项目关键词。',
          data: { stepId: 'text-draft', tool: 'chatResponse', fallback: draft.fallback },
        });

        this.emit(run, 'step_started', {
          title: '提取案例关键词',
          message: '正在读取文字回复中的项目名、建筑师和英文名。',
          data: { stepId: 'extract-keywords', tool: 'sourceRank' },
        });
        this.emit(run, 'step_completed', {
          title: '提取案例关键词',
          message:
            draft.keywords.length > 0
              ? `已提取 ${draft.keywords.length} 个候选检索关键词。`
              : '未提取到明确项目名，将继续用用户问题规划候选案例并检索。',
          data: {
            stepId: 'extract-keywords',
            tool: 'sourceRank',
            keywords: draft.keywords,
          },
        });

        await this.pause(80);
        this.emit(run, 'step_started', {
          title: '联网检索图文',
          message: '正在把候选关键词交给网页与图片搜索。',
          data: { stepId: 'web-image-search', tool: 'imageSearch' },
        });
        const researchResult = await this.buildResearchCases(dto.prompt, draft);
        this.emit(run, 'step_completed', {
          title: '联网检索图文',
          message:
            researchResult.cases.length > 0
              ? `已检索并整理出 ${researchResult.cases.length} 个可展示案例。`
              : researchResult.summary || '检索结束，但没有得到可展示案例。',
          data: {
            stepId: 'web-image-search',
            tool: 'imageSearch',
            searchStats: researchResult.searchStats,
          },
        });

        this.emit(run, 'step_started', {
          title: '组织图文案例卡',
          message: '正在把案例说明、来源链接和图片网格组合成结构化回答。',
          data: { stepId: 'compose', tool: 'chatResponse' },
        });
        this.emit(run, 'research_result', {
          title: '整理案例资料',
          message: `已准备 ${researchResult.cases.length} 个图文案例卡片。`,
          data: {
            text: researchResult.textResult,
            volc: researchResult.volcResult,
            result: researchResult,
          },
        });
        this.emit(run, 'step_completed', {
          title: '组织图文案例卡',
          message: '图文案例结果已写入当前回复。',
          data: {
            stepId: 'compose',
            tool: 'chatResponse',
            caseCount: researchResult.cases.length,
          },
        });
      }

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
            id: 'text-draft',
            title: '生成文字回复',
            detail: '先生成联网文字回答，拿到可展示文字结果。',
            tool: 'chatResponse',
          },
          {
            id: 'extract-keywords',
            title: '提取案例关键词',
            detail: '读取文字回复中的项目名、建筑师和英文名，形成检索关键词。',
            tool: 'sourceRank',
          },
          {
            id: 'web-image-search',
            title: '联网检索图文',
            detail: '把提取出的案例关键词交给网页与图片搜索，并保留可展示图片。',
            tool: 'imageSearch',
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

  private withContextAwareness(
    dto: CreateAgentRunDto,
    decision: IntentDecision,
  ): IntentDecision {
    const context = dto.context ?? {};
    const needsConversationContext = context.needsConversationContext === true;
    const sessionSummary =
      typeof context.sessionSummary === 'string' ? context.sessionSummary : '';
    const hasConversationPrompt =
      typeof context.conversationPrompt === 'string' &&
      context.conversationPrompt.trim().length > 0;

    if (!needsConversationContext && !hasConversationPrompt) {
      return decision;
    }

    const detail = needsConversationContext
      ? '检测到用户在引用前文，规划时会读取最近对话和操作上下文。'
      : '已读取当前会话摘要，用于判断是否需要历史或工具状态。';

    return {
      ...decision,
      steps: [
        {
          id: 'context',
          title: '读取会话上下文',
          detail: sessionSummary ? `${detail} ${sessionSummary}` : detail,
        },
        ...decision.steps,
      ],
    };
  }

  private withOutputCountAwareness(
    dto: CreateAgentRunDto,
    decision: IntentDecision,
  ): IntentDecision {
    const requestedOutputImageCount = this.getRequestedOutputImageCount(dto);
    if (
      !requestedOutputImageCount ||
      !['generate_image', 'edit_image', 'blend_images'].includes(decision.intent)
    ) {
      return decision;
    }

    return {
      ...decision,
      steps: decision.steps.map((step) =>
        step.id === 'execute'
          ? {
              ...step,
              detail:
                requestedOutputImageCount > 1
                  ? `按本次请求准备生成 ${requestedOutputImageCount} 张输出图像，后续交给现有${this.toolLabel(decision.selectedTool)}工具。`
                  : `按本次请求准备生成 1 张输出图像，后续交给现有${this.toolLabel(decision.selectedTool)}工具。`,
            }
          : step,
      ),
    };
  }

  private getRequestedOutputImageCount(dto: CreateAgentRunDto): number | null {
    const value = dto.context?.requestedOutputImageCount;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const normalized = Math.floor(value);
    if (normalized < 1) return null;
    return Math.min(normalized, 8);
  }

  private toolLabel(tool: AgentToolName): string {
    const labels: Record<AgentToolName, string> = {
      generateImage: '生图',
      editImage: '改图',
      blendImages: '融合',
      analyzeImage: '分析',
      chatResponse: '文本对话',
      generateVideo: '视频生成',
      generatePaperJS: '矢量生成',
    };
    return labels[tool] || tool;
  }

  private async buildResearchTextDraft(dto: CreateAgentRunDto): Promise<ResearchTextDraft> {
    const prompt = dto.prompt;
    const requestPrompt = this.resolveResearchTextPrompt(dto);
    const providerName = this.resolveResearchTextProviderName(dto.aiProvider);
    const model = this.resolveResearchTextModel(providerName, dto.model);
    try {
      const provider = this.providerFactory.getProvider(model, providerName || 'new-api');
      const result = await this.withTimeout(
        provider.generateText({
          model,
          enableWebSearch: true,
          prompt: requestPrompt,
          thinkingLevel: dto.thinkingLevel,
          providerOptions: dto.providerOptions,
        }),
        this.readIntConfig('AGENT_RESEARCH_TEXT_TIMEOUT_MS', 60_000, 5_000, 120_000),
        'newapi text research',
      );
      if (result.success && result.data?.text?.trim()) {
        const text = result.data.text.trim();
        const keywordExtraction = await this.extractResearchKeywordsWithMode({
          prompt,
          text,
          model,
          providerName,
          thinkingLevel: dto.thinkingLevel,
          providerOptions: dto.providerOptions,
        });
        return {
          text,
          keywords: keywordExtraction.keywords,
          model,
          providerName,
          keywordExtractionMode: keywordExtraction.mode,
          keywordExtractionSource: keywordExtraction.source,
          webSearchResult: result.data.webSearchResult,
          metadata: result.data.metadata,
        };
      }
      this.logger.warn(
        `Research text draft failed: ${result.error?.message || 'empty response'}`,
      );
    } catch (error) {
      this.logger.warn(
        `Research text draft failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      text: '联网文字回答未返回可用文本，后续仅保留真实检索结果或无结果摘要。',
      keywords: this.fallbackResearchQueriesFromPrompt(prompt),
      model,
      providerName,
      keywordExtractionMode: this.resolveResearchKeywordExtractionMode(),
      keywordExtractionSource: 'prompt_fallback',
      fallback: true,
    };
  }

  private resolveResearchTextPrompt(dto: CreateAgentRunDto): string {
    const contextPrompt = dto.context?.conversationPrompt;
    if (typeof contextPrompt === 'string' && contextPrompt.trim().length > 0) {
      return contextPrompt;
    }
    return dto.prompt;
  }

  private resolveResearchTextProviderName(aiProvider?: string): string | null {
    const providerName = aiProvider?.trim();
    return providerName && providerName !== 'gemini' ? providerName : null;
  }

  private resolveResearchTextModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) return model;
    if (providerName) {
      return PROVIDER_DEFAULT_TEXT_MODELS[providerName] || 'gpt-5.6';
    }
    return PROVIDER_DEFAULT_TEXT_MODELS.gemini;
  }

  private async extractResearchKeywordsWithMode(options: {
    prompt: string;
    text: string;
    model: string;
    providerName: string | null;
    thinkingLevel?: 'high' | 'low';
    providerOptions?: Record<string, any>;
  }): Promise<{
    keywords: string[];
    mode: ResearchKeywordExtractionMode;
    source: ResearchKeywordExtractionSource;
  }> {
    const ruleKeywords = this.extractResearchKeywordsFromText(options.text, options.prompt);
    const mode = this.resolveResearchKeywordExtractionMode();
    if (mode === 'rule') {
      return { keywords: ruleKeywords, mode, source: 'rule' };
    }

    const aiKeywords = await this.extractResearchKeywordsWithAi(options).catch((error) => {
      this.logger.warn(
        `AI research keyword extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    });

    if (mode === 'ai') {
      return aiKeywords.length > 0
        ? { keywords: aiKeywords, mode, source: 'ai' }
        : { keywords: ruleKeywords, mode, source: 'rule_fallback' };
    }

    const merged = this.dedupeTextItems([...aiKeywords, ...ruleKeywords]).slice(0, 8);
    return {
      keywords: merged.length > 0 ? merged : ruleKeywords,
      mode,
      source: aiKeywords.length > 0 ? 'hybrid' : 'rule_fallback',
    };
  }

  private resolveResearchKeywordExtractionMode(): ResearchKeywordExtractionMode {
    const raw = this.config
      .get<string>('AGENT_RESEARCH_KEYWORD_EXTRACT_MODE', 'hybrid')
      .trim()
      .toLowerCase();
    if (raw === 'ai' || raw === 'rule' || raw === 'hybrid') return raw;
    return 'hybrid';
  }

  private async extractResearchKeywordsWithAi(options: {
    prompt: string;
    text: string;
    model: string;
    providerName: string | null;
    thinkingLevel?: 'high' | 'low';
    providerOptions?: Record<string, any>;
  }): Promise<string[]> {
    const provider = this.providerFactory.getProvider(options.model, options.providerName || 'new-api');
    const result = await this.withTimeout(
      provider.generateText({
        model: options.model,
        enableWebSearch: false,
        prompt: this.buildResearchKeywordExtractionPrompt(options.prompt, options.text),
        thinkingLevel: options.thinkingLevel,
        providerOptions: options.providerOptions,
      }),
      this.readIntConfig('AGENT_RESEARCH_KEYWORD_EXTRACT_TIMEOUT_MS', 20_000, 3_000, 60_000),
      'ai research keyword extraction',
    );
    if (!result.success || !result.data?.text?.trim()) {
      throw new Error(result.error?.message || 'empty keyword extraction response');
    }
    return this.parseResearchKeywordExtraction(result.data.text);
  }

  private buildResearchKeywordExtractionPrompt(prompt: string, text: string): string {
    return [
      '你是联网检索关键词提取器。请同时阅读“用户原始问题”和“Text 模式回答”，提取后续用于真实网页/图片搜索的关键词。',
      '目标：让搜索引擎能找到回答中对应的文章、案例、项目、作品或核心主题。',
      '要求：',
      '1. 优先提取具体项目/作品/文章主题/地点/人物/机构等可直接搜索的关键词。',
      '2. 如果回答里有编号标题或 Markdown 标题，优先提取标题里的主名称；保留必要英文名，但去掉破折号后的解释语。',
      '3. 不要提取“设计亮点、案例解析、建筑大师、建成时间、所在地点、总结”等小节标签。',
      '4. 每个关键词 2 到 80 字，按重要性排序，最多 8 个。',
      '5. 只返回 JSON，不要解释。',
      '',
      'JSON 格式：{"keywords":["关键词1","关键词2"]}',
      '',
      `用户原始问题：${prompt}`,
      '',
      `Text 模式回答：${text.slice(0, 8000)}`,
    ].join('\n');
  }

  private parseResearchKeywordExtraction(text: string): string[] {
    const parsed = this.parseJsonObject(text);
    const rawKeywords = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.keywords)
        ? parsed.keywords
        : [];
    return this.dedupeTextItems(
      rawKeywords
        .map((item: unknown) => this.cleanResearchKeyword(String(item || '')))
        .filter((item: string) => item && !this.isGenericResearchKeywordLabel(item)),
    ).slice(0, 8);
  }

  private parseJsonObject(text: string): any {
    const trimmed = String(text || '').trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1]?.trim() || trimmed;
    try {
      return JSON.parse(candidate);
    } catch {}

    const objectStart = candidate.indexOf('{');
    const objectEnd = candidate.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
      } catch {}
    }

    const arrayStart = candidate.indexOf('[');
    const arrayEnd = candidate.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
      } catch {}
    }

    return null;
  }

  private extractResearchKeywordsFromText(text: string, prompt: string): string[] {
    const titleKeywords: string[] = [];
    const supplementalKeywords: string[] = [];
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
      const titleKeyword = this.extractResearchTitleKeyword(line);
      if (titleKeyword) {
        titleKeywords.push(titleKeyword);
        continue;
      }

      const boldMatches = Array.from(String(line || '').matchAll(/\*\*([^*]{2,100})\*\*/g));
      for (const match of boldMatches) {
        const candidate = this.cleanResearchKeyword(match[1]);
        if (!this.isGenericResearchKeywordLabel(candidate)) {
          supplementalKeywords.push(candidate);
        }
      }

      const numberedMatch = this.normalizeResearchKeywordLine(line).match(
        /^(?:[-*]\s*)?(?:\d+[.、)]|[一二三四五六七八九十]+[、.])\s*(.{2,100})/,
      );
      if (numberedMatch) {
        const candidate = this.cleanResearchKeyword(
          this.stripResearchTitleComment(numberedMatch[1]),
        );
        if (!this.isGenericResearchKeywordLabel(candidate)) {
          supplementalKeywords.push(candidate);
        }
      }
    }
    return this.dedupeTextItems([
      ...titleKeywords.map((item) => this.cleanResearchKeyword(item)),
      ...supplementalKeywords.map((item) => this.cleanResearchKeyword(item)),
    ]).slice(0, 8);
  }

  private extractResearchTitleKeyword(line: string): string | null {
    let value = this.normalizeResearchKeywordLine(line);
    if (!value) return null;

    const hasHeading = /^#{1,6}\s+/.test(value);
    value = value.replace(/^#{1,6}\s+/, '').trim();
    value = value.replace(/^[-*]\s+(?=(?:\*\*)?(?:\d+|[一二三四五六七八九十]+)[.、)]\s*)/, '');
    value = value.replace(/^(\*\*|__)\s*/, '').trim();

    const numberedMatch = value.match(
      /^(?:\d+|[一二三四五六七八九十]+)[.、)]\s*(.{2,140})/,
    );
    const hasNumber = Boolean(numberedMatch);
    if (!hasHeading && !hasNumber) return null;

    const rawCandidate = numberedMatch?.[1] ?? value;
    const hasTitleComment = /\s*(?:——|—|–|--)\s*|\s+-\s+/.test(rawCandidate);
    let candidate = this.stripResearchTitleComment(rawCandidate);
    candidate = this.cleanResearchKeyword(candidate);
    if (!candidate || this.isGenericResearchKeywordLabel(candidate)) return null;

    // Unnumbered markdown headings are accepted only when they look like case titles,
    // not generic sections such as "设计亮点" or "案例解析".
    if (
      !hasNumber &&
      !hasTitleComment &&
      !/[（(][^）)]{2,100}[）)]/.test(candidate) &&
      !/[A-Za-z]/.test(candidate)
    ) {
      return null;
    }
    return candidate;
  }

  private normalizeResearchKeywordLine(line: string): string {
    return String(line || '')
      .replace(/^\s*>+\s*/, '')
      .trim();
  }

  private stripResearchTitleComment(value: string): string {
    return String(value || '')
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .split(/\s*(?:——|—|–|--)\s*/)[0]
      .split(/\s+-\s+/)[0]
      .trim();
  }

  private cleanResearchKeyword(value: string): string {
    return this.stripResearchTitleComment(value)
      .replace(/^[\s\-*#\d.、)）]+/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^(候选案例|案例|项目|建筑案例)[：:\s]*/g, '')
      .trim()
      .slice(0, 100);
  }

  private isGenericResearchKeywordLabel(value: string): boolean {
    const cleaned = String(value || '').replace(/\s+/g, '').replace(/[：:]+$/g, '');
    if (!cleaned) return true;
    return /^(案例解析|设计亮点|大师启示|建筑大师|建成时间|所在地点|建筑风格|项目解析|来源|参考资料|总结|结论)$/.test(
      cleaned,
    );
  }

  private dedupeTextItems(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const cleaned = this.cleanResearchKeyword(value);
      if (!cleaned || cleaned.length < 2) continue;
      const key = cleaned.toLowerCase().replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(cleaned);
    }
    return result;
  }

  private fallbackResearchQueriesFromPrompt(prompt: string): string[] {
    const value = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!value) return [];

    const subjectMatch = value.match(
      /(?:帮我|请|给我|麻烦)?(?:找|搜索|检索|推荐|整理|列出)?\s*(?:[一二两三四五六七八九十\d]+\s*(?:个|组|则|篇)?)?\s*([^，。,.!?！？]{2,40}?)(?:的)?(?:案例|建筑案例|建筑作品|建筑项目|资料|参考)/i,
    );
    const subject = this.cleanResearchSubject(subjectMatch?.[1] || '');
    const queries = [
      subject ? `${subject} 建筑 案例` : '',
      subject ? `${subject} architecture case study` : '',
      value,
    ];
    if (/体育|运动|stadium|arena|sports/i.test(value)) {
      queries.push('体育建筑 案例 体育馆 体育场', 'sports architecture stadium arena case study');
    }
    return this.dedupeTextItems(queries).slice(0, 6);
  }

  private cleanResearchSubject(value: string): string {
    return this.cleanResearchKeyword(value)
      .replace(/^(帮我|请|给我|麻烦|找|搜索|检索|推荐|整理|列出|关于|一些|几个)+/g, '')
      .replace(/^[一二两三四五六七八九十\d]+\s*(个|组|则|篇)?/g, '')
      .replace(/^(优秀|经典|著名|知名|真实|参考)+/g, '')
      .replace(/的$/g, '')
      .trim();
  }

  private async buildResearchCases(
    prompt: string,
    draft?: ResearchTextDraft,
  ): Promise<AgentResearchResult> {
    const topic = '案例搜索';

    try {
      const search = await this.withTimeout(
        this.volcResearchSearch.searchArchitectureResearch(prompt, {
          seedKeywords: draft?.keywords ?? [],
          seedText: draft?.text,
        }),
        this.readIntConfig('AGENT_RESEARCH_SEARCH_TIMEOUT_MS', 45_000, 5_000, 120_000),
        'research search',
      );
      if (!search) {
        return this.buildUnavailableResearchResult(
          topic,
          '真实网页检索未启用或配置未生效，因此没有返回案例。请检查 VOLC_SEARCH_ENABLED 与 VOLC_SEARCH_* 配置。',
          'volc:disabled',
          undefined,
          [],
          draft,
        );
      }
      if (search.cases.length > 0) {
        return this.attachResearchTextAndVolc(
          this.buildSearchDerivedResearchResult(topic, search),
          draft,
          search,
        );
      }
      const searchedImageCount = Array.from(search.imagesByQuery.values()).reduce(
        (sum, images) => sum + images.length,
        0,
      );
      return this.buildUnavailableResearchResult(
        topic,
        search.sources.length > 0
          ? `已完成网页检索并参考 ${search.sources.length} 条结果，但没有抽取到符合当前问题约束的案例；因此不展示无关内置案例。`
          : '真实网页检索没有返回可用结果，因此不展示无关内置案例。',
        search.provider,
        {
          keywordCount: search.keywords.length,
          sourceCount: search.sources.length,
          imageCount: searchedImageCount,
        },
        search.sources,
        draft,
        search.keywords,
      );
    } catch (error) {
      this.logger.warn(
        `Volc research search failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.buildUnavailableResearchResult(
        topic,
        `真实网页检索失败：${error instanceof Error ? error.message : String(error)}。系统未使用无关内置案例兜底。`,
        'volc:error',
        undefined,
        [],
        draft,
      );
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private readIntConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = this.config.get<string>(key);
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  private buildUnavailableResearchResult(
    topic: string,
    summary: string,
    provider: string,
    stats?: { keywordCount: number; sourceCount: number; imageCount: number },
    sources: AgentResearchSource[] = [],
    draft?: ResearchTextDraft,
    volcKeywords?: string[],
  ): AgentResearchResult {
    const searchStats = {
      provider,
      keywordCount: stats?.keywordCount ?? 0,
      sourceCount: stats?.sourceCount ?? sources.length,
      imageCount: stats?.imageCount ?? 0,
      fallback: true,
    };
    return {
      title: topic,
      summary,
      draftText: draft?.text,
      seedKeywords: draft?.keywords,
      textResult: this.toResearchTextResult(draft),
      volcResult: {
        provider,
        keywords: volcKeywords ?? draft?.keywords ?? [],
        cases: [],
        sources,
        searchStats,
      },
      cases: [],
      sources,
      searchStats,
    };
  }

  private attachResearchTextAndVolc(
    result: AgentResearchResult,
    draft: ResearchTextDraft | undefined,
    search: VolcResearchSearchPayload,
  ): AgentResearchResult {
    const searchStats = result.searchStats ?? {
      provider: search.provider,
      keywordCount: search.keywords.length,
      sourceCount: search.sources.length,
      imageCount: result.cases.reduce(
        (sum, item) => sum + item.images.filter((image) => Boolean(image.imageUrl)).length,
        0,
      ),
    };
    return {
      ...result,
      draftText: draft?.text,
      seedKeywords: draft?.keywords,
      textResult: this.toResearchTextResult(draft),
      volcResult: {
        provider: search.provider,
        keywords: search.keywords,
        cases: result.cases,
        sources: result.sources,
        searchStats,
      },
      searchStats,
    };
  }

  private toResearchTextResult(
    draft: ResearchTextDraft | undefined,
  ): AgentResearchTextResult | undefined {
    if (!draft) return undefined;
    return {
      text: draft.text,
      keywords: draft.keywords,
      model: draft.model,
      providerName: draft.providerName,
      keywordExtractionMode: draft.keywordExtractionMode,
      keywordExtractionSource: draft.keywordExtractionSource,
      fallback: draft.fallback,
      webSearchResult: draft.webSearchResult,
      metadata: draft.metadata,
    };
  }

  private buildSearchDerivedResearchResult(
    topic: string,
    search: VolcResearchSearchPayload,
  ): AgentResearchResult {
    const sources = this.dedupeSources([
      ...search.sources,
      ...search.cases.flatMap((item) => item.sources),
    ]);
    const imageCount = search.cases.reduce(
      (sum, item) => sum + item.images.filter((image) => Boolean(image.imageUrl)).length,
      0,
    );

    return {
      title: topic,
      summary: `搜索 ${search.keywords.length} 个关键词，参考 ${search.sources.length} 篇资料。`,
      cases: search.cases,
      sources,
      searchStats: {
        provider: search.provider,
        keywordCount: search.keywords.length,
        sourceCount: search.sources.length,
        imageCount,
      },
    };
  }

  private dedupeSources(sources: AgentResearchSource[]): AgentResearchSource[] {
    const seen = new Set<string>();
    const result: AgentResearchSource[] = [];
    for (const source of sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      result.push(source);
      if (result.length >= 8) break;
    }
    return result;
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
