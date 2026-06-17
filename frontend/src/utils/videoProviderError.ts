import { pickLocaleText } from "@/utils/localeText";

type VideoProviderErrorCodeCopy = {
  zh: string;
  en: string;
};

const PUBLIC_ERROR_MESSAGES: Record<string, VideoProviderErrorCodeCopy> = {
  PUBLIC_ERROR_UNDERSPECIFIED_ANIMAL: {
    zh: "动物主体描述不够明确，请补充更具体的动物、外观和动作。",
    en: "The animal subject is not specific enough. Add the animal type, appearance, and action.",
  },
};

const PUBLIC_ERROR_FALLBACK: VideoProviderErrorCodeCopy = {
  zh: "上游模型拒绝了请求，请调整提示词后重试。",
  en: "The upstream model rejected the request. Please revise the prompt and try again.",
};

const GENERIC_UPSTREAM_FALLBACK: VideoProviderErrorCodeCopy = {
  zh: "视频生成失败，请调整提示词或素材后重试。",
  en: "Video generation failed. Please revise the prompt or media and try again.",
};

const GENERIC_SERVER_ERROR_MESSAGES = new Set([
  "internal server error",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
]);

const hasCjk = (value: string): boolean => /[\u4e00-\u9fff]/.test(value);

const readPublicErrorCode = (message: string): string | null => {
  const match = message.match(/\bPUBLIC_ERROR_[A-Z0-9_]+\b/);
  return match?.[0] || null;
};

export const formatVideoProviderError = (
  rawMessage?: string | null,
  options?: { language?: string | null; fallbackZh?: string; fallbackEn?: string }
): string => {
  const language = options?.language;
  const normalized = typeof rawMessage === "string" ? rawMessage.trim() : "";
  const lower = normalized.toLowerCase();
  const fallbackZh = options?.fallbackZh || GENERIC_UPSTREAM_FALLBACK.zh;
  const fallbackEn = options?.fallbackEn || GENERIC_UPSTREAM_FALLBACK.en;

  const publicCode = normalized ? readPublicErrorCode(normalized) : null;
  if (publicCode) {
    const copy = PUBLIC_ERROR_MESSAGES[publicCode] || PUBLIC_ERROR_FALLBACK;
    return pickLocaleText(copy.zh, copy.en, language);
  }

  if (
    lower.includes("content polic") ||
    lower.includes("moderation") ||
    lower.includes("safety") ||
    lower.includes("violate") ||
    normalized.includes("内容政策") ||
    normalized.includes("内容安全") ||
    normalized.includes("违规") ||
    normalized.includes("违反")
  ) {
    return pickLocaleText(
      "素材或提示词可能触发内容安全策略，请调整后重试。",
      "The prompt or media may have triggered a content safety policy. Please revise it and try again.",
      language
    );
  }

  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
    return pickLocaleText(
      "上游请求过于频繁，请稍后重试。",
      "The upstream service is rate limited. Please try again later.",
      language
    );
  }

  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("gateway timeout") ||
    normalized.includes("超时")
  ) {
    return pickLocaleText(
      "视频生成查询超时，请稍后重试。",
      "Video generation timed out. Please try again later.",
      language
    );
  }

  if (lower.includes("insufficient credit") || lower.includes("not enough credit") || normalized.includes("积分不足")) {
    return normalized || pickLocaleText("积分不足，请先充值后重试。", "Insufficient credits. Please top up and try again.", language);
  }

  if (/^http\s*(5\d\d|4\d\d)$/i.test(normalized) || GENERIC_SERVER_ERROR_MESSAGES.has(lower)) {
    return pickLocaleText(fallbackZh, fallbackEn, language);
  }

  if (!normalized) {
    return pickLocaleText(fallbackZh, fallbackEn, language);
  }

  if (language && String(language).toLowerCase().startsWith("zh") && !hasCjk(normalized)) {
    return fallbackZh;
  }

  if (language && !String(language).toLowerCase().startsWith("zh") && hasCjk(normalized)) {
    return fallbackEn;
  }

  return normalized;
};
