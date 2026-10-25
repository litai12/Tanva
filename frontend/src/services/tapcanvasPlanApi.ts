// 「爆款复刻 & 一键成片」节点：TapCanvas 资产规划任务（后端 /api/tapcanvas-plans）。
// 费用按 TapCanvas 回执的实际模型用量结算（人民币 × 1.5 × 100 积分），提交时仅预扣/核验余额。
import { fetchWithAuth } from "./authFetch";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000") + "/api/tapcanvas-plans";

export type TapcanvasPlanMode = "film" | "remake";
export type TapcanvasPlanAsset =
  | { type: "image"; imageType: "style" | "normal"; url: string }
  | { type: "video"; url: string };

export type TapcanvasPlanStatus = "submitting" | "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface TapcanvasPlanTask {
  id: string;
  status: TapcanvasPlanStatus;
  mode: TapcanvasPlanMode;
  tapJobId: string | null;
  sourceTaskId: string | null;
  error: string | null;
  progress: {
    nodeSummary: Record<string, number> | null;
    nodes: Array<{ label: string; status: string }>;
    elapsedMs: number | null;
    deadlineAt: string | null;
    cancelRequestedAt: string | null;
    retryable: boolean;
  } | null;
  canCancel: boolean;
  canRetry: boolean;
  hasResult: boolean;
  nodeCount: number | null;
  billing: { reservedCredits?: number; status?: string; creditsCharged?: number | null; costCny?: string | null };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TapcanvasPlanOptions {
  enabled: boolean;
  authorModels: string[];
  defaultModel: string;
  reasoningEfforts: string[];
  clipPreferences: string[];
  knowledgeTiers: string[];
  reserveCredits: number;
}

/** tapcanvas.asset-plan/v5 节点（只读合同，字段缺失表示上游未给出）。 */
export interface AssetPlanNode {
  nodeId: string;
  assetKey: string;
  title: string;
  type: "image" | "text" | "video" | "audio";
  prompt: string;
  upstreamDependencies: Array<{ assetKey: string; title: string; role?: string; usage?: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 上游开放 JSON，字段随协议版本增加
  parameters: Record<string, any>;
}

export const TAPCANVAS_PLAN_TERMINAL = new Set<TapcanvasPlanStatus>(["succeeded", "failed", "canceled"]);

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message
      : Array.isArray(body?.message) ? body.message.join("；") : fallback;
    throw new Error(message || `${fallback}（HTTP ${response.status}）`);
  }
  return body as T;
}

export const tapcanvasPlanApi = {
  async options(): Promise<TapcanvasPlanOptions> {
    return readJson(await fetchWithAuth(`${API_BASE}/options`), "规划配置读取失败");
  },
  async create(payload: {
    mode: TapcanvasPlanMode; text: string; requirement?: string; assets: TapcanvasPlanAsset[];
    modelKey: string; reasoningEffort: string; clipPreference?: string; knowledgeTier?: string; step?: number;
    projectId?: string; nodeId?: string; clientRequestId: string;
  }): Promise<TapcanvasPlanTask> {
    return readJson(await fetchWithAuth(API_BASE, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), timeoutMs: 90_000 }), "规划提交失败");
  },
  async get(id: string): Promise<TapcanvasPlanTask> {
    return readJson(await fetchWithAuth(`${API_BASE}/${encodeURIComponent(id)}`, { timeoutMs: 60_000 }), "规划进度读取失败");
  },
  async result(id: string): Promise<{ id: string; nodes: AssetPlanNode[] }> {
    return readJson(await fetchWithAuth(`${API_BASE}/${encodeURIComponent(id)}/result`), "规划结果读取失败");
  },
  async cancel(id: string): Promise<TapcanvasPlanTask> {
    return readJson(await fetchWithAuth(`${API_BASE}/${encodeURIComponent(id)}/cancel`, { method: "POST" }), "停止失败");
  },
  async retry(id: string, clientRequestId: string): Promise<TapcanvasPlanTask> {
    return readJson(await fetchWithAuth(`${API_BASE}/${encodeURIComponent(id)}/retry`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientRequestId }), timeoutMs: 90_000 }), "重试提交失败");
  },
};
