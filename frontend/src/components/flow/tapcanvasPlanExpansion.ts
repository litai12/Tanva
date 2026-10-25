// tapcanvas.asset-plan/v5 节点数组 → Tanva Flow 节点 + 连线（纯函数）。
// 约定：所有生成节点的提示词由 textPrompt 承载（text → text）；只建节点不运行，
// 用户点击生成时走各节点现有的报价与扣费。
import type { AssetPlanNode } from "@/services/tapcanvasPlanApi";

export type ExpansionNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  style?: Record<string, unknown>;
};
export type ExpansionEdge = { id: string; source: string; target: string; sourceHandle: string; targetHandle: string; type: string };
export type PlanExpansion = { nodes: ExpansionNode[]; edges: ExpansionEdge[]; warnings: string[] };

/** 规划输入槽位 `input:N`（第 N 个提交素材）→ 画布上已有的源节点。 */
export type PlanInputBinding = { nodeId: string; sourceHandle: string; kind: "image" | "video" };

const COL = { imagePrompt: 0, imageGen: 320, script: 680, videoPrompt: 1020, video: 1340 } as const;
const IMAGE_ROW = 340;
const VIDEO_ROW = 340;
const GROUP_PADDING = 40;
const GROUP_WIDTH = COL.video + 320 + GROUP_PADDING * 2;

const SEEDANCE_DURATIONS = { min: 4, max: 15 };
const SEEDANCE_RESOLUTIONS = new Set(["480P", "720P", "1080P", "4K"]);
const ASPECT_RATIOS = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const GPT_IMAGE_MODELS = new Set(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip"]);

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** 图片节点类型按规划冻结的生图模型选择；未知模型落到 Tanva 默认 Pro 生图。 */
export function resolveImageNode(modelKey?: string): { type: string; data: Record<string, unknown> } {
  const key = (modelKey || "").toLowerCase();
  if (key.includes("gpt-image")) return { type: "gptImage2", data: GPT_IMAGE_MODELS.has(key) ? { model: key } : {} };
  if (key.includes("nano-banana-2") || key.includes("banana-2.1")) return { type: "nano2", data: {} };
  return { type: "generatePro", data: { modelProvider: "banana" } };
}

/** 视频节点：Seedance 2.x 映射到 seedance20Video；Tanva 没有对应节点的模型不静默替换。 */
export function resolveVideoNode(modelKey?: string): { type: string; seedanceModel: string } | null {
  const key = (modelKey || "seedance-2.0").toLowerCase();
  if (!key.includes("seedance") && !key.startsWith("seed-")) return null;
  const seedanceModel = key.includes("2.5") ? "seedance-2.5" : key.includes("fast") ? "seedance-2.0-fast" : "seedance-2.0";
  return { type: "seedance20Video", seedanceModel };
}

export function clampSeedanceDuration(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 5;
  return Math.min(SEEDANCE_DURATIONS.max, Math.max(SEEDANCE_DURATIONS.min, n));
}

const imagePromptText = (node: AssetPlanNode) => {
  const negative = str(node.parameters?.negativePrompt);
  return negative ? `${node.prompt}\n\n避免：${negative}` : node.prompt;
};

/**
 * @param origin 展开区域左上角（画布绝对坐标）。
 * @param idPrefix 本次展开的唯一前缀；instantiateTemplateAt 会再映射为新节点 id。
 */
export function buildPlanExpansion(plan: AssetPlanNode[], options: {
  origin: { x: number; y: number };
  idPrefix: string;
  inputs?: Record<string, PlanInputBinding>;
  groupName?: string;
}): PlanExpansion {
  const { origin, idPrefix } = options;
  const inputs = options.inputs ?? {};
  const nodes: ExpansionNode[] = [];
  const edges: ExpansionEdge[] = [];
  const warnings: string[] = [];
  // assetKey 含中文名，净化后会撞车：按规划顺序编号保证唯一。
  const ordinal = new Map(plan.map((n, index) => [n.assetKey, index]));
  const id = (role: string, key: string) => `${idPrefix}-${role}-${ordinal.get(key) ?? key}`;
  const at = (x: number, y: number) => ({ x: origin.x + GROUP_PADDING + x, y: origin.y + GROUP_PADDING + 40 + y });
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => {
    edges.push({ id: `${idPrefix}-e${edges.length}`, source, target, sourceHandle, targetHandle, type: "default" });
  };

  // 能产出图片的规划资产：生图节点或已绑定的输入素材。
  const imageSources = new Map<string, { nodeId: string; sourceHandle: string }>();
  for (const [key, binding] of Object.entries(inputs)) {
    if (binding.kind === "image") imageSources.set(key, { nodeId: binding.nodeId, sourceHandle: binding.sourceHandle });
  }

  const images = plan.filter((n) => n.type === "image");
  const texts = plan.filter((n) => n.type === "text");
  const videos = plan.filter((n) => n.type === "video");
  const audios = plan.filter((n) => n.type === "audio");

  images.forEach((node, row) => {
    const promptId = id("ip", node.assetKey);
    const genId = id("img", node.assetKey);
    const resolved = resolveImageNode(str(node.parameters?.modelKey));
    const aspectRatio = str(node.parameters?.aspectRatio);
    nodes.push({ id: promptId, type: "textPrompt", position: at(COL.imagePrompt, row * IMAGE_ROW),
      data: { text: imagePromptText(node), title: `${node.title} · 提示词` } });
    nodes.push({ id: genId, type: resolved.type, position: at(COL.imageGen, row * IMAGE_ROW),
      data: { ...resolved.data, title: node.title, ...(aspectRatio && ASPECT_RATIOS.has(aspectRatio) ? { aspectRatio } : {}),
        tapcanvasAssetKey: node.assetKey } });
    edge(promptId, "text", genId, "text");
    imageSources.set(node.assetKey, { nodeId: genId, sourceHandle: "img" });
  });

  // 图片之间的身份参照（状态卡以基础角色卡为参照）：规划为 DAG，节点均已建好后再连线。
  images.forEach((node) => {
    const genId = id("img", node.assetKey);
    for (const dep of node.upstreamDependencies || []) {
      const source = imageSources.get(dep.assetKey);
      if (source && source.nodeId !== genId) edge(source.nodeId, source.sourceHandle, genId, "img");
    }
  });

  const scriptIds = new Map<string, string>();
  texts.forEach((node, row) => {
    const noteId = id("script", node.assetKey);
    scriptIds.set(node.assetKey, noteId);
    const content = str(node.parameters?.content) || node.prompt;
    nodes.push({ id: noteId, type: "textNote", position: at(COL.script, row * VIDEO_ROW), data: { text: `【${node.title}】\n${content}` } });
  });

  videos.forEach((node, row) => {
    const promptId = id("vp", node.assetKey);
    const y = row * VIDEO_ROW;
    nodes.push({ id: promptId, type: "textPrompt", position: at(COL.videoPrompt, y), data: { text: node.prompt, title: `${node.title} · 视频提示词` } });
    const resolved = resolveVideoNode(str(node.parameters?.modelKey));
    if (!resolved) {
      warnings.push(`${node.title}：规划视频模型 ${node.parameters?.modelKey ?? "未知"} 在 Tanva 暂无对应节点，已保留提示词，请手动选择视频节点`);
      return;
    }
    const videoId = id("video", node.assetKey);
    const resolution = str(node.parameters?.resolution)?.toUpperCase();
    const aspectRatio = str(node.parameters?.aspectRatio);
    const firstFrame = str(node.parameters?.firstFrameAssetKey);
    const firstFrameSource = firstFrame ? imageSources.get(firstFrame) : undefined;
    nodes.push({ id: videoId, type: resolved.type, position: at(COL.video, y), data: {
      title: node.title, seedanceModel: resolved.seedanceModel,
      seedanceMode: firstFrameSource ? "first_frame" : "reference_images",
      clipDuration: clampSeedanceDuration(node.parameters?.durationSeconds),
      resolution: resolution && SEEDANCE_RESOLUTIONS.has(resolution) ? resolution : "720P",
      aspectRatio: aspectRatio && ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : "16:9",
      generateAudio: true, tapcanvasAssetKey: node.assetKey,
    } });
    edge(promptId, "text", videoId, "text");
    if (firstFrameSource) {
      edge(firstFrameSource.nodeId, firstFrameSource.sourceHandle, videoId, "image");
    } else {
      // 引用顺序与规划一致：提示词中的 @引用 按 referenceBindings / referenceAssetKeys 顺序编号。
      const bindings: unknown[] = Array.isArray(node.parameters?.referenceBindings) ? node.parameters.referenceBindings
        : Array.isArray(node.parameters?.referenceAssetKeys) ? node.parameters.referenceAssetKeys.map((assetKey: unknown) => ({ assetKey })) : [];
      const bound = bindings.map((b) => (b && typeof b === "object" ? (b as { assetKey?: unknown }).assetKey : undefined))
        .filter((k): k is string => typeof k === "string");
      const deps = (node.upstreamDependencies || []).filter((d) => d.role === "reference_image").map((d) => d.assetKey);
      for (const key of Array.from(new Set([...bound, ...deps]))) {
        const source = imageSources.get(key);
        if (source) edge(source.nodeId, source.sourceHandle, videoId, "image");
        else warnings.push(`${node.title}：参考资产 ${key} 未找到，请手动连接`);
      }
    }
  });

  audios.forEach((node, row) => {
    nodes.push({ id: id("audio", node.assetKey), type: "textNote", position: at(COL.script, (texts.length + row) * VIDEO_ROW),
      data: { text: `【${node.title}·音频规划】\n${node.prompt}` } });
  });

  const rows = Math.max(images.length * IMAGE_ROW, (texts.length + audios.length) * VIDEO_ROW, videos.length * VIDEO_ROW, IMAGE_ROW);
  const bounds = { x: origin.x, y: origin.y, width: GROUP_WIDTH, height: rows + GROUP_PADDING * 2 + 40 };
  const childNodeIds = nodes.map((n) => n.id);
  nodes.unshift({ id: `${idPrefix}-group`, type: "nodeGroup", position: { x: origin.x, y: origin.y },
    data: { groupName: options.groupName || "一键成片规划", groupColor: "#8b5cf6", childNodeIds, collapsed: false, expandedBounds: bounds },
    style: { width: bounds.width, height: bounds.height, zIndex: -1 } });

  return { nodes, edges, warnings };
}
