import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import {
  AgentEventType,
  AgentIntent,
  AgentPlanStep,
  AgentResearchCase,
  AgentResearchImageCandidate,
  AgentResearchResult,
  AgentResearchSource,
  AgentRunEvent,
  AgentRunRecord,
  AgentRunSummary,
  AgentToolName,
} from './agent.types';
import { VolcResearchSearchService, VolcResearchSearchPayload } from './volc-research-search.service';

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

  constructor(private readonly volcResearchSearch: VolcResearchSearchService) {}

  createRun(dto: CreateAgentRunDto, userId: string): AgentRunSummary {
    this.cleanupExpiredRuns();

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
        const researchResult = await this.buildResearchCases(dto.prompt);
        this.emit(run, 'research_result', {
          title: '整理案例资料',
          message: `已准备 ${researchResult.cases.length} 个图文案例卡片。`,
          data: { result: researchResult },
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

  private async buildResearchCases(prompt: string): Promise<AgentResearchResult> {
    const isChurch = /教堂|礼拜堂|church|chapel|cathedral/i.test(prompt);
    const isSchool = /学校|校园|大学|学院|school|campus|university/i.test(prompt);
    const topic = isChurch ? '教堂建筑案例' : isSchool ? '学校建筑案例' : '建筑案例';

    try {
      const search = await this.volcResearchSearch.searchArchitectureResearch(prompt);
      if (!search) {
        return this.buildUnavailableResearchResult(
          topic,
          '真实网页检索未启用或配置未生效，因此没有返回案例。请检查 VOLC_SEARCH_ENABLED 与 VOLC_SEARCH_* 配置。',
          'volc:disabled',
        );
      }
      if (search.cases.length > 0) {
        return this.buildSearchDerivedResearchResult(topic, search);
      }
      const searchedImageCount = Array.from(search.imagesByQuery.values()).reduce(
        (sum, images) => sum + images.length,
        0,
      );
      return this.buildUnavailableResearchResult(
        topic,
        search.sources.length > 0
          ? `已完成网页检索并参考 ${search.sources.length} 条结果，但没有抽取到符合当前问题约束的建筑案例；因此不展示无关内置案例。`
          : '真实网页检索没有返回可用结果，因此不展示无关内置案例。',
        search.provider,
        {
          keywordCount: search.keywords.length,
          sourceCount: search.sources.length,
          imageCount: searchedImageCount,
        },
        search.sources,
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
      );
    }
  }

  private buildUnavailableResearchResult(
    topic: string,
    summary: string,
    provider: string,
    stats?: { keywordCount: number; sourceCount: number; imageCount: number },
    sources: AgentResearchSource[] = [],
  ): AgentResearchResult {
    return {
      title: topic,
      summary,
      cases: [],
      sources,
      searchStats: {
        provider,
        keywordCount: stats?.keywordCount ?? 0,
        sourceCount: stats?.sourceCount ?? sources.length,
        imageCount: stats?.imageCount ?? 0,
        fallback: true,
      },
    };
  }

  private buildChurchCases(): AgentResearchCase[] {
    return [
      {
        id: 'church-of-the-light',
        title: '光之教堂',
        subtitle: 'Church of the Light',
        architect: '安藤忠雄 Tadao Ando',
        location: '日本大阪府茨木市',
        category: '极简 / 清水混凝土 / 光影叙事',
        summary:
          '以十字形开口把自然光变成空间主体，平面与材料极度克制，适合研究“光如何成为建筑语言”。',
        highlights: ['十字光缝', '清水混凝土', '低成本但高精神性', '少即是多'],
        sources: this.sourcesFor('Church of the Light Tadao Ando'),
        images: this.imagesFor('Church of the Light Tadao Ando interior concrete cross light'),
      },
      {
        id: 'wuying-church',
        title: '成都无影教堂',
        subtitle: 'Wuying Church / Sino-Ocean Taikoo Li style reference',
        architect: '上海大椽建筑设计事务所等资料需二次核验',
        location: '中国四川成都',
        category: '轻结构 / 白色构件 / 花田景观',
        summary:
          '通过密集白色竖向构件和半透明边界营造“消隐”的宗教性，适合研究临时性、景观性和打卡传播。',
        highlights: ['白色铝板阵列', '半透明边界', '花田环境', '轻量化精神空间'],
        sources: this.sourcesFor('成都 无影教堂 建筑 案例'),
        images: this.imagesFor('成都 无影教堂 白色 教堂 花田 建筑'),
      },
      {
        id: 'bruder-klaus-field-chapel',
        title: '布鲁德克劳斯田野教堂',
        subtitle: 'Bruder Klaus Field Chapel',
        architect: '彼得·卒姆托 Peter Zumthor',
        location: '德国梅歇尔尼希',
        category: '材料实验 / 土地性 / 内向冥想',
        summary:
          '外部粗粝、内部由燃烧木模板形成洞穴般空间，适合研究材料、工艺和精神体验的统一。',
        highlights: ['夯筑混凝土', '火烧木模板', '洞穴式天光', '强烈触感'],
        sources: this.sourcesFor('Bruder Klaus Field Chapel Peter Zumthor'),
        images: this.imagesFor('Bruder Klaus Field Chapel Peter Zumthor interior oculus'),
      },
      {
        id: 'kamppi-chapel',
        title: '康比静默教堂',
        subtitle: 'Kamppi Chapel of Silence',
        architect: 'K2S Architects',
        location: '芬兰赫尔辛基',
        category: '城市公共空间 / 木结构 / 静默体验',
        summary:
          '在繁忙城市中心插入一枚温暖木质体量，适合研究公共性、安静边界和非传统宗教空间。',
        highlights: ['木质曲面', '城市客厅', '无窗静默空间', '公共服务属性'],
        sources: this.sourcesFor('Kamppi Chapel K2S Architects'),
        images: this.imagesFor('Kamppi Chapel of Silence K2S Architects wood interior'),
      },
      {
        id: 'ribbon-chapel',
        title: '丝带教堂',
        subtitle: 'Ribbon Chapel',
        architect: '中村拓志 Hiroshi Nakamura & NAP',
        location: '日本广岛县尾道市',
        category: '婚礼教堂 / 双螺旋 / 结构叙事',
        summary:
          '两条螺旋楼梯相互缠绕成为结构与仪式路线，适合研究建筑形式如何直接表达叙事。',
        highlights: ['双螺旋流线', '结构即造型', '海景场地', '仪式路径'],
        sources: this.sourcesFor('Ribbon Chapel Hiroshi Nakamura NAP'),
        images: this.imagesFor('Ribbon Chapel Hiroshi Nakamura NAP spiral chapel'),
      },
    ];
  }

  private buildArchitectureCases(): AgentResearchCase[] {
    return [
      {
        id: 'heydar-aliyev-center',
        title: '盖达尔·阿利耶夫中心',
        subtitle: 'Heydar Aliyev Center',
        architect: '扎哈·哈迪德 Zaha Hadid Architects',
        location: '阿塞拜疆巴库',
        category: '文化建筑 / 流线形态 / 参数化表皮',
        summary:
          '以连续曲面消解墙、屋顶与地面的边界，适合研究流动空间和地标级文化建筑表达。',
        highlights: ['连续曲面', '地景化建筑', '无缝表皮', '公共文化地标'],
        sources: this.sourcesFor('Heydar Aliyev Center Zaha Hadid'),
        images: this.imagesFor('Heydar Aliyev Center Zaha Hadid interior exterior'),
      },
      {
        id: 'sendai-mediatheque',
        title: '仙台媒体中心',
        subtitle: 'Sendai Mediatheque',
        architect: '伊东丰雄 Toyo Ito',
        location: '日本仙台',
        category: '公共文化 / 结构系统 / 透明盒子',
        summary:
          '用管状结构整合流线、结构和设备，适合研究开放平面与复合公共功能。',
        highlights: ['管状结构', '开放楼板', '透明立面', '媒体公共性'],
        sources: this.sourcesFor('Sendai Mediatheque Toyo Ito'),
        images: this.imagesFor('Sendai Mediatheque Toyo Ito tubes interior'),
      },
      {
        id: 'therme-vals',
        title: '瓦尔斯温泉浴场',
        subtitle: 'Therme Vals',
        architect: '彼得·卒姆托 Peter Zumthor',
        location: '瑞士瓦尔斯',
        category: '材料氛围 / 石材 / 身体体验',
        summary:
          '以石材、光线、水声和尺度组织沉浸体验，适合研究材料氛围与身体感知。',
        highlights: ['片麻岩石材', '浴场序列', '暗光氛围', '触觉体验'],
        sources: this.sourcesFor('Therme Vals Peter Zumthor'),
        images: this.imagesFor('Therme Vals Peter Zumthor stone bath interior'),
      },
      {
        id: 'vanna-venturi-house',
        title: '范娜·文丘里住宅',
        subtitle: 'Vanna Venturi House',
        architect: '罗伯特·文丘里 Robert Venturi',
        location: '美国宾夕法尼亚州',
        category: '后现代 / 住宅 / 符号批判',
        summary:
          '以矛盾和复杂性挑战现代主义纯粹性，适合研究住宅立面、符号和历史引用。',
        highlights: ['后现代开端', '复杂与矛盾', '山墙符号', '住宅尺度'],
        sources: this.sourcesFor('Vanna Venturi House Robert Venturi'),
        images: this.imagesFor('Vanna Venturi House Robert Venturi facade'),
      },
    ];
  }

  private buildSchoolCases(): AgentResearchCase[] {
    return [
      {
        id: 'bauhaus-dessau',
        title: '包豪斯德绍校舍',
        subtitle: 'Bauhaus Dessau',
        architect: '沃尔特·格罗皮乌斯 Walter Gropius',
        location: '德国德绍',
        category: '现代主义 / 功能分区 / 玻璃幕墙',
        summary:
          '以教学、工坊、宿舍等功能体块清晰组织校园，玻璃幕墙与钢结构奠定现代学校建筑的原型。',
        highlights: ['功能分区', '玻璃幕墙', '钢结构', '现代校园原型'],
        sources: this.sourcesFor('Bauhaus Dessau Walter Gropius school architecture'),
        images: this.imagesFor('Bauhaus Dessau Walter Gropius school architecture'),
      },
      {
        id: 'iit-campus',
        title: '伊利诺伊理工学院校园',
        subtitle: 'IIT Campus / S. R. Crown Hall',
        architect: '密斯·凡·德·罗 Ludwig Mies van der Rohe',
        location: '美国芝加哥',
        category: '少即是多 / 模数网格 / 钢玻体系',
        summary:
          '通过模数化钢结构和开放平面建立理性校园秩序，Crown Hall 成为建筑教育空间的经典范例。',
        highlights: ['模数网格', '开放平面', '钢玻体系', '极简秩序'],
        sources: this.sourcesFor('IIT campus Crown Hall Mies van der Rohe architecture school'),
        images: this.imagesFor('IIT campus Crown Hall Mies van der Rohe architecture school'),
      },
      {
        id: 'exeter-library',
        title: '菲利普斯埃克塞特学院图书馆',
        subtitle: 'Phillips Exeter Academy Library',
        architect: '路易斯·康 Louis Kahn',
        location: '美国新罕布什尔州埃克塞特',
        category: '教育建筑 / 中庭 / 砖石秩序',
        summary:
          '以中心中庭、环形书库和阅读格间组织学习体验，展现纪念性空间与日常校园生活的结合。',
        highlights: ['中心中庭', '砖石立面', '阅读格间', '纪念性空间'],
        sources: this.sourcesFor('Phillips Exeter Academy Library Louis Kahn school architecture'),
        images: this.imagesFor('Phillips Exeter Academy Library Louis Kahn school architecture'),
      },
    ];
  }

  private applyResearchSearch(
    fallback: AgentResearchResult,
    search: VolcResearchSearchPayload,
  ): AgentResearchResult {
    const cases = fallback.cases.map((item) => {
      const searchedImages = this.dedupeImageCandidates(
        this.caseImageSearchQueries(item).flatMap(
          (query) => search.imagesByQuery.get(query) ?? [],
        ),
      ).slice(0, 4);
      return {
        ...item,
        images: searchedImages.length > 0 ? searchedImages : item.images,
      };
    });
    const sources = this.dedupeSources([
      ...search.sources,
      ...cases.flatMap((item) => item.sources),
    ]);
    const imageCount = cases.reduce(
      (sum, item) => sum + item.images.filter((image) => Boolean(image.imageUrl)).length,
      0,
    );

    return {
      ...fallback,
      summary: `搜索 ${search.keywords.length} 个关键词，参考 ${search.sources.length} 篇资料。`,
      cases,
      sources,
      searchStats: {
        provider: search.provider,
        keywordCount: search.keywords.length,
        sourceCount: search.sources.length,
        imageCount,
      },
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

  private caseImageSearchQueries(item: AgentResearchCase): string[] {
    const base = [item.subtitle || item.title, item.architect, item.location, 'architecture']
      .filter(Boolean)
      .join(' ');
    const originalQueries = item.images
      .map((image) => image.query)
      .filter((query): query is string => typeof query === 'string' && query.trim().length > 0);
    const titleOnly = [item.subtitle || item.title, 'architecture'].filter(Boolean).join(' ');
    return Array.from(new Set([base, titleOnly, ...originalQueries].filter(Boolean))).slice(0, 3);
  }

  private dedupeImageCandidates(
    images: AgentResearchImageCandidate[],
  ): AgentResearchImageCandidate[] {
    const seen = new Set<string>();
    const result: AgentResearchImageCandidate[] = [];
    for (const image of images) {
      const key = image.imageUrl || image.sourceUrl || image.searchUrl || image.query;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(image);
    }
    return result;
  }

  private sourcesFor(query: string): AgentResearchSource[] {
    const encoded = encodeURIComponent(query);
    return [
      {
        title: 'ArchDaily 项目检索',
        url: `https://www.archdaily.com/search/projects?text=${encoded}`,
        snippet: '适合快速获取项目介绍、图纸、摄影和建筑师信息。',
      },
      {
        title: 'Google Scholar / Web 检索',
        url: `https://www.google.com/search?q=${encoded}`,
        snippet: '用于补充官网、媒体报道、论文或访谈资料。',
      },
    ];
  }

  private imagesFor(query: string): AgentResearchImageCandidate[] {
    const variants = ['exterior', 'interior', 'plan section', 'detail'];
    return variants.map((variant) => {
      const finalQuery = `${query} ${variant}`;
      return {
        label:
          variant === 'exterior'
            ? '外观'
            : variant === 'interior'
              ? '室内'
              : variant === 'plan section'
                ? '图纸'
                : '细部',
        query: finalQuery,
        searchUrl: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(finalQuery)}`,
      };
    });
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
