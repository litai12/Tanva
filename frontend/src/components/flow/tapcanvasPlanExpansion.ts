// tapcanvas.asset-plan/v5 节点数组 → Tanva Flow 节点 + 连线（纯函数）。
// 约定：所有生成节点的提示词由 textPrompt 承载（text → text）；只建节点不运行，
// 生成依赖全部连好，在分组上「运行组」即按拓扑顺序产出参考图 → 视频，
// 走各节点现有的报价与扣费。
import type { AssetPlanNode } from "@/services/tapcanvasPlanApi";
import type { PromptImageMention } from "./types";

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

type XY = { x: number; y: number };
type Size = { w: number; h: number };

/**
 * 网格槽位：image 区每行 IMAGE_PAIRS_PER_ROW 组「提示词 + 生图」；
 * clip 区每个 Clip 一行「镜头文本 → 视频提示词 → 视频」。列宽/行高取该列/行最大节点。
 */
export type PlanLayoutSlot = { block: "image" | "clip"; row: number; col: number };
/** 写入节点 data，展开后 FlowOverlay 按实测尺寸重排时据此找回槽位。 */
export const PLAN_LAYOUT_DATA_KEY = "tapcanvasLayout";
export const PLAN_RELAYOUT_EVENT = "flow:tapcanvas-plan-relayout";
export type PlanLayoutMeta = { planId: string; origin: XY; slot?: PlanLayoutSlot };

const IMAGE_PAIRS_PER_ROW = 3;
const CLIP_COL = { script: 0, prompt: 1, video: 2 } as const;
const GAP = { col: 40, row: 60, block: 160 };
const GROUP_PADDING = 40;
const GROUP_HEADER = 40;

/**
 * 节点首屏前的估算尺寸（按 2026-10 线上渲染量得，含参数面板与预览区）。
 * 默认尺寸表普遍偏小；重排时与实测值取大，画面外未测量的节点也不会叠压。
 */
export const PLAN_ESTIMATED_SIZE: Record<string, Size> = {
  textPrompt: { w: 240, h: 200 },
  textNote: { w: 240, h: 360 },
  gptImage2: { w: 260, h: 680 },
  nano2: { w: 260, h: 640 },
  generatePro: { w: 320, h: 640 },
  seedance20Video: { w: 280, h: 720 },
};

const SEEDANCE_DURATIONS = { min: 4, max: 15 };
const SEEDANCE_RESOLUTIONS = new Set(["480P", "720P", "1080P", "4K"]);
const SEEDANCE_REFERENCE_IMAGE_MAX: Record<string, number> = { "seedance-2.0": 9, "seedance-2.0-fast": 9, "seedance-2.5": 30 };
const ASPECT_RATIOS = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const IMAGE_RESOLUTIONS = new Set(["1K", "2K", "4K"]);
const GPT_IMAGE_QUALITIES = new Set(["low", "medium", "high"]);
const GPT_IMAGE_MODELS = new Set(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip"]);
/** 参考图分区顺序：同一身份的状态卡紧跟基础卡。 */
const REFERENCE_TYPE_ORDER = ["character", "scene", "prop", "palette", "vfx"];

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** 图片节点类型按规划冻结的生图模型选择；未知模型落到 Tanva 默认 Pro 生图。 */
export function resolveImageNode(modelKey?: string): { type: string; data: Record<string, unknown> } {
  const key = (modelKey || "").toLowerCase();
  if (key.includes("gpt-image")) return { type: "gptImage2", data: GPT_IMAGE_MODELS.has(key) ? { model: key } : {} };
  if (key.includes("nano-banana-2") || key.includes("banana-2.1")) return { type: "nano2", data: {} };
  return { type: "generatePro", data: { modelProvider: "banana" } };
}

/** 视频节点：Seedance 2.x 映射到 seedance20Video；其他模型返回 null，由调用方决定回落。 */
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

/** `image:<type>:<name>:<state>` → 分区与身份族，用于参考图网格排序。 */
const imageFamily = (node: AssetPlanNode) => {
  const [, type = "", name = ""] = node.assetKey.split(":");
  const refType = str(node.parameters?.referenceType) || type;
  const rank = REFERENCE_TYPE_ORDER.indexOf(refType);
  return { rank: rank < 0 ? REFERENCE_TYPE_ORDER.length : rank, family: `${type}:${name}`, isBase: node.assetKey.endsWith(":base") };
};

const sortImages = (images: AssetPlanNode[]) => {
  const familyFirst = new Map<string, number>();
  const keyed = images.map((node, index) => {
    const f = imageFamily(node);
    if (!familyFirst.has(f.family)) familyFirst.set(f.family, index);
    return { node, index, ...f };
  });
  return keyed
    .sort((a, b) => a.rank - b.rank || familyFirst.get(a.family)! - familyFirst.get(b.family)!
      || Number(b.isBase) - Number(a.isBase) || a.index - b.index)
    .map((k) => k.node);
};

const imageRefKeys = (node: AssetPlanNode) => {
  const refKeys = Array.isArray(node.parameters?.referenceAssetKeys)
    ? node.parameters.referenceAssetKeys.filter((k: unknown): k is string => typeof k === "string") : [];
  return [...new Set([...(node.upstreamDependencies || []).map((d) => d.assetKey), ...refKeys])];
};

/** 视频 Clip 的参考图引用：首帧，或按 referenceBindings → referenceAssetKeys → reference_image 依赖顺序去重。 */
const videoRefs = (node: AssetPlanNode) => {
  const firstFrame = str(node.parameters?.firstFrameAssetKey)
    ?? (node.upstreamDependencies || []).find((d) => d.role === "first_frame")?.assetKey;
  const bindings: unknown[] = Array.isArray(node.parameters?.referenceBindings) ? node.parameters.referenceBindings
    : Array.isArray(node.parameters?.referenceAssetKeys) ? node.parameters.referenceAssetKeys.map((assetKey: unknown) => ({ assetKey })) : [];
  const bound = bindings.map((b) => (b && typeof b === "object" ? (b as { assetKey?: unknown }).assetKey : undefined))
    .filter((k): k is string => typeof k === "string");
  const deps = (node.upstreamDependencies || []).filter((d) => d.role === "reference_image").map((d) => d.assetKey);
  return { firstFrame, bindings, keys: Array.from(new Set([...bound, ...deps])) };
};

const videoModel = (node: AssetPlanNode) => resolveVideoNode(str(node.parameters?.modelKey));
const referenceLimit = (node: AssetPlanNode) => SEEDANCE_REFERENCE_IMAGE_MAX[videoModel(node)?.seedanceModel ?? "seedance-2.0"] ?? 9;

/**
 * 被视频实际连上的图片（首帧或上限内的参考图），及其身份依赖链上的图片。
 * 规划常为没有 Clip 引用的道具/色板/特效也设计参考图（如单个 Clip 受参考图上限挤掉），
 * 展开后它们只会被「运行组」白白生成扣费，故不建节点。无视频的规划保留全部图片。
 */
function consumedImageKeys(images: AssetPlanNode[], videos: AssetPlanNode[], available: (key: string) => boolean) {
  const needed = new Set<string>();
  for (const video of videos) {
    const { firstFrame, keys } = videoRefs(video);
    if (firstFrame && available(firstFrame)) { needed.add(firstFrame); continue; }
    keys.filter(available).slice(0, referenceLimit(video)).forEach((key) => needed.add(key));
  }
  const byKey = new Map(images.map((n) => [n.assetKey, n]));
  const stack = [...needed];
  while (stack.length) {
    const node = byKey.get(stack.pop()!);
    for (const key of node ? imageRefKeys(node) : []) {
      if (byKey.has(key) && !needed.has(key)) { needed.add(key); stack.push(key); }
    }
  }
  return needed;
}

const offsets = (sizes: number[], gap: number) => {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    out[i] = acc;
    acc += (sizes[i] ?? 0) + gap;
  }
  return { out, total: Math.max(0, acc - gap) };
};

/** 按槽位网格排版：列宽/行高取最大节点，image 区在左、clip 区在右，两区各自从顶部对齐。 */
export function layoutPlanSlots(items: Array<{ id: string; slot: PlanLayoutSlot }>, origin: XY, getSize: (id: string) => Size) {
  const widths = { image: [] as number[], clip: [] as number[] };
  const heights = { image: [] as number[], clip: [] as number[] };
  for (const { id, slot } of items) {
    const size = getSize(id);
    widths[slot.block][slot.col] = Math.max(widths[slot.block][slot.col] ?? 0, size.w);
    heights[slot.block][slot.row] = Math.max(heights[slot.block][slot.row] ?? 0, size.h);
  }
  const x = { image: offsets(widths.image, GAP.col), clip: offsets(widths.clip, GAP.col) };
  const y = { image: offsets(heights.image, GAP.row), clip: offsets(heights.clip, GAP.row) };
  const clipLeft = widths.image.length ? x.image.total + GAP.block : 0;
  const positions = new Map<string, XY>();
  for (const { id, slot } of items) {
    positions.set(id, {
      x: origin.x + GROUP_PADDING + (slot.block === "clip" ? clipLeft : 0) + x[slot.block].out[slot.col],
      y: origin.y + GROUP_PADDING + GROUP_HEADER + y[slot.block].out[slot.row],
    });
  }
  return {
    positions,
    width: clipLeft + (widths.clip.length ? x.clip.total : x.image.total) + GROUP_PADDING * 2,
    height: Math.max(y.image.total, y.clip.total) + GROUP_PADDING * 2 + GROUP_HEADER,
  };
}

export function readPlanLayoutMeta(data: unknown): PlanLayoutMeta | null {
  const meta = (data as Record<string, unknown> | undefined)?.[PLAN_LAYOUT_DATA_KEY] as PlanLayoutMeta | undefined;
  return meta && typeof meta.planId === "string" && meta.origin ? meta : null;
}

/**
 * @param origin 展开区域左上角（画布绝对坐标）。
 * @param idPrefix 本次展开的唯一前缀；instantiateTemplateAt 会再映射为新节点 id，
 *   同时作为 planId 写入各节点，供展开后按实测尺寸重排。
 */
export function buildPlanExpansion(plan: AssetPlanNode[], options: {
  origin: XY;
  idPrefix: string;
  inputs?: Record<string, PlanInputBinding>;
  groupName?: string;
}): PlanExpansion {
  const { origin, idPrefix } = options;
  const inputs = options.inputs ?? {};
  const nodes: ExpansionNode[] = [];
  const edges: ExpansionEdge[] = [];
  const warnings: string[] = [];
  const slots: Array<{ id: string; slot: PlanLayoutSlot }> = [];
  // assetKey 含中文名，净化后会撞车：按规划顺序编号保证唯一。
  const ordinal = new Map(plan.map((n, index) => [n.assetKey, index]));
  const id = (role: string, key: string) => `${idPrefix}-${role}-${ordinal.get(key) ?? key}`;
  const place = (node: Omit<ExpansionNode, "position">, slot: PlanLayoutSlot) => {
    nodes.push({ ...node, position: { x: 0, y: 0 },
      data: { ...node.data, [PLAN_LAYOUT_DATA_KEY]: { planId: idPrefix, origin, slot } satisfies PlanLayoutMeta } });
    slots.push({ id: node.id, slot });
  };
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => {
    edges.push({ id: `${idPrefix}-e${edges.length}`, source, target, sourceHandle, targetHandle, type: "default" });
  };

  // 能产出图片的规划资产：生图节点或已绑定的输入素材。
  const imageSources = new Map<string, { nodeId: string; sourceHandle: string }>();
  for (const [key, binding] of Object.entries(inputs)) {
    if (binding.kind === "image") imageSources.set(key, { nodeId: binding.nodeId, sourceHandle: binding.sourceHandle });
  }

  const texts = plan.filter((n) => n.type === "text");
  const videos = plan.filter((n) => n.type === "video");
  const audios = plan.filter((n) => n.type === "audio");
  const plannedImages = plan.filter((n) => n.type === "image");
  const plannedKeys = new Set(plannedImages.map((n) => n.assetKey));
  const consumed = consumedImageKeys(plannedImages, videos, (key) => plannedKeys.has(key) || imageSources.has(key));
  const unused = videos.length ? plannedImages.filter((n) => !consumed.has(n.assetKey)) : [];
  if (unused.length) {
    warnings.push(`${unused.length} 张参考图未被任何 Clip 使用，已省略：${unused.map((n) => n.title).join("、")}`);
  }
  const unusedKeys = new Set(unused.map((n) => n.assetKey));
  const images = sortImages(plannedImages.filter((n) => !unusedKeys.has(n.assetKey)));
  const typeOf = new Map<string, string>();

  images.forEach((node, index) => {
    const promptId = id("ip", node.assetKey);
    const genId = id("img", node.assetKey);
    const resolved = resolveImageNode(str(node.parameters?.modelKey));
    const aspectRatio = str(node.parameters?.aspectRatio);
    const resolution = str(node.parameters?.size)?.toUpperCase();
    const quality = str(node.parameters?.quality)?.toLowerCase();
    const row = Math.floor(index / IMAGE_PAIRS_PER_ROW);
    const col = (index % IMAGE_PAIRS_PER_ROW) * 2;
    place({ id: promptId, type: "textPrompt", data: { text: imagePromptText(node), title: `${node.title} · 提示词` } },
      { block: "image", row, col });
    place({ id: genId, type: resolved.type, data: {
      ...resolved.data, title: node.title,
      ...(aspectRatio && ASPECT_RATIOS.has(aspectRatio) ? { aspectRatio } : {}),
      ...(resolution && IMAGE_RESOLUTIONS.has(resolution) ? { resolution } : {}),
      ...(resolved.type === "gptImage2" && quality && GPT_IMAGE_QUALITIES.has(quality) ? { quality } : {}),
      tapcanvasAssetKey: node.assetKey,
    } }, { block: "image", row, col: col + 1 });
    typeOf.set(promptId, "textPrompt"); typeOf.set(genId, resolved.type);
    edge(promptId, "text", genId, "text");
    imageSources.set(node.assetKey, { nodeId: genId, sourceHandle: "img" });
  });

  // 图片之间的身份参照（状态卡以基础角色卡为参照）：规划为 DAG，节点均已建好后再连线。
  // 依赖可能只出现在 upstreamDependencies 或 parameters.referenceAssetKeys 之一，取并集。
  images.forEach((node) => {
    const genId = id("img", node.assetKey);
    for (const key of imageRefKeys(node)) {
      const source = imageSources.get(key);
      if (source && source.nodeId !== genId) edge(source.nodeId, source.sourceHandle, genId, "img");
    }
  });

  // 镜头文本与其 Clip 同行；仅作对照，不连入视频提示词（textPrompt 接入文本会覆盖规划提示词）。
  const scriptRow = new Map<string, number>();
  videos.forEach((node, row) => {
    const script = (node.upstreamDependencies || []).find((d) => d.role === "script")?.assetKey;
    if (script && !scriptRow.has(script)) scriptRow.set(script, row);
  });
  let extraRow = videos.length;
  texts.forEach((node) => {
    const content = str(node.parameters?.content) || node.prompt;
    const row = scriptRow.get(node.assetKey) ?? extraRow++;
    place({ id: id("script", node.assetKey), type: "textNote", data: { text: `【${node.title}】\n${content}` } },
      { block: "clip", row, col: CLIP_COL.script });
    typeOf.set(id("script", node.assetKey), "textNote");
  });

  const fallbackModels = new Map<string, number>();
  videos.forEach((node, row) => {
    const promptId = id("vp", node.assetKey);
    place({ id: promptId, type: "textPrompt", data: { text: node.prompt, title: `${node.title} · 视频提示词` } },
      { block: "clip", row, col: CLIP_COL.prompt });
    typeOf.set(promptId, "textPrompt");
    const planned = str(node.parameters?.modelKey);
    // Tanva 无对应节点的视频模型统一回落 Seedance 2.0，保证分组可一键产出成片；回落以提示告知。
    let resolved = videoModel(node);
    if (!resolved) {
      resolved = { type: "seedance20Video", seedanceModel: "seedance-2.0" };
      const label = planned ?? "未知";
      fallbackModels.set(label, (fallbackModels.get(label) ?? 0) + 1);
    }
    const videoId = id("video", node.assetKey);
    const resolution = str(node.parameters?.resolution)?.toUpperCase();
    const aspectRatio = str(node.parameters?.aspectRatio);
    const { firstFrame, bindings, keys } = videoRefs(node);
    const firstFrameSource = firstFrame ? imageSources.get(firstFrame) : undefined;
    place({ id: videoId, type: resolved.type, data: {
      title: node.title, seedanceModel: resolved.seedanceModel,
      seedanceMode: firstFrameSource ? "first_frame" : "reference_images",
      clipDuration: clampSeedanceDuration(node.parameters?.durationSeconds),
      resolution: resolution && SEEDANCE_RESOLUTIONS.has(resolution) ? resolution : "720P",
      aspectRatio: aspectRatio && ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : "16:9",
      generateAudio: true, tapcanvasAssetKey: node.assetKey,
    } }, { block: "clip", row, col: CLIP_COL.video });
    typeOf.set(videoId, resolved.type);
    edge(promptId, "text", videoId, "text");
    if (firstFrameSource) {
      edge(firstFrameSource.nodeId, firstFrameSource.sourceHandle, videoId, "image");
      return;
    }
    // 引用顺序与规划一致：提示词中的 @引用 按 referenceBindings / referenceAssetKeys 顺序编号。
    const max = SEEDANCE_REFERENCE_IMAGE_MAX[resolved.seedanceModel] ?? 9;
    const connected = new Set<string>();
    for (const key of keys) {
      if (unusedKeys.has(key)) continue;
      const source = imageSources.get(key);
      if (!source) { warnings.push(`${node.title}：参考资产 ${key} 未找到，请手动连接`); continue; }
      if (connected.size >= max) { warnings.push(`${node.title}：参考图超过 ${max} 张上限，已省略 ${key}`); continue; }
      edge(source.nodeId, source.sourceHandle, videoId, "image");
      connected.add(key);
    }
    // 视频提示词以「@<mention>」引用参考图：写成 Flow 图片提及，运行时改写为 @图N 并附映射，
    // 模型才能把每张参考图对上角色/场景/道具。只绑定实际连上的图，且正文中确有该 token。
    const mentions: PromptImageMention[] = [];
    bindings.forEach((binding) => {
      const b = (binding && typeof binding === "object" ? binding : {}) as { assetKey?: unknown; mention?: unknown; name?: unknown };
      const key = str(b.assetKey);
      const mention = str(b.mention);
      const source = key ? imageSources.get(key) : undefined;
      if (!key || !mention || !source || !connected.has(key)) return;
      const token = `@${mention}`;
      if (!node.prompt.includes(token) || mentions.some((m) => m.token === token)) return;
      mentions.push({ id: `flow:${source.nodeId}:${source.sourceHandle}:${mentions.length}`, token, label: str(b.name) || mention,
        source: "flow", mediaType: "image", ref: { nodeId: source.nodeId, handle: source.sourceHandle } });
    });
    if (mentions.length) {
      const promptNode = nodes.find((n) => n.id === promptId);
      if (promptNode) promptNode.data.mentions = mentions;
    }
  });
  for (const [model, count] of fallbackModels) {
    warnings.push(`规划视频模型 ${model} 在 Tanva 暂无对应节点，${count} 个 Clip 已改用 Seedance 2.0`);
  }

  audios.forEach((node) => {
    const noteId = id("audio", node.assetKey);
    place({ id: noteId, type: "textNote", data: { text: `【${node.title}·音频规划】\n${node.prompt || ""}` } },
      { block: "clip", row: extraRow++, col: CLIP_COL.script });
    typeOf.set(noteId, "textNote");
  });

  const layout = layoutPlanSlots(slots, origin, (nodeId) => PLAN_ESTIMATED_SIZE[typeOf.get(nodeId) ?? ""] ?? { w: 240, h: 240 });
  for (const node of nodes) node.position = layout.positions.get(node.id) ?? node.position;
  const bounds = { x: origin.x, y: origin.y, width: layout.width, height: layout.height };
  nodes.unshift({ id: `${idPrefix}-group`, type: "nodeGroup", position: { x: origin.x, y: origin.y },
    data: { groupName: options.groupName || "一键成片规划", groupColor: "#8b5cf6", childNodeIds: nodes.map((n) => n.id),
      collapsed: false, expandedBounds: bounds, [PLAN_LAYOUT_DATA_KEY]: { planId: idPrefix, origin } satisfies PlanLayoutMeta },
    style: { width: bounds.width, height: bounds.height, zIndex: -1 } });

  return { nodes, edges, warnings };
}
