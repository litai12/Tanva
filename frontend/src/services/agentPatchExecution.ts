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
