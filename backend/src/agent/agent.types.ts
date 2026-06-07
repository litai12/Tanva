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
  | 'research_result'
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
}

export interface AgentResearchImageCandidate {
  label: string;
  query: string;
  searchUrl: string;
  imageUrl?: string;
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

export interface AgentResearchResult {
  title: string;
  summary: string;
  cases: AgentResearchCase[];
  sources: AgentResearchSource[];
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
