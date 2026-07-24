export type AgentIntent =
  | 'research_cases'
  | 'generate_image'
  | 'edit_image'
  | 'blend_images'
  | 'analyze_image'
  | 'generate_video'
  | 'text_chat'
  | 'vector_graphic';

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type AgentEventType =
  | 'run_started'
  | 'step_started'
  | 'step_completed'
  | 'plan'
  | 'tool_selected'
  | 'research_text'
  | 'research_result'
  | 'assistant_delta' // canvasAgent(小T)流式文本增量
  | 'flow_patch' // canvasAgent(小T)画布补丁指令
  | 'host_tool' // canvasAgent(小T)调用 Tanva 宿主保留能力
  | 'host_ui' // canvasAgent(小T)富格式卡片(协议v1.1, kind∈choices/suggestions/media)
  | 'final'
  | 'error'
  | 'done';

export type AgentToolName =
  | 'generateImage'
  | 'editImage'
  | 'blendImages'
  | 'analyzeImage'
  | 'chatResponse'
  | 'generateVideo'
  | 'generatePaperJS';

export interface AgentPlanStep {
  id: string;
  title: string;
  detail: string;
  tool?: AgentToolName | 'webSearch' | 'imageSearch' | 'sourceRank';
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  seq: number;
  type: AgentEventType;
  timestamp: string;
  title?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface AgentResearchSource {
  title: string;
  url: string;
  snippet?: string;
  sourceName?: string;
}

export interface AgentResearchImageCandidate {
  label: string;
  query: string;
  searchUrl: string;
  imageUrl?: string;
  sourceUrl?: string;
  sourceName?: string;
  width?: number;
  height?: number;
}

export interface AgentResearchCase {
  id: string;
  title: string;
  subtitle?: string;
  architect?: string;
  location?: string;
  category?: string;
  summary: string;
  highlights: string[];
  sources: AgentResearchSource[];
  images: AgentResearchImageCandidate[];
}

export interface AgentResearchTextResult {
  text: string;
  keywords: string[];
  model?: string;
  providerName?: string | null;
  keywordExtractionMode?: 'hybrid' | 'ai' | 'rule';
  keywordExtractionSource?: 'hybrid' | 'ai' | 'rule' | 'rule_fallback' | 'prompt_fallback';
  fallback?: boolean;
  webSearchResult?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentResearchVolcResult {
  provider: string;
  keywords: string[];
  cases: AgentResearchCase[];
  sources: AgentResearchSource[];
  searchStats?: {
    provider: string;
    keywordCount: number;
    sourceCount: number;
    imageCount: number;
    fallback?: boolean;
  };
}

export interface AgentResearchResult {
  title: string;
  summary: string;
  draftText?: string;
  seedKeywords?: string[];
  textResult?: AgentResearchTextResult;
  volcResult?: AgentResearchVolcResult;
  cases: AgentResearchCase[];
  sources: AgentResearchSource[];
  searchStats?: {
    provider: string;
    keywordCount: number;
    sourceCount: number;
    imageCount: number;
    fallback?: boolean;
  };
}

export interface AgentRunRecord {
  id: string;
  userId: string;
  prompt: string;
  status: AgentRunStatus;
  intent: AgentIntent;
  selectedTool: AgentToolName;
  workflow: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  events: AgentRunEvent[];
}

export interface AgentRunSummary {
  id: string;
  status: AgentRunStatus;
  intent: AgentIntent;
  selectedTool: AgentToolName;
  workflow: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
