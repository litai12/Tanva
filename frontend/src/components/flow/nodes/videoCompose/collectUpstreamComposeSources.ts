import type { Edge, Node } from "reactflow";
import type { ComposeVideoSource } from "./useVideoCompose";
import type { ComposeAudioTrack } from "./composeVideosCore";

/**
 * Tanva 画布按 node.type 区分节点（无 kind/schema 体系）。
 * 这两份清单与 FlowOverlay.tsx 的 VIDEO_SOURCE_NODE_TYPES / 音频源判定保持一致，
 * 在此本地维护以避免对超大 FlowOverlay 模块的循环依赖。
 */
const VIDEO_SOURCE_NODE_TYPES = new Set([
  "video",
  "sora2Video",
  "wan26",
  "wan2R2V",
  "happyhorseR2V",
  "wan27Video",
  "omniFlashExtVideo",
  "klingVideo",
  "kling26Video",
  "kling30Video",
  "klingO1Video",
  "viduVideo",
  "viduQ3",
  "doubaoVideo",
  "seedance20Video",
  "seedVideo",
  "genericVideo",
  "seedanceVideo",
  "volcEnhanceVideo",
  "videoCompose",
]);

const AUDIO_SOURCE_NODE_TYPES = new Set([
  "audioUpload",
  "minimaxSpeech",
  "tencentSpeech",
  "minimaxMusic",
]);

const VIDEO_SOURCE_HANDLES = new Set(["video", "video-out"]);

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** 从源节点 data 中尽量取出主视频 URL（兼容 videoUrl / videoResults / videoUrls 多形状）。 */
function pickVideoUrl(data: Record<string, any>): {
  url?: string;
  title?: string;
  thumbnailUrl?: string;
} {
  const results = Array.isArray(data.videoResults) ? data.videoResults : [];
  const idx =
    typeof data.videoPrimaryIndex === "number" ? data.videoPrimaryIndex : 0;
  const primary = results[idx] || results[0];
  const urls = Array.isArray(data.videoUrls) ? data.videoUrls : [];
  const url = firstString(
    primary?.url,
    data.videoUrl,
    typeof urls[0] === "string" ? urls[0] : undefined
  );
  return {
    url,
    title: firstString(primary?.title, data.label, data.videoName),
    thumbnailUrl: firstString(primary?.thumbnailUrl, data.thumbnailUrl, data.thumbnail),
  };
}

/**
 * 纯函数：从画布图中收集指定合成节点上游直连的视频源列表（按 incoming edge 顺序）。
 * 只收 source.type ∈ VIDEO_SOURCE_NODE_TYPES 且 sourceHandle 为视频输出的节点。
 */
export function collectUpstreamComposeSources(
  nodeId: string,
  nodes: Node[],
  edges: Edge[]
): ComposeVideoSource[] {
  const incoming = edges.filter(
    (e) => e.target === nodeId && (e.targetHandle ?? "video") === "video"
  );
  const results: ComposeVideoSource[] = [];

  for (const edge of incoming) {
    const srcNode = nodes.find((n) => n.id === edge.source);
    if (!srcNode) continue;
    if (!VIDEO_SOURCE_NODE_TYPES.has(srcNode.type || "")) continue;
    // sourceHandle 为空时也放行（部分节点未显式给视频源 handle 命名）
    if (
      edge.sourceHandle != null &&
      !VIDEO_SOURCE_HANDLES.has(edge.sourceHandle)
    ) {
      continue;
    }

    const data = (srcNode.data || {}) as Record<string, any>;
    const { url, title, thumbnailUrl } = pickVideoUrl(data);
    if (url) results.push({ url, title, thumbnailUrl });
  }

  return results;
}

/**
 * 收集合成节点上游直连的音频节点（配音/BGM 轨）。
 * 只收 source.type ∈ AUDIO_SOURCE_NODE_TYPES 且有 audioUrl 的节点；
 * 音量默认 1，minimaxMusic 视为 BGM 循环铺底。
 */
export function collectUpstreamComposeAudioTracks(
  nodeId: string,
  nodes: Node[],
  edges: Edge[]
): ComposeAudioTrack[] {
  const incoming = edges.filter(
    (e) => e.target === nodeId && e.targetHandle === "audio"
  );
  const results: ComposeAudioTrack[] = [];

  for (const edge of incoming) {
    const srcNode = nodes.find((n) => n.id === edge.source);
    if (!srcNode) continue;
    if (!AUDIO_SOURCE_NODE_TYPES.has(srcNode.type || "")) continue;

    const data = (srcNode.data || {}) as Record<string, any>;
    const urls = Array.isArray(data.audioUrls) ? data.audioUrls : [];
    const url = firstString(
      data.audioUrl,
      typeof urls[0] === "string" ? urls[0] : undefined
    );
    if (!url) continue;

    results.push({
      url,
      title: firstString(data.label, data.audioName),
      volume: typeof data.audioVolume === "number" ? data.audioVolume : 1,
      loop: data.audioLoop === true || srcNode.type === "minimaxMusic",
    });
  }

  return results;
}
