// Shared canvas contract: controls, credit preview and execution use the same settings.
export const GPT_IMAGE_25_STANDARD_MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
export const GPT_IMAGE_25_VIP_MODELS = ["gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip"];
export const NANO_BANANA_2_MODEL = "gemini-3.1-flash-image-preview";
export const NANO_BANANA_21_MODEL = "gemini-nano-banana-2.1";
export const TOAPI_IMAGE_QUALITIES = ["low", "medium", "high", "xhigh", "max"] as const;
export type ToapiImageQuality = typeof TOAPI_IMAGE_QUALITIES[number];
export const TOAPI_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const GPT_IMAGE_25_VIP_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"];
export const NANO_BANANA_21_ASPECT_RATIOS = [...GPT_IMAGE_25_VIP_ASPECT_RATIOS, "1:4", "4:1", "1:8", "8:1"];
type ToapiImageResolution = typeof TOAPI_IMAGE_RESOLUTIONS[number];
const VIP_CREDITS: Record<ToapiImageQuality, Record<ToapiImageResolution, number>> = {
  low: { "1K": 20, "2K": 30, "4K": 40 },
  medium: { "1K": 30, "2K": 40, "4K": 50 },
  high: { "1K": 40, "2K": 60, "4K": 80 },
  xhigh: { "1K": 60, "2K": 100, "4K": 140 },
  max: { "1K": 150, "2K": 300, "4K": 450 },
};

export const isGptImage25Vip = (model?: string | null): boolean => GPT_IMAGE_25_VIP_MODELS.includes(model || "");
export const isToapiImageModel = (model?: string | null): boolean =>
  GPT_IMAGE_25_STANDARD_MODELS.includes(model || "") || isGptImage25Vip(model) || model === NANO_BANANA_21_MODEL;

export function normalizeToapiImageQuality(value?: unknown): ToapiImageQuality {
  const normalized = String(value || "").trim().toLowerCase();
  return TOAPI_IMAGE_QUALITIES.includes(normalized as ToapiImageQuality) ? normalized as ToapiImageQuality : "high";
}

export function normalizeToapiImageResolution(value?: unknown): ToapiImageResolution {
  const normalized = String(value || "").trim().toUpperCase();
  return TOAPI_IMAGE_RESOLUTIONS.includes(normalized as ToapiImageResolution) ? normalized as ToapiImageResolution : "1K";
}

export function normalizeToapiImageAspectRatio(model: string, value?: unknown): string | undefined {
  const ratio = String(value || "").trim();
  const allowed = isGptImage25Vip(model) ? GPT_IMAGE_25_VIP_ASPECT_RATIOS : model === NANO_BANANA_21_MODEL ? NANO_BANANA_21_ASPECT_RATIOS : undefined;
  if (!allowed) return ratio || undefined;
  if (!ratio) return isGptImage25Vip(model) ? "1:1" : undefined;
  return allowed.includes(ratio) ? ratio : "1:1";
}

export function getToapiImageSettings(model: string, imageSize?: unknown, quality?: unknown, aspectRatio?: unknown) {
  return {
    model,
    managedModelKey: model,
    imageSize: normalizeToapiImageResolution(imageSize),
    aspectRatio: normalizeToapiImageAspectRatio(model, aspectRatio),
    ...(isGptImage25Vip(model) ? { quality: normalizeToapiImageQuality(quality) } : {}),
    providerOptions: { banana: { imageRoute: "normal" as const } },
  };
}

export function getToapiImageFallbackCredits(model: string, imageSize?: unknown, quality?: unknown): number | undefined {
  const resolution = normalizeToapiImageResolution(imageSize);
  if (isGptImage25Vip(model)) return VIP_CREDITS[normalizeToapiImageQuality(quality)][resolution];
  if (model === NANO_BANANA_21_MODEL) return { "1K": 30, "2K": 40, "4K": 50 }[resolution];
  if (GPT_IMAGE_25_STANDARD_MODELS.includes(model)) return { "1K": 20, "2K": 30, "4K": 40 }[resolution];
  return undefined;
}
