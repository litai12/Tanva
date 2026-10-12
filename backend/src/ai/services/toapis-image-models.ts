import type { ManagedPricingBook } from './model-pricing-resolver';
import { BadRequestException } from '@nestjs/common';

export const TOAPIS_VIP_IMAGE_MODELS = ['gpt-image-2.5-flare-vip', 'gpt-image-2.5-sunburst-vip'];
export const NANO_BANANA_21_MODEL = 'gemini-nano-banana-2.1';
export const NANO_BANANA_21_OFFICIAL_MODEL = 'gemini-nano-banana-2.1-official';
export const NANO_BANANA_21_CREDITS = { '1K': 20, '2K': 30, '4K': 40 };
export const NANO_BANANA_21_OFFICIAL_CREDITS = { '1K': 30, '2K': 60, '4K': 90 };
export const NANO_BANANA_21_MODELS = [NANO_BANANA_21_MODEL, NANO_BANANA_21_OFFICIAL_MODEL];
export const TOAPIS_NEW_IMAGE_MODELS = [...TOAPIS_VIP_IMAGE_MODELS, ...NANO_BANANA_21_MODELS];
export const TOAPIS_IMAGE_MODELS = ['gpt-image-2.5', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', ...TOAPIS_NEW_IMAGE_MODELS];
export const TOAPIS_VIP_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
export const NANO_BANANA_21_ASPECT_RATIOS = [...TOAPIS_VIP_ASPECT_RATIOS, '1:4', '4:1', '1:8', '8:1'];
export const TOAPIS_VIP_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const TOAPIS_VIP_IMAGE_CREDITS = {
  low: { '1K': 20, '2K': 30, '4K': 40 },
  medium: { '1K': 30, '2K': 40, '4K': 50 },
  high: { '1K': 40, '2K': 60, '4K': 80 },
  xhigh: { '1K': 60, '2K': 100, '4K': 140 },
  max: { '1K': 150, '2K': 300, '4K': 450 },
};
export const isToapisImageModel = (model: unknown): boolean =>
  TOAPIS_IMAGE_MODELS.includes(String(model || '').trim().toLowerCase());
export const isNewToapisImageModel = (model: unknown): boolean =>
  TOAPIS_NEW_IMAGE_MODELS.includes(String(model || '').trim().toLowerCase());
export const isToapisVipImageModel = (model: unknown): boolean =>
  TOAPIS_VIP_IMAGE_MODELS.includes(String(model || '').trim().toLowerCase());

export const isNanoBanana21Model = (model: unknown): boolean =>
  NANO_BANANA_21_MODELS.includes(String(model || '').trim().toLowerCase());

export function resolveNanoBanana21Model(model: string, options?: any): string {
  if (!isNanoBanana21Model(model)) return model;
  // An explicit official identity never falls back to the ordinary model/key.
  if (model === NANO_BANANA_21_OFFICIAL_MODEL) return model;
  const route = options?.bananaImageRoute || options?.banana?.imageRoute || options?.providerOptions?.banana?.imageRoute || options?.providerOptions?.bananaImageRoute;
  return route === 'stable' ? NANO_BANANA_21_OFFICIAL_MODEL : NANO_BANANA_21_MODEL;
}

export function resolveToapisImageRoute(model: unknown, options?: any): 'normal' | 'stable' | null {
  const identity = String(model || '').trim().toLowerCase();
  if (!isToapisImageModel(identity)) return null;
  return resolveNanoBanana21Model(identity, options) === NANO_BANANA_21_OFFICIAL_MODEL ? 'stable' : 'normal';
}

export function normalizeToapisVipQuality(quality: unknown): typeof TOAPIS_VIP_QUALITIES[number] {
  if (quality === undefined || quality === null || quality === '' || quality === 'auto') return 'high';
  const normalized = String(quality).trim().toLowerCase();
  if (!TOAPIS_VIP_QUALITIES.includes(normalized as any)) throw new BadRequestException('VIP 图片质量仅支持 low/medium/high/xhigh/max');
  return normalized as typeof TOAPIS_VIP_QUALITIES[number];
}

export function normalizeToapisImageResolution(resolution: unknown): '1K' | '2K' | '4K' {
  const normalized = String(resolution || '1K').trim().toUpperCase();
  if (normalized !== '1K' && normalized !== '2K' && normalized !== '4K') throw new BadRequestException('该图片型号仅支持 1K/2K/4K');
  return normalized;
}

export function resolveToapisImageCredits(model: unknown, params: any): number | null {
  if (!isNewToapisImageModel(model)) return null;
  const resolution = normalizeToapisImageResolution(params?.imageSize || params?.resolution);
  return isToapisVipImageModel(model)
    ? TOAPIS_VIP_IMAGE_CREDITS[normalizeToapisVipQuality(params?.quality)][resolution]
    : (resolveNanoBanana21Model(String(model), params) === NANO_BANANA_21_OFFICIAL_MODEL ? NANO_BANANA_21_OFFICIAL_CREDITS : NANO_BANANA_21_CREDITS)[resolution];
}

/** Validate before admission/precharge and again at the provider boundary. */
export function normalizeToapisImageRequest<T extends { model?: string; imageSize?: string; resolution?: string; aspectRatio?: string; size?: string; batchMode?: boolean; batchCount?: number; quality?: any; providerOptions?: any }>(request: T, referenceCount = 0): void {
  if (!isNewToapisImageModel(request.model)) return;
  request.model = resolveNanoBanana21Model(String(request.model).trim().toLowerCase(), request.providerOptions);
  const ratio = request.aspectRatio || request.size;
  if (ratio && !(isToapisVipImageModel(request.model) ? TOAPIS_VIP_ASPECT_RATIOS : NANO_BANANA_21_ASPECT_RATIOS).includes(ratio)) throw new BadRequestException('该图片型号不支持所选比例');
  if (request.batchMode && Number(request.batchCount) > 1) throw new BadRequestException('该图片型号仅支持单图生成');
  request.imageSize = normalizeToapisImageResolution(request.imageSize || request.resolution);
  if (isToapisVipImageModel(request.model)) request.quality = normalizeToapisVipQuality(request.quality);
  if (isNanoBanana21Model(request.model) && referenceCount > 14) throw new BadRequestException('Nano Banana 2.1 最多支持 14 张远程参考图');
  const imageRoute = resolveToapisImageRoute(request.model) || 'normal';
  request.providerOptions = { ...request.providerOptions, vendorKey: 'new_api', platformKey: 'new_api', bananaImageRoute: imageRoute, banana: { ...request.providerOptions?.banana, imageRoute } };
}

export function createToapisImagePricing(model: string): ManagedPricingBook | undefined {
  if (!isNewToapisImageModel(model)) return undefined;
  const vip = isToapisVipImageModel(model);
  const axes = vip ? ['quality', 'imageSize'] : ['imageSize'];
  const matrix = vip
    ? Object.fromEntries(Object.entries(TOAPIS_VIP_IMAGE_CREDITS).map(([quality, prices]) => [quality, Object.fromEntries(Object.entries(prices).map(([size, credits]) => [size, credits / 100]))]))
    : Object.fromEntries(Object.entries(model === NANO_BANANA_21_OFFICIAL_MODEL ? NANO_BANANA_21_OFFICIAL_CREDITS : NANO_BANANA_21_CREDITS).map(([size, credits]) => [size, credits / 100]));
  return {
    version: 'v2',
    dimensions: [
      ...(vip ? [{ key: 'quality', label: '质量', type: 'enum' as const, required: true, options: TOAPIS_VIP_QUALITIES.map(value => ({ value, label: value })) }] : []),
      { key: 'imageSize', label: '分辨率', type: 'enum', required: true, options: ['1K', '2K', '4K'].map(value => ({ value, label: value })) },
    ],
    matchingRules: [{ ruleKey: 'toapis-image-matrix', label: 'ToAPIs 图片价格', enabled: true, priority: 100, evaluatorKey: 'toapis-image-matrix', conditions: { all: [{ field: 'imageSize', op: 'in', value: ['1K', '2K', '4K'] }], any: [] } }],
    evaluators: { 'toapis-image-matrix': { type: 'lookup_matrix', axes, matrix } },
    displayConfig: {
      specAxes: axes,
      defaultSelections: { ...(vip ? { quality: 'high' } : {}), imageSize: '1K' },
      presets: vip ? TOAPIS_VIP_QUALITIES.flatMap(quality => ['1K', '2K', '4K'].map(imageSize => ({ quality, imageSize }))) : ['1K', '2K', '4K'].map(imageSize => ({ imageSize })),
    },
  };
}

/** Upgrade only the two Nano 2.1 retail contracts; preserve administrative flags. */
export function normalizeNano21ModelPricing<T extends { modelKey?: string; vendors?: Array<Record<string, any>> }>(model: T): T {
  if (!isNanoBanana21Model(model?.modelKey)) return model;
  const modelKey = String(model.modelKey);
  const credits = resolveToapisImageCredits(modelKey, { imageSize: '1K' })!;
  return {
    ...model,
    vendors: model.vendors?.map(vendor => vendor.vendorKey === 'new_api' ? {
      ...vendor,
      creditsPerCall: credits,
      priceYuan: credits / 100,
      pricing: {
        ...createToapisImagePricing(modelKey),
        ...(Array.isArray(vendor.pricing?.consumerPolicies) ? { consumerPolicies: vendor.pricing.consumerPolicies } : {}),
      },
    } : vendor),
  };
}
