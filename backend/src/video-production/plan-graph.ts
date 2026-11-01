/**
 * TapCanvas 资产规划（tapcanvas.asset-plan/v5）→ 服务端生产图（纯函数）。
 *
 * 规则与画布展开 frontend/src/components/flow/tapcanvasPlanExpansion.ts 一致，只是不建节点、不排版：
 * - 只生成被视频实际用到的参考图（首帧，或上限内的参考图）及其身份依赖链；没有视频时保留全部图片。
 * - 图片模型按规划 modelKey 归到 gptImage2 / nano2 / generatePro(banana)；视频模型 Seedance 2.x，其它回落 Seedance 2.0。
 * - Clip：首帧优先；否则按 referenceBindings → referenceAssetKeys → reference_image 依赖去重，截到模型参考图上限。
 * - 视频提示词里的 `@<mention>` 只绑定实际用上、且正文确有该 token 的参考图（运行时改写为 @图N）。
 * 两边共用同一份规划样例做回归（plan-graph.spec.ts / tapcanvasPlanExpansion.test.ts）。
 */

export interface AssetPlanNode {
  nodeId?: string;
  assetKey: string;
  title: string;
  type: 'image' | 'text' | 'video' | 'audio' | string;
  prompt: string;
  upstreamDependencies?: Array<{ assetKey: string; title?: string; role?: string; usage?: string }>;
  parameters?: Record<string, any>;
}

export type ImageNodeType = 'gptImage2' | 'nano2' | 'generatePro';
export type SeedanceModel = 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.5';

export interface GraphImage {
  key: string;
  title: string;
  prompt: string;
  nodeType: ImageNodeType;
  /** gptImage2 的具体模型（如 gpt-image-2.5-flare）；其它节点为空。 */
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  /** 身份参照：其它图片 key 或用户输入素材 `input:N`。 */
  refs: string[];
}

export interface GraphClip {
  key: string;
  title: string;
  prompt: string;
  seedanceModel: SeedanceModel;
  mode: 'first_frame' | 'reference_images';
  durationSeconds: number;
  resolution: string;
  aspectRatio: string;
  firstFrame?: string;
  references: string[];
  /** 提示词中的 @提及 → 参考图 key（运行时按 references 顺序改写为 @图N）。 */
  mentions: Array<{ token: string; key: string; label: string }>;
}

export interface ProductionGraph { images: GraphImage[]; clips: GraphClip[]; warnings: string[] }

export interface GraphOptions {
  /** 用户输入素材：`input:N` → 远程图片 URL（规划请求 assets 中第 N 张图）。 */
  inputs?: Record<string, string>;
  /** 用户指定的模型，覆盖规划中每张图 / 每段 Clip 的 modelKey。 */
  imageModel?: string;
  videoModel?: string;
  /** 用户指定的视频画幅与分辨率，覆盖规划。 */
  aspectRatio?: string;
  resolution?: string;
}

export const SEEDANCE_DURATIONS = { min: 4, max: 15 };
export const SEEDANCE_RESOLUTIONS = ['480P', '720P', '1080P', '4K'];
export const SEEDANCE_REFERENCE_IMAGE_MAX: Record<SeedanceModel, number> = { 'seedance-2.0': 9, 'seedance-2.0-fast': 9, 'seedance-2.5': 30 };
export const VIDEO_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const IMAGE_RESOLUTIONS = new Set(['1K', '2K', '4K']);
const GPT_IMAGE_QUALITIES = new Set(['low', 'medium', 'high']);
export const GPT_IMAGE_MODELS = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare-vip', 'gpt-image-2.5-sunburst-vip'];
const REFERENCE_TYPE_ORDER = ['character', 'scene', 'prop', 'palette', 'vfx'];

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

export function resolveImageNode(modelKey?: string): { nodeType: ImageNodeType; model?: string } {
  const key = (modelKey || '').toLowerCase();
  if (key.includes('gpt-image')) return { nodeType: 'gptImage2', ...(GPT_IMAGE_MODELS.includes(key) ? { model: key } : {}) };
  if (key.includes('nano-banana-2') || key.includes('banana-2.1')) return { nodeType: 'nano2' };
  return { nodeType: 'generatePro' };
}

export function resolveSeedanceModel(modelKey?: string): SeedanceModel | null {
  const key = (modelKey || 'seedance-2.0').toLowerCase();
  if (!key.includes('seedance') && !key.startsWith('seed-')) return null;
  return key.includes('2.5') ? 'seedance-2.5' : key.includes('fast') ? 'seedance-2.0-fast' : 'seedance-2.0';
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

const imageFamily = (node: AssetPlanNode) => {
  const [, type = '', name = ''] = node.assetKey.split(':');
  const refType = str(node.parameters?.referenceType) || type;
  const rank = REFERENCE_TYPE_ORDER.indexOf(refType);
  return { rank: rank < 0 ? REFERENCE_TYPE_ORDER.length : rank, family: `${type}:${name}`, isBase: node.assetKey.endsWith(':base') };
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
    .map(k => k.node);
};

const imageRefKeys = (node: AssetPlanNode) => {
  const refKeys = Array.isArray(node.parameters?.referenceAssetKeys)
    ? node.parameters!.referenceAssetKeys.filter((k: unknown): k is string => typeof k === 'string') : [];
  return [...new Set([...(node.upstreamDependencies || []).map(d => d.assetKey), ...refKeys])];
};

const videoRefs = (node: AssetPlanNode) => {
  const firstFrame = str(node.parameters?.firstFrameAssetKey)
    ?? (node.upstreamDependencies || []).find(d => d.role === 'first_frame')?.assetKey;
  const bindings: unknown[] = Array.isArray(node.parameters?.referenceBindings) ? node.parameters!.referenceBindings
    : Array.isArray(node.parameters?.referenceAssetKeys) ? node.parameters!.referenceAssetKeys.map((assetKey: unknown) => ({ assetKey })) : [];
  const bound = bindings.map(b => (b && typeof b === 'object' ? (b as { assetKey?: unknown }).assetKey : undefined))
    .filter((k): k is string => typeof k === 'string');
  const deps = (node.upstreamDependencies || []).filter(d => d.role === 'reference_image').map(d => d.assetKey);
  return { firstFrame, bindings, keys: Array.from(new Set([...bound, ...deps])) };
};

export function buildProductionGraph(plan: AssetPlanNode[], options: GraphOptions = {}): ProductionGraph {
  const inputs = options.inputs ?? {};
  const warnings: string[] = [];
  const forcedVideo = options.videoModel ? resolveSeedanceModel(options.videoModel) : null;
  if (options.videoModel && !forcedVideo) throw new Error(`一键成片暂不支持视频模型 ${options.videoModel}，请选 Seedance 系列`);
  const videoModelOf = (node: AssetPlanNode) => forcedVideo ?? resolveSeedanceModel(str(node.parameters?.modelKey));
  const limitOf = (node: AssetPlanNode) => SEEDANCE_REFERENCE_IMAGE_MAX[videoModelOf(node) ?? 'seedance-2.0'] ?? 9;

  const videos = plan.filter(n => n.type === 'video');
  const plannedImages = plan.filter(n => n.type === 'image');
  const plannedKeys = new Set(plannedImages.map(n => n.assetKey));
  const available = (key: string) => plannedKeys.has(key) || key in inputs;

  // 被视频实际用到的图片及其身份依赖链。
  const needed = new Set<string>();
  for (const video of videos) {
    const { firstFrame, keys } = videoRefs(video);
    if (firstFrame && available(firstFrame)) { needed.add(firstFrame); continue; }
    keys.filter(available).slice(0, limitOf(video)).forEach(key => needed.add(key));
  }
  const byKey = new Map(plannedImages.map(n => [n.assetKey, n]));
  const stack = [...needed];
  while (stack.length) {
    const node = byKey.get(stack.pop()!);
    for (const key of node ? imageRefKeys(node) : []) if (byKey.has(key) && !needed.has(key)) { needed.add(key); stack.push(key); }
  }
  const unused = videos.length ? plannedImages.filter(n => !needed.has(n.assetKey)) : [];
  if (unused.length) warnings.push(`${unused.length} 张参考图未被任何 Clip 使用，已省略：${unused.map(n => n.title).join('、')}`);
  const unusedKeys = new Set(unused.map(n => n.assetKey));

  const images: GraphImage[] = sortImages(plannedImages.filter(n => !unusedKeys.has(n.assetKey))).map(node => {
    const resolved = resolveImageNode(options.imageModel ?? str(node.parameters?.modelKey));
    const aspectRatio = str(node.parameters?.aspectRatio);
    const resolution = str(node.parameters?.size)?.toUpperCase();
    const quality = str(node.parameters?.quality)?.toLowerCase();
    return {
      key: node.assetKey, title: node.title, prompt: imagePromptText(node), nodeType: resolved.nodeType,
      ...(resolved.model ? { model: resolved.model } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution && IMAGE_RESOLUTIONS.has(resolution) ? { resolution } : {}),
      ...(resolved.nodeType === 'gptImage2' && quality && GPT_IMAGE_QUALITIES.has(quality) ? { quality } : {}),
      refs: imageRefKeys(node).filter(key => key !== node.assetKey && (plannedKeys.has(key) || key in inputs) && !unusedKeys.has(key)),
    };
  });
  const imageKeys = new Set(images.map(i => i.key));
  const sourceExists = (key: string) => imageKeys.has(key) || key in inputs;

  const fallback = new Map<string, number>();
  const userAspect = options.aspectRatio && VIDEO_ASPECT_RATIOS.includes(options.aspectRatio) ? options.aspectRatio : undefined;
  const userResolution = options.resolution && SEEDANCE_RESOLUTIONS.includes(options.resolution.toUpperCase()) ? options.resolution.toUpperCase() : undefined;
  const clips: GraphClip[] = videos.map(node => {
    let seedanceModel = videoModelOf(node);
    if (!seedanceModel) {
      seedanceModel = 'seedance-2.0';
      const label = str(node.parameters?.modelKey) ?? '未知';
      fallback.set(label, (fallback.get(label) ?? 0) + 1);
    }
    const resolution = str(node.parameters?.resolution)?.toUpperCase();
    const aspectRatio = str(node.parameters?.aspectRatio);
    const { firstFrame, bindings, keys } = videoRefs(node);
    const base = {
      key: node.assetKey, title: node.title, prompt: node.prompt, seedanceModel,
      durationSeconds: clampSeedanceDuration(node.parameters?.durationSeconds),
      resolution: userResolution ?? (resolution && SEEDANCE_RESOLUTIONS.includes(resolution) ? resolution : '720P'),
      aspectRatio: userAspect ?? (aspectRatio && VIDEO_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '16:9'),
    };
    if (firstFrame && sourceExists(firstFrame)) return { ...base, mode: 'first_frame' as const, firstFrame, references: [], mentions: [] };
    const max = SEEDANCE_REFERENCE_IMAGE_MAX[seedanceModel];
    const references: string[] = [];
    for (const key of keys) {
      if (unusedKeys.has(key)) continue;
      if (!sourceExists(key)) { warnings.push(`${node.title}：参考资产 ${key} 未找到，已忽略`); continue; }
      if (references.length >= max) { warnings.push(`${node.title}：参考图超过 ${max} 张上限，已省略 ${key}`); continue; }
      references.push(key);
    }
    const mentions: GraphClip['mentions'] = [];
    for (const binding of bindings) {
      const b = (binding && typeof binding === 'object' ? binding : {}) as { assetKey?: unknown; mention?: unknown; name?: unknown };
      const key = str(b.assetKey); const mention = str(b.mention);
      if (!key || !mention || !references.includes(key)) continue;
      const token = `@${mention}`;
      if (!node.prompt.includes(token) || mentions.some(m => m.token === token)) continue;
      mentions.push({ token, key, label: str(b.name) || mention });
    }
    return { ...base, mode: 'reference_images' as const, references, mentions };
  });
  for (const [model, count] of fallback) warnings.push(`规划视频模型 ${model} 在 Tanva 暂无对应模型，${count} 个 Clip 已改用 Seedance 2.0`);
  return { images, clips, warnings };
}

/** 图片的生成顺序：依赖（其它图片）全部完成后才能生成；返回分层批次。规划为 DAG，若有环则剩余的按一层处理。 */
export function imageWaves(images: GraphImage[]): string[][] {
  const keys = new Set(images.map(i => i.key));
  const done = new Set<string>();
  const waves: string[][] = [];
  let pending = images.slice();
  while (pending.length) {
    const ready = pending.filter(i => i.refs.every(r => !keys.has(r) || done.has(r)));
    const wave = (ready.length ? ready : pending).map(i => i.key);
    waves.push(wave);
    wave.forEach(k => done.add(k));
    pending = pending.filter(i => !done.has(i.key));
  }
  return waves;
}
