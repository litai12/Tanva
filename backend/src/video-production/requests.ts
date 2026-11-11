/**
 * 生产图步骤 → Tanva 现有接口的请求体（纯函数）。字段与画布节点运行时一致：
 * - gptImage2 / nano2：POST /ai/generate-image-async（aiProvider=nano2），参考图走 imageUrls。
 * - generatePro(banana)：按参考图数量走 generate / edit(sourceImageUrl) / blend(sourceImageUrls)，最多 11 张。
 * - seedance20Video：POST /ai/generate-video-provider（provider=doubao），首帧与参考图都放 referenceImages，
 *   由 videoMode 区分；提示词里的 @提及 改写为 @图N 并附「引用图片映射」脚注（与 FlowOverlay 同文案）。
 * 计费、退款与结算全部由这些接口在后端闭环完成。
 */
import type { GraphClip, GraphImage, ImageNodeType, SeedanceModel } from './plan-graph';
import { SEEDANCE_REFERENCE_IMAGE_MAX } from './plan-graph';

export interface ImageModelOption {
  id: string;
  label: string;
  nodeType: ImageNodeType;
  model: string;
  description: string;
}

/** 用户可指定的生图模型（与画布节点的模型取值一致）。 */
export const IMAGE_MODEL_OPTIONS: ImageModelOption[] = [
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', nodeType: 'generatePro', model: 'gemini-3-pro-image-preview', description: '画布「Pro 生图」节点，质量高，支持最多 11 张参考图' },
  { id: 'nano-banana-2', label: 'Nano Banana 2', nodeType: 'nano2', model: 'gemini-3.1-flash-image-preview', description: '画布「Nano2」节点，速度快' },
  { id: 'nano-banana-2.1', label: 'Nano Banana 2.1', nodeType: 'nano2', model: 'gemini-nano-banana-2.1', description: 'Nano Banana 2.1' },
  { id: 'gpt-image-2', label: 'GPT Image 2', nodeType: 'gptImage2', model: 'gpt-image-2', description: 'GPT Image 2' },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', nodeType: 'gptImage2', model: 'gpt-image-2.5-flare', description: 'GPT Image 2.5 Flare' },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', nodeType: 'gptImage2', model: 'gpt-image-2.5-sunburst', description: 'GPT Image 2.5 Sunburst' },
  { id: 'gpt-image-2.6-flare', label: 'GPT Image 2.6 Flare', nodeType: 'gptImage2', model: 'gpt-image-2.6-flare', description: 'GPT Image 2.6 Flare' },
  { id: 'gpt-image-2.6-sunburst', label: 'GPT Image 2.6 Sunburst', nodeType: 'gptImage2', model: 'gpt-image-2.6-sunburst', description: 'GPT Image 2.6 Sunburst' },
  { id: 'gpt-image-2.5-flare-vip', label: 'GPT Image 2.5 Flare VIP', nodeType: 'gptImage2', model: 'gpt-image-2.5-flare-vip', description: 'GPT Image 2.5 Flare VIP（可选质量档位）' },
  { id: 'gpt-image-2.5-sunburst-vip', label: 'GPT Image 2.5 Sunburst VIP', nodeType: 'gptImage2', model: 'gpt-image-2.5-sunburst-vip', description: 'GPT Image 2.5 Sunburst VIP（可选质量档位）' },
];

export interface VideoModelOption {
  id: SeedanceModel;
  label: string;
  durations: { min: number; max: number };
  maxReferenceImages: number;
  description: string;
}

export const VIDEO_MODEL_OPTIONS: VideoModelOption[] = [
  { id: 'seedance-2.0', label: 'Seedance 2.0', durations: { min: 4, max: 15 }, maxReferenceImages: 9, description: '默认；支持首帧 / 多参考图，自带音频' },
  { id: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', durations: { min: 4, max: 15 }, maxReferenceImages: 9, description: '更快更便宜' },
  { id: 'seedance-2.5', label: 'Seedance 2.5', durations: { min: 4, max: 30 }, maxReferenceImages: 30, description: '最多 30 张参考图，单段最长 30 秒' },
];

export const VIDEO_RESOLUTIONS = ['480P', '720P', '1080P', '4K'];
export const VIDEO_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

/** 按显示宽高（已考虑旋转）取最接近的成片画幅，比较对数比值，横竖对称。 */
export function nearestVideoRatio(width: number, height: number): string | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  const target = Math.log(width / height);
  let best: string | undefined; let bestDiff = Infinity;
  for (const ratio of VIDEO_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const diff = Math.abs(Math.log(w / h) - target);
    if (diff < bestDiff) { bestDiff = diff; best = ratio; }
  }
  return best;
}
const GENERATE_PRO_REFERENCE_MAX = 11;
const VIP_MODELS = new Set(['gpt-image-2.5-flare-vip', 'gpt-image-2.5-sunburst-vip']);
const TOAPI_MODELS = new Set(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', ...VIP_MODELS, 'gemini-nano-banana-2.1', 'gemini-nano-banana-2.1-official']);
const VIP_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
const NANO21_RATIOS = [...VIP_RATIOS, '1:4', '4:1', '1:8', '8:1'];
const VIP_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'];

export const findImageModel = (id: string) => IMAGE_MODEL_OPTIONS.find(m => m.id === id || m.model === id);
export const findVideoModel = (id: string) => VIDEO_MODEL_OPTIONS.find(m => m.id === id);

/** 用户指定生图模型时覆盖规划给的节点类型与模型。 */
export function applyImageModel(image: GraphImage, option?: ImageModelOption): GraphImage {
  if (!option) return image;
  return { ...image, nodeType: option.nodeType, model: option.model };
}

export type ImageCall = { kind: 'generate' | 'edit' | 'blend'; dto: Record<string, any> };

/** 与 FlowOverlay normalizePromptForUpstream 一致：空白折叠为单个空格。 */
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

export function buildImageCall(image: Pick<GraphImage, 'nodeType' | 'model' | 'prompt' | 'aspectRatio' | 'resolution' | 'quality'>, refUrls: string[], nodeId: string): ImageCall {
  const prompt = collapse(image.prompt);
  const imageSize = image.resolution || '1K';
  if (image.nodeType === 'generatePro') {
    const base = { prompt, outputFormat: 'png', aiProvider: 'banana', model: 'gemini-3-pro-image-preview', imageSize,
      providerOptions: { banana: { imageRoute: 'normal' } }, ...(image.aspectRatio ? { aspectRatio: image.aspectRatio } : {}), nodeId };
    const refs = refUrls.slice(0, GENERATE_PRO_REFERENCE_MAX);
    if (refs.length === 0) return { kind: 'generate', dto: { ...base, enableWebSearch: true } };
    if (refs.length === 1) return { kind: 'edit', dto: { ...base, sourceImageUrl: refs[0] } };
    return { kind: 'blend', dto: { ...base, sourceImageUrls: refs } };
  }
  const model = image.model || (image.nodeType === 'gptImage2' ? 'gpt-image-2' : 'gemini-3.1-flash-image-preview');
  const vip = VIP_MODELS.has(model);
  let aspectRatio = image.aspectRatio;
  const allowed = vip ? VIP_RATIOS : model.startsWith('gemini-nano-banana-2.1') ? NANO21_RATIOS : null;
  if (allowed) aspectRatio = aspectRatio ? (allowed.includes(aspectRatio) ? aspectRatio : '1:1') : vip ? '1:1' : undefined;
  const dto: Record<string, any> = {
    prompt, aiProvider: 'nano2', model, imageSize,
    providerOptions: { banana: { imageRoute: model === 'gemini-nano-banana-2.1-official' ? 'stable' : 'normal' } },
    ...(aspectRatio ? { aspectRatio } : {}), ...(refUrls.length ? { imageUrls: refUrls } : {}), nodeId,
  };
  if (TOAPI_MODELS.has(model)) dto.managedModelKey = model;
  if (vip) dto.quality = VIP_QUALITIES.includes(String(image.quality)) ? image.quality : 'high';
  if (image.nodeType === 'gptImage2') dto.officialFallback = false;
  return { kind: 'generate', dto };
}

/** 与画布 findPromptMentionTokenMatches / isPromptMentionTokenBoundary 相同的匹配规则：长 token 优先，后接数字/_.- 或 ASCII 连写不算命中。 */
export function rewriteMentionTokens(text: string, replacement: Map<string, string>): string {
  const tokens = [...replacement.keys()].filter(t => t.startsWith('@')).sort((a, b) => b.length - a.length);
  if (!tokens.length) return text;
  const ascii = (c: string) => /[A-Za-z0-9_-]/.test(c);
  let out = ''; let i = 0;
  while (i < text.length) {
    const token = tokens.find(t => {
      if (!text.startsWith(t, i)) return false;
      const next = text.charAt(i + t.length);
      if (!next) return true;
      if (/[0-9_.-]/.test(next)) return false;
      return !(ascii(t.charAt(t.length - 1)) && ascii(next));
    });
    if (!token) { out += text[i]; i += 1; continue; }
    out += replacement.get(token)!; i += token.length;
  }
  return out;
}

/**
 * 参考图顺序：被 @提及 的图按提及顺序在前，其余按规划顺序；按 URL 去重、截到模型上限。
 * 提示词中的 @提及 改写为 @图N，并附映射脚注（文案与画布一致）。
 */
export function buildVideoCall(clip: Pick<GraphClip, 'prompt' | 'seedanceModel' | 'mode' | 'durationSeconds' | 'resolution' | 'aspectRatio' | 'firstFrame' | 'references' | 'mentions'>,
  urlOf: (key: string) => string | undefined, meta: { idempotencyKey: string; clientNodeId: string }): Record<string, any> {
  let prompt = clip.prompt.trim();
  let referenceImages: string[] = [];
  if (clip.mode === 'first_frame') {
    const url = clip.firstFrame ? urlOf(clip.firstFrame) : undefined;
    if (!url) throw new Error('首帧图片尚未就绪');
    referenceImages = [url];
  } else {
    const max = SEEDANCE_REFERENCE_IMAGE_MAX[clip.seedanceModel] ?? 9;
    const ordered = [...clip.mentions.map(m => m.key), ...clip.references];
    for (const key of ordered) {
      const url = urlOf(key);
      if (!url || referenceImages.includes(url) || referenceImages.length >= max) continue;
      referenceImages.push(url);
    }
    const positioned = clip.mentions
      .map(m => ({ ...m, position: referenceImages.indexOf(urlOf(m.key) || '') + 1 }))
      // 只映射正文里确实出现的提及（Clip 提示词可能已被用户改写）。
      .filter(m => m.position > 0 && rewriteMentionTokens(prompt, new Map([[m.token, '\u0000']])) !== prompt);
    if (positioned.length) {
      const byToken = new Map(positioned.map(m => [m.token, `@图${m.position}`]));
      prompt = rewriteMentionTokens(prompt, byToken);
      const lines = [...new Map(positioned.map(m => [m.position, m.label])).entries()].sort((a, b) => a[0] - b[0])
        .map(([position, label]) => `@图${position}=第${position}张参考图${label ? `（${label}）` : ''}`);
      prompt = `${prompt}\n\n引用图片映射：${lines.join('；')}。请严格按这个映射理解 @ 图片引用。`;
    }
  }
  if (clip.seedanceModel !== 'seedance-2.5' && prompt.length > 5000) {
    throw new Error(`${clip.seedanceModel} 提示词最多 5000 个字符（当前 ${prompt.length}），请缩短或改用 seedance-2.5`);
  }
  return {
    provider: 'doubao', prompt,
    ...(referenceImages.length ? { referenceImages } : {}),
    duration: clip.durationSeconds, aspectRatio: clip.aspectRatio, resolution: clip.resolution,
    videoMode: clip.mode, generateAudio: true, seedanceModel: clip.seedanceModel, seed2InputTier: 'gt32k_le128k',
    ...(clip.seedanceModel === 'seedance-2.5' && clip.mode === 'reference_images' && referenceImages.length ? { omniReferenceTaskType: 'reference' } : {}),
    channelTier: 'default', clientNodeId: meta.clientNodeId, clientRunId: meta.idempotencyKey, runSource: 'video-production',
    idempotencyKey: meta.idempotencyKey,
  };
}
