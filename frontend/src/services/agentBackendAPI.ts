import { fetchWithAuth } from "./authFetch";
import type { AIProviderOptions } from "@/types/ai";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000") + "/api";

// 小T可选「大脑」模型清单。
// 与 backend/src/agent/xiaot-agent.service.ts 的 XIAOT_CHAT_MODELS 对齐
// （前后端不共享包，两边须手工同步；后端对未知值会回退默认模型）。
export const XIAOT_CHAT_MODELS = [
  "xiaot-agent-gpt-5-6-sol",
  "xiaot-agent-gpt-5-6-terra",
  "xiaot-agent-gpt-5-6-luna",
] as const;
export type XiaotChatModel = (typeof XIAOT_CHAT_MODELS)[number];

export type AgentEventType =
  | "run_started"
  | "step_started"
  | "step_completed"
  | "plan"
  | "tool_selected"
  | "research_text"
  | "research_result"
  | "assistant_delta"
  | "flow_patch"
  | "host_ui"
  | "final"
  | "error"
  | "done";

export type AgentToolName =
  | "generateImage"
  | "editImage"
  | "blendImages"
  | "analyzeImage"
  | "chatResponse"
  | "generateVideo"
  | "generatePaperJS";

export interface AgentRunSummary {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  intent: string;
  selectedTool: AgentToolName;
  workflow: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
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

export interface CreateAgentRunRequest {
  prompt: string;
  sessionId?: string | null;
  projectId?: string | null;
  aiProvider?: string;
  model?: string;
  providerOptions?: AIProviderOptions;
  thinkingLevel?: "high" | "low";
  manualMode?: string;
  availableTools?: AgentToolName[];
  hasImages?: boolean;
  imageCount?: number;
  enableWebSearch?: boolean;
  context?: Record<string, unknown>;
  mode?: "research" | "canvasAgent";
  canvasContext?: Record<string, unknown>;
  capabilityManifest?: Record<string, unknown>;
  generationContract?: {
    version: "v1";
    lockedAnchors: string[];
    editableVariable: string | null;
    forbiddenChanges: string[];
    approvedKeyframeId: string | null;
  };
  styleReferenceUrl?: string;
}

export async function createAgentRunViaAPI(
  request: CreateAgentRunRequest
): Promise<AgentRunSummary> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.message || `Agent run failed: HTTP ${response.status}`);
  }

  return response.json();
}

export async function streamAgentRunEvents(
  runId: string,
  onEvent: (event: AgentRunEvent) => void,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const response = await fetchWithAuth(
    `${API_BASE_URL}/agent/runs/${encodeURIComponent(runId)}/events`,
    {
      method: "GET",
      timeoutMs: 0,
      signal: options?.signal,
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.message || `Agent event stream failed: HTTP ${response.status}`
    );
  }

  if (!response.body) {
    throw new Error("Agent event stream is not readable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split(/\n\n/);
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const event = parseSseEvent(chunk);
        if (event) {
          onEvent(event);
          if (event.type === "done") return;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function parseSseEvent(chunk: string): AgentRunEvent | null {
  const lines = chunk.split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  try {
    const parsed = JSON.parse(dataLines.join("\n"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.type === "string" &&
      typeof parsed.runId === "string"
    ) {
      return parsed as AgentRunEvent;
    }
  } catch {}

  return null;
}
