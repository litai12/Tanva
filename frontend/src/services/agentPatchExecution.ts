import type { AgentPatchOp } from "./agentCanvasProtocol";

export type AgentGeneratedAssetKind = "image" | "video" | "audio";

export interface AgentGeneratedAsset {
  kind: AgentGeneratedAssetKind;
  url: string;
}

export interface AgentPatchExecutionResult {
  op: AgentPatchOp;
  ok: boolean;
  agentNodeId?: string;
  nodeId?: string;
  assets: AgentGeneratedAsset[];
  error?: string;
}

export interface AgentPatchExecutionReport {
  results: AgentPatchExecutionResult[];
  succeededCount: number;
  failedCount: number;
  assets: AgentGeneratedAsset[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRemoteAssetUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const pushAsset = (
  target: AgentGeneratedAsset[],
  seen: Set<string>,
  kind: AgentGeneratedAssetKind,
  value: unknown
): void => {
  if (!isRemoteAssetUrl(value)) return;
  const url = value.trim();
  const key = `${kind}:${url}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push({ kind, url });
};

const pushAssetList = (
  target: AgentGeneratedAsset[],
  seen: Set<string>,
  kind: AgentGeneratedAssetKind,
  value: unknown
): void => {
  if (!Array.isArray(value)) return;
  for (const item of value) pushAsset(target, seen, kind, item);
};

const pushResultAssets = (
  target: AgentGeneratedAsset[],
  seen: Set<string>,
  kind: AgentGeneratedAssetKind,
  value: unknown
): void => {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    pushAsset(target, seen, kind, item.url);
    pushAsset(target, seen, kind, item[`${kind}Url`]);
  }
};

/**
 * Extracts only durable remote asset URLs from the node's documented result fields.
 * Local data/blob URLs are deliberately excluded from delivery evidence.
 */
export const collectAgentNodeAssets = (
  data: Record<string, unknown> | null | undefined
): AgentGeneratedAsset[] => {
  if (!data) return [];
  const assets: AgentGeneratedAsset[] = [];
  const seen = new Set<string>();

  pushAsset(assets, seen, "image", data.imageUrl);
  pushAssetList(assets, seen, "image", data.imageUrls);
  pushAssetList(assets, seen, "image", data.images);
  pushResultAssets(assets, seen, "image", data.imageResults);

  pushAsset(assets, seen, "video", data.videoUrl);
  pushAssetList(assets, seen, "video", data.videoUrls);
  pushAssetList(assets, seen, "video", data.videos);
  pushResultAssets(assets, seen, "video", data.videoResults);

  pushAsset(assets, seen, "audio", data.audioUrl);
  pushAssetList(assets, seen, "audio", data.audioUrls);
  pushAssetList(assets, seen, "audio", data.audios);
  pushResultAssets(assets, seen, "audio", data.audioResults);

  return assets;
};

/** Submission is not completion: async video nodes return with a running task. */
export async function waitForAgentNodeResult(
  nodeId: string,
  readData: () => Record<string, unknown> | undefined,
  options: { deadlineAt?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<AgentPatchExecutionResult> {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  const deadlineAt = options.deadlineAt ?? startedAt + 15 * 60 * 1000;
  while (now() < deadlineAt) {
    const data = readData();
    const failed = (error: string): AgentPatchExecutionResult => ({ op: "runNode", ok: false, nodeId, assets: [], error });
    if (!data) return failed("节点已移除或当前项目已切换");
    const status = String(data.status || "");
    if (["failed", "error", "cancelled", "canceled", "stopped"].includes(status)) {
      return failed(typeof data.error === "string" && data.error.trim() ? data.error : "节点生成失败或已停止");
    }
    const pending = ["running", "pending", "queued", "processing"].includes(status);
    if (!pending) {
      const assets = collectAgentNodeAssets(data);
      if (assets.length || status === "succeeded") return { op: "runNode", ok: true, nodeId, assets };
      if (now() - startedAt >= 5000) return failed("节点运行结束后未产生可验证终态");
    }
    await sleep(pending ? 500 : 50);
  }
  return { op: "runNode", ok: false, nodeId, assets: [], error: "节点生成执行超时" };
}

export const buildAgentPatchExecutionReport = (
  results: AgentPatchExecutionResult[]
): AgentPatchExecutionReport => {
  const assets: AgentGeneratedAsset[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    for (const asset of result.assets) {
      const key = `${asset.kind}:${asset.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      assets.push(asset);
    }
  }
  return {
    results: [...results],
    succeededCount: results.filter((result) => result.ok).length,
    failedCount: results.filter((result) => !result.ok).length,
    assets,
  };
};
