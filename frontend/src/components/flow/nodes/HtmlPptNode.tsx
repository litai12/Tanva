import React from "react";
import {
  Handle,
  Position,
  useReactFlow,
  useStore,
  type Node,
  type ReactFlowState,
} from "reactflow";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FilePlus2,
  Loader2,
  Monitor,
  Palette,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type {
  AIImageGenerateRequest,
  AIImageResult,
  AIProviderOptions,
  BananaImageRoute,
} from "@/types/ai";
import { generateImageViaAPI } from "@/services/aiBackendAPI";
import { aiImageService } from "@/services/aiImageService";
import { imageUploadService } from "@/services/imageUploadService";
import {
  getImageModelForProvider,
  getTextModelForProvider,
  useAIChatStore,
} from "@/stores/aiChatStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import {
  resolveFlowModelProvider,
  type FlowModelProvider,
} from "@/utils/flowModelProvider";
import { useLocaleText } from "@/utils/localeText";
import { assertSafeHtmlPptCode } from "@/utils/htmlPptSafety";
import {
  HTML_PPT_SLIDE_TEMPLATE_OPTIONS,
  createDefaultHtmlPptDeck,
  createHtmlPptId,
  createHtmlPptSlide,
  type HtmlPptDeck,
  type HtmlPptSlide,
  type HtmlPptSlideTemplateKey,
} from "@/utils/htmlPptDeck";
import {
  findHtmlPptStylePreset,
  type HtmlPptStylePresetKey,
} from "@/utils/htmlPptStylePresets";
import {
  HTML_PPT_BOLD_TEMPLATES,
  findHtmlPptBoldTemplate,
  getHtmlPptBoldTemplate,
  type HtmlPptBoldTemplate,
  type HtmlPptBoldTemplateSlug,
} from "@/utils/htmlPptBoldTemplates";
import { resolveImageToDataUrl } from "@/utils/imageSource";
import { resolveTextFromSourceNode } from "../utils/textSource";
import RunCreditBadge from "./RunCreditBadge";
import { useBackendCreditsPreview } from "../hooks/useBackendCreditsPreview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";

type HtmlPptStatus = "idle" | "running" | "succeeded" | "failed";

type RevisionEntry = {
  id: string;
  label: string;
  createdAt: number;
  deck: HtmlPptDeck;
  currentSlideId?: string;
};

type Props = {
  id: string;
  data: {
    title?: string;
    deck?: Partial<HtmlPptDeck>;
    currentSlideId?: string;
    promptDraft?: string;
    modelProvider?: FlowModelProvider;
    status?: HtmlPptStatus;
    error?: string;
    lastResponse?: string;
    revisionHistory?: RevisionEntry[];
    creditsPerCall?: number;
    boxW?: number;
    boxH?: number;
    sizeVersion?: number;
    editScope?: "slide" | "deck";
    stylePresetKey?: HtmlPptStylePresetKey;
    boldTemplateSlug?: HtmlPptBoldTemplateSlug;
  };
  selected?: boolean;
};

const HTML_PPT_SIZE_VERSION = 2;
const HTML_PPT_DEFAULT_WIDTH = 980;
const HTML_PPT_DEFAULT_HEIGHT = 720;
const HTML_PPT_DESIGN_WIDTH_16_9 = 1920;
const HTML_PPT_DESIGN_HEIGHT_16_9 = 1080;
const HTML_PPT_DESIGN_WIDTH_4_3 = 1440;
const HTML_PPT_DESIGN_HEIGHT_4_3 = 1080;
const HTML_PPT_PREVIEW_FIT_INSET = 0.92;
const MAX_SLIDES = 24;
const MAX_CODE_LENGTH = 120_000;
const MAX_IMAGE_INPUTS = 6;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeStyleContent = (value: string): string =>
  value.replace(/<\/style/gi, "<\\/style");

const normalizeSlide = (raw: unknown, index: number): HtmlPptSlide => {
  const fallback = createHtmlPptSlide(index + 1);
  if (!raw || typeof raw !== "object") return fallback;
  const record = raw as Record<string, unknown>;
  return {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : fallback.id,
    title:
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : fallback.title,
    html: typeof record.html === "string" ? record.html : fallback.html,
    css: typeof record.css === "string" ? record.css : fallback.css,
    notes: typeof record.notes === "string" ? record.notes : undefined,
  };
};

const normalizeDeck = (raw?: Partial<HtmlPptDeck>): HtmlPptDeck => {
  const fallback = createDefaultHtmlPptDeck();
  if (!raw || typeof raw !== "object") return fallback;
  const slides = Array.isArray(raw.slides)
    ? raw.slides.map(normalizeSlide).filter((slide) => slide.id)
    : [];
  return {
    version: 1,
    aspectRatio: raw.aspectRatio === "4:3" ? "4:3" : "16:9",
    themeCss: typeof raw.themeCss === "string" ? raw.themeCss : fallback.themeCss,
    slides: slides.length ? slides.slice(0, MAX_SLIDES) : fallback.slides,
  };
};

const getRatioParts = (aspectRatio: HtmlPptDeck["aspectRatio"]) =>
  aspectRatio === "4:3" ? { w: 4, h: 3 } : { w: 16, h: 9 };

const getDesignSize = (aspectRatio: HtmlPptDeck["aspectRatio"]) =>
  aspectRatio === "4:3"
    ? { width: HTML_PPT_DESIGN_WIDTH_4_3, height: HTML_PPT_DESIGN_HEIGHT_4_3 }
    : { width: HTML_PPT_DESIGN_WIDTH_16_9, height: HTML_PPT_DESIGN_HEIGHT_16_9 };

const baseSlideRuntimeCss = (deck: HtmlPptDeck) => {
  const design = getDesignSize(deck.aspectRatio);
  return `
html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #111827;
}
body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.slide-stage {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background: #111827;
}
.slide-root {
  position: relative;
  width: ${design.width}px;
  height: ${design.height}px;
  aspect-ratio: auto;
  overflow: hidden;
  box-sizing: border-box;
  flex: 0 0 auto;
}
.slide-root *,
.slide-root *::before,
.slide-root *::after {
  box-sizing: border-box;
}
.slide-root img,
.slide-root video {
  max-width: 100%;
}
`.trim();
};

const buildSlideSrcDoc = (
  deck: HtmlPptDeck,
  slide: HtmlPptSlide,
  renderScale = 1
): string => {
  const origin = typeof window !== "undefined" ? `${window.location.origin}/` : "/";
  const design = getDesignSize(deck.aspectRatio);
  const safeScale = Number.isFinite(renderScale)
    ? Math.max(0.02, Math.min(2, renderScale))
    : 1;
  const css = [
    baseSlideRuntimeCss(deck),
    deck.themeCss || "",
    slide.css || "",
    `.slide-stage > .slide-root {
  width: ${design.width}px !important;
  height: ${design.height}px !important;
  position: absolute !important;
  left: calc(50% - ${(design.width * safeScale) / 2}px) !important;
  top: calc(50% - ${(design.height * safeScale) / 2}px) !important;
  transform: scale(${safeScale}) !important;
  transform-origin: top left !important;
}`,
  ].join("\n\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; media-src https: http:; style-src 'unsafe-inline' https: http:; font-src https: http:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <base href="${escapeHtml(origin)}">
  <title>${escapeHtml(slide.title || "HTML PPT")}</title>
  <style>${escapeStyleContent(css)}</style>
</head>
<body>
  <main class="slide-stage">
    <section class="slide-root">${slide.html || ""}</section>
  </main>
</body>
</html>`;
};

const buildFullDeckHtml = (deck: HtmlPptDeck, title: string): string => {
  const ratio = getRatioParts(deck.aspectRatio);
  const design = getDesignSize(deck.aspectRatio);
  const slides = deck.slides
    .map(
      (slide, index) => `<article class="slide-page" data-slide-index="${index}">
  <section class="slide-root" data-slide-index="${index}">
${slide.html || ""}
  </section>
  <div class="slide-page-label">${index + 1} / ${deck.slides.length}</div>
</article>`
    )
    .join("\n");
  const slideCss = deck.slides
    .map((slide, index) => `.slide-root[data-slide-index="${index}"] {\n}\n${slide.css || ""}`)
    .join("\n\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title || "HTML PPT")}</title>
  <style>
${escapeStyleContent(baseSlideRuntimeCss(deck))}
body {
  margin: 0;
  background: #0f172a;
  color: #e2e8f0;
  overflow-x: hidden;
  overflow-y: auto;
}
.deck-export {
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  padding: 32px 0 56px;
  box-sizing: border-box;
  scroll-snap-type: y proximity;
}
.slide-page {
  --slide-scale: 1;
  width: calc(${design.width}px * var(--slide-scale));
  height: calc(${design.height}px * var(--slide-scale));
  position: relative;
  flex: 0 0 auto;
  scroll-snap-align: start;
}
.slide-root {
  display: block;
  width: ${design.width}px;
  height: ${design.height}px;
  aspect-ratio: auto;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 4px;
  position: relative;
  background: #ffffff;
  transform: scale(var(--slide-scale));
  transform-origin: top left;
}
.slide-page.is-active .slide-root {
  outline: 2px solid rgba(37, 99, 235, 0.55);
  outline-offset: 6px;
}
.slide-page-label {
  position: absolute;
  top: calc(14px * var(--slide-scale));
  right: calc(14px * var(--slide-scale));
  z-index: 3;
  padding: calc(4px * var(--slide-scale)) calc(8px * var(--slide-scale));
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.82);
  color: #fff;
  font-size: calc(12px * var(--slide-scale));
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
}
.deck-counter { position: fixed; right: 18px; bottom: 14px; color: #cbd5e1; font: 12px/1.2 ui-sans-serif, system-ui; }
@media print {
  body { background: #fff; }
  .deck-export { display: block; width: auto; min-height: auto; padding: 0; }
  .deck-counter { display: none; }
  .slide-page {
    width: 100vw;
    height: calc(100vw * ${ratio.h} / ${ratio.w});
    page-break-after: always;
    break-after: page;
  }
  .slide-root {
    display: block !important;
    transform: scale(calc(100vw / ${design.width}px));
    box-shadow: none;
    border-radius: 0;
    outline: none;
  }
  .slide-page-label { display: none; }
}
${escapeStyleContent(deck.themeCss || "")}
${escapeStyleContent(slideCss)}
html,
body {
  margin: 0 !important;
  width: 100% !important;
  min-height: 100% !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  background: #0f172a !important;
}
.deck-export .slide-root {
  width: ${design.width}px !important;
  height: ${design.height}px !important;
  transform: scale(var(--slide-scale)) !important;
  transform-origin: top left !important;
}
@media print {
  .slide-page {
    width: ${design.width}px !important;
    height: ${design.height}px !important;
  }
  .deck-export .slide-root {
    transform: none !important;
  }
}
  </style>
</head>
<body>
  <main class="deck-export">${slides}</main>
  <div class="deck-counter" id="deckCounter"></div>
  <script>
    const pages = Array.from(document.querySelectorAll(".slide-page"));
    const slides = Array.from(document.querySelectorAll(".slide-root"));
    let index = 0;
    function applySlideScale() {
      const availableWidth = Math.max(320, window.innerWidth - 64);
      const availableHeight = Math.max(240, window.innerHeight - 64);
      const scale = Math.max(0.2, Math.min(availableWidth / ${design.width}, availableHeight / ${design.height}));
      pages.forEach((page) => page.style.setProperty("--slide-scale", String(scale)));
    }
    function setActive(next) {
      index = Math.max(0, Math.min(pages.length - 1, next));
      pages.forEach((page, i) => page.classList.toggle("is-active", i === index));
      const counter = document.getElementById("deckCounter");
      if (counter) counter.textContent = (index + 1) + " / " + pages.length;
    }
    function show(next) {
      setActive(next);
      pages[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const observer = new IntersectionObserver((entries) => {
      let best = null;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
      }
      if (!best) return;
      const next = pages.indexOf(best.target);
      if (next >= 0 && next !== index) {
        setActive(next);
      }
    }, { threshold: [0.45, 0.6, 0.75] });
    pages.forEach((page) => observer.observe(page));
    window.addEventListener("resize", applySlideScale);
    window.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") show(index + 1);
      if (event.key === "ArrowLeft" || event.key === "PageUp") show(index - 1);
    });
    applySlideScale();
    setActive(0);
  </script>
</body>
</html>`;
};

const stopFlowPan = (event: React.SyntheticEvent<Element, Event>) => {
  event.stopPropagation();
  const native = event.nativeEvent as Event & {
    stopImmediatePropagation?: () => void;
  };
  native.stopImmediatePropagation?.();
};

const extractJsonPayload = (
  text: string,
  errorMessage = "Ultra did not return a JSON patch."
): Record<string, unknown> => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(errorMessage);
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
};

const pickString = (
  record: Record<string, unknown>,
  keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

type IncomingImageRef = {
  id: string;
  raw: string;
  sourceTitle?: string;
  embeddableUrl?: string;
};

type PreparedIncomingImage = IncomingImageRef & {
  visionRef: string;
  embeddableUrl?: string;
  uploaded?: boolean;
  generatedAsset?: {
    role: HtmlPptGeneratedAssetRole;
    reason?: string;
    prompt: string;
  };
};

type HtmlPptGeneratedAssetRole =
  | "cover_hero"
  | "section_visual"
  | "background"
  | "diagram"
  | "icon_set"
  | "comparison"
  | "other";

type HtmlPptGeneratedAssetRequest = {
  role: HtmlPptGeneratedAssetRole;
  target: "slide" | "deck";
  targetSlideId?: string;
  targetSlideTitle?: string;
  prompt: string;
  aspectRatio?: AIImageGenerateRequest["aspectRatio"];
  style?: string;
};

type HtmlPptGeneratedAssetPlan = {
  shouldGenerateImages: boolean;
  reason?: string;
  assets: HtmlPptGeneratedAssetRequest[];
};

type HtmlPptAutoAssetIntent = {
  shouldPlan: boolean;
  explicit: boolean;
};

type HtmlPptAiStyleGuide = {
  label: string;
  description: string;
  tags: string[];
  colors: {
    background: string;
    text: string;
    accent: string;
    secondary: string;
  };
  themeCss: string;
  promptGuidance: string;
  imagePrompt: string;
  previewSlide: Pick<HtmlPptSlide, "title" | "html" | "css">;
  previewSlides?: Array<Pick<HtmlPptSlide, "title" | "html" | "css">>;
};

type HtmlPptStylePreviewItem = Pick<
  HtmlPptAiStyleGuide,
  "label" | "description" | "colors" | "themeCss" | "previewSlide" | "previewSlides"
> & {
  id: string;
  author?: string;
};

const HTML_PPT_GENERATED_ASSET_LIMIT = 1;

const HTML_PPT_ASPECT_RATIOS = new Set<NonNullable<AIImageGenerateRequest["aspectRatio"]>>([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
  "2:1",
  "1:2",
  "9:21",
  "4:1",
  "1:4",
  "8:1",
  "1:8",
]);

const HTML_PPT_GENERATED_ASSET_ROLES = new Set<HtmlPptGeneratedAssetRole>([
  "cover_hero",
  "section_visual",
  "background",
  "diagram",
  "icon_set",
  "comparison",
  "other",
]);

const AUTO_ASSET_NEGATIVE_PATTERNS = [
  /不要(?:生成|生)(?:图|图片|视觉素材)/i,
  /不需要(?:生成|生)(?:图|图片|视觉素材)/i,
  /无需(?:生成|生)(?:图|图片|视觉素材)/i,
  /只(?:改|修改|调整)(?:文字|文案|排版|布局|样式)/i,
  /\bno\s+(?:image|images|visual|visuals)\b/i,
  /\btext\s+only\b/i,
] as const;

const AUTO_ASSET_EXPLICIT_PATTERNS = [
  /(?:先)?(?:调用|用).*(?:生图|图片生成|生成图片)/i,
  /(?:生成|生|画|绘制|创建|补一张|配一张).{0,12}(?:图|图片|视觉素材|主视觉|背景|插画|海报)/i,
  /(?:主视觉|封面图|背景图|配图|插画|海报|场景图|视觉素材)/i,
  /\b(?:generate|create|make|draw)\s+(?:an?\s+)?(?:image|visual|illustration|hero|background)\b/i,
] as const;

const AUTO_ASSET_CANDIDATE_PATTERNS = [
  /(?:封面|首页|开场|发布会|品牌|产品|提案|pitch|keynote|deck|ppt|演示文稿)/i,
  /(?:高级|未来|科技|概念|氛围|视觉|场景|广告|campaign|launch|hero|visual)/i,
] as const;

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const isHttpImageRef = (value: string): boolean => /^https?:\/\//i.test(value.trim());

const getBananaImageRouteOption = (
  bananaImageRoute?: string | null
): BananaImageRoute =>
  bananaImageRoute === "stable" ? "stable" : "normal";

const buildBananaProviderOptions = (
  bananaImageRoute?: string | null
): AIProviderOptions => {
  const route = getBananaImageRouteOption(bananaImageRoute);
  return {
    banana: {
      imageRoute: route,
    },
    bananaImageRoute: route,
  };
};

const boldTemplateToStyleGuide = (
  template: HtmlPptBoldTemplate
): HtmlPptAiStyleGuide => ({
  label: template.name,
  description: template.tagline,
  tags: template.tags.slice(0, 8),
  colors: {
    background: template.colors.background,
    text: template.colors.text,
    accent: template.colors.accent,
    secondary: template.colors.secondary,
  },
  themeCss: template.themeCss,
  promptGuidance: template.promptGuidance,
  imagePrompt: template.imagePrompt,
  previewSlide: template.previewSlide,
  previewSlides: template.previewSlides,
});

const getAutoAssetIntent = (
  instruction: string,
  incomingImageCount: number
): HtmlPptAutoAssetIntent => {
  const source = instruction.trim();
  if (!source) return { shouldPlan: false, explicit: false };
  if (AUTO_ASSET_NEGATIVE_PATTERNS.some((pattern) => pattern.test(source))) {
    return { shouldPlan: false, explicit: false };
  }

  const explicit = AUTO_ASSET_EXPLICIT_PATTERNS.some((pattern) => pattern.test(source));
  if (explicit) return { shouldPlan: true, explicit: true };
  if (incomingImageCount > 0) return { shouldPlan: false, explicit: false };

  const candidateScore = AUTO_ASSET_CANDIDATE_PATTERNS.reduce(
    (score, pattern) => score + (pattern.test(source) ? 1 : 0),
    0
  );
  return { shouldPlan: candidateScore >= 2, explicit: false };
};

const normalizeGeneratedAssetRole = (value: unknown): HtmlPptGeneratedAssetRole => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (HTML_PPT_GENERATED_ASSET_ROLES.has(normalized as HtmlPptGeneratedAssetRole)) {
      return normalized as HtmlPptGeneratedAssetRole;
    }
  }
  return "other";
};

const normalizeGeneratedAssetAspectRatio = (
  value: unknown,
  fallback: HtmlPptDeck["aspectRatio"]
): AIImageGenerateRequest["aspectRatio"] => {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (HTML_PPT_ASPECT_RATIOS.has(normalized as NonNullable<AIImageGenerateRequest["aspectRatio"]>)) {
      return normalized as AIImageGenerateRequest["aspectRatio"];
    }
  }
  return fallback;
};

const buildDeckOutlineForAssetPlan = (deck: HtmlPptDeck): string =>
  deck.slides.map((slide, index) => `${index + 1}. ${slide.id}: ${slide.title}`).join("\n");

const buildStylePresetPromptSection = (
  stylePreset?: HtmlPptAiStyleGuide | null
): string => {
  if (!stylePreset) return "";
  return `风格预设:
- 名称: ${stylePreset.label}
- 用途: ${stylePreset.description}
- 标签: ${stylePreset.tags.join(", ")}
- 视觉规则: ${stylePreset.promptGuidance}
- 已选 preset 的 themeCss 已写入当前 deck；除非用户明确要求换风格，否则不要删除或改写这套视觉语言。
- 优先使用清晰的语义 class（如 ppt-kicker、ppt-lede、ppt-stat-row），并保证每页在固定 PPT 画布内不溢出。`;
};

const buildGeneratedAssetPlanPrompt = ({
  instruction,
  deck,
  currentSlide,
  editScope,
  incomingContext,
  preparedImages,
  stylePreset,
}: {
  instruction: string;
  deck: HtmlPptDeck;
  currentSlide: HtmlPptSlide;
  editScope: "slide" | "deck";
  incomingContext: string;
  preparedImages: PreparedIncomingImage[];
  stylePreset?: HtmlPptAiStyleGuide | null;
}): string => `你是 Tanva HTML PPT 的视觉素材规划器。你只判断是否需要先生成一张图片素材，再交给下一步 HTML PPT 排版模型使用。请只返回合法 JSON，不要使用 Markdown，不要解释。

返回 JSON schema:
{
  "shouldGenerateImages": true,
  "reason": "一句话说明为什么需要或不需要生图",
  "assets": [
    {
      "role": "cover_hero | section_visual | background | diagram | icon_set | comparison | other",
      "target": "slide | deck",
      "targetSlideId": "可选，目标页 id",
      "targetSlideTitle": "可选，目标页标题",
      "prompt": "给生图模型的完整视觉提示词",
      "aspectRatio": "${deck.aspectRatio}",
      "style": "可选风格"
    }
  ]
}

判断规则:
- 只有当用户明确需要生成/补充图片、主视觉、背景图、插画、场景图、海报或概念视觉，或缺少该素材会明显影响 PPT 成品时，shouldGenerateImages 才能为 true。
- 如果用户只是要求改文字、调排版、改样式、总结内容、拆页、换比例，返回 false。
- 如果已有上游图片足够完成用户意图，返回 false；除非用户明确要求基于上游图再生成一张新视觉。
- 最多规划 ${HTML_PPT_GENERATED_ASSET_LIMIT} 张图。
- 生图 prompt 不要要求图片内出现可读文字、标题、logo、水印或 UI 字；PPT 文案会由 HTML/CSS 叠加。
- 生成图应适合 ${deck.aspectRatio} PPT 页面排版，留出标题和正文叠加空间。
- 精确流程图、表格、数据图、文字图标优先交给 HTML/CSS 绘制，不要生图。

当前编辑范围: ${editScope === "deck" ? "整套 deck" : "当前页"}
当前页: ${currentSlide.id}: ${currentSlide.title}
页面目录:
${buildDeckOutlineForAssetPlan(deck)}

${buildStylePresetPromptSection(stylePreset)}

已有上游图片数量: ${preparedImages.length}
${incomingContext ? `上游图文上下文:\n${incomingContext}\n\n` : ""}用户要求:
${instruction}`;

const normalizeGeneratedAssetPlan = (
  parsed: Record<string, unknown>,
  deck: HtmlPptDeck
): HtmlPptGeneratedAssetPlan => {
  const shouldGenerateImages = parsed.shouldGenerateImages === true;
  const rawAssets = Array.isArray(parsed.assets) ? parsed.assets : [];
  const assets = rawAssets
    .filter((asset): asset is Record<string, unknown> => Boolean(asset && typeof asset === "object"))
    .map((asset): HtmlPptGeneratedAssetRequest | null => {
      const prompt = normalizeString(asset.prompt);
      if (!prompt) return null;
      const rawTarget = normalizeString(asset.target);
      const target = rawTarget === "deck" ? "deck" : "slide";
      return {
        role: normalizeGeneratedAssetRole(asset.role),
        target,
        targetSlideId: normalizeString(asset.targetSlideId),
        targetSlideTitle: normalizeString(asset.targetSlideTitle),
        prompt,
        aspectRatio: normalizeGeneratedAssetAspectRatio(asset.aspectRatio, deck.aspectRatio),
        style: normalizeString(asset.style),
      };
    })
    .filter((asset): asset is HtmlPptGeneratedAssetRequest => Boolean(asset))
    .slice(0, HTML_PPT_GENERATED_ASSET_LIMIT);

  return {
    shouldGenerateImages: shouldGenerateImages && assets.length > 0,
    reason: normalizeString(parsed.reason),
    assets,
  };
};

const buildFallbackGeneratedAssetPlan = (
  instruction: string,
  deck: HtmlPptDeck,
  currentSlide: HtmlPptSlide,
  editScope: "slide" | "deck"
): HtmlPptGeneratedAssetPlan => ({
  shouldGenerateImages: true,
  reason: "用户明确要求生成视觉素材。",
  assets: [
    {
      role: /封面|首页|主视觉|hero/i.test(instruction) ? "cover_hero" : "section_visual",
      target: editScope,
      targetSlideId: editScope === "slide" ? currentSlide.id : undefined,
      targetSlideTitle: editScope === "slide" ? currentSlide.title : undefined,
      aspectRatio: deck.aspectRatio,
      prompt: [
        `Create a presentation-ready visual asset for this user intent: ${instruction}`,
        `Aspect ratio ${deck.aspectRatio}.`,
        "No readable text, captions, logos, watermarks, UI screenshots, or typography inside the image.",
        "Leave clean negative space for HTML title and copy overlays.",
        "Polished, commercially usable, high-resolution composition.",
      ].join(" "),
    },
  ],
});

const buildGeneratedImagePrompt = (
  asset: HtmlPptGeneratedAssetRequest,
  instruction: string,
  deck: HtmlPptDeck,
  referenceImageCount: number,
  stylePreset?: HtmlPptAiStyleGuide | null
): string => [
  "Generate one visual asset for an HTML PPT slide.",
  `User intent: ${instruction}`,
  `Asset role: ${asset.role}.`,
  asset.targetSlideTitle ? `Target slide: ${asset.targetSlideTitle}.` : "",
  `Deck aspect ratio: ${deck.aspectRatio}.`,
  asset.style ? `Style direction: ${asset.style}.` : "",
  stylePreset
    ? `Presentation style preset: ${stylePreset.label}. ${stylePreset.imagePrompt}`
    : "",
  referenceImageCount > 0
    ? "Use the provided reference image(s) only to understand subject, style, product, or composition intent."
    : "",
  `Visual prompt: ${asset.prompt}`,
  "Critical constraints: no readable text, no typography, no captions, no logos, no watermarks, no UI text. The PPT text will be overlaid in HTML/CSS. Leave usable negative space for title and body copy.",
]
  .filter(Boolean)
  .join("\n");

const resolveGeneratedImageUrl = async (
  result: AIImageResult,
  projectId?: string | null
): Promise<string> => {
  const metadataImageUrl =
    result.metadata && typeof result.metadata.imageUrl === "string"
      ? result.metadata.imageUrl.trim()
      : "";
  const directUrl = normalizeString(result.imageUrl) || normalizeString(metadataImageUrl);
  if (directUrl && isHttpImageRef(directUrl)) return directUrl;

  const imageData = normalizeString(result.imageData);
  if (!imageData) {
    throw new Error("Image generation finished but did not return an image URL.");
  }

  const uploadDir = projectId
    ? `projects/${projectId}/flow/html-ppt/generated/`
    : "uploads/flow/html-ppt/generated/";
  const uploadResult = await imageUploadService.uploadImageSource(imageData, {
    projectId: projectId ?? undefined,
    dir: uploadDir,
    fileName: `html-ppt-generated-${Date.now()}.png`,
    maxFileSize: 32 * 1024 * 1024,
  });
  const uploadedUrl = uploadResult.success ? uploadResult.asset?.url?.trim() : "";
  if (!uploadedUrl) {
    throw new Error(uploadResult.error || "Generated image upload failed.");
  }
  return uploadedUrl;
};

const createGeneratedPreparedImage = ({
  asset,
  url,
  reason,
}: {
  asset: HtmlPptGeneratedAssetRequest;
  url: string;
  reason?: string;
}): PreparedIncomingImage => ({
  id: `html-ppt-generated-${Date.now()}`,
  raw: url,
  sourceTitle: `AI generated ${asset.role.replace(/_/g, " ")}`,
  visionRef: url,
  embeddableUrl: url,
  uploaded: true,
  generatedAsset: {
    role: asset.role,
    reason,
    prompt: asset.prompt,
  },
});


const imageHandleIndex = (handle?: string | null): number | null => {
  if (!handle) return null;
  const match = handle.trim().toLowerCase().match(/^(?:image|img|frame)-?(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return Number.isFinite(index) && index >= 0 ? index : null;
};

const firstImageValue = (value: unknown): string | undefined => {
  const direct = normalizeString(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return (
    normalizeString(record.imageUrl) ||
    normalizeString(record.imageData) ||
    normalizeString(record.outputImage) ||
    normalizeString(record.thumbnailDataUrl) ||
    normalizeString(record.thumbnail)
  );
};

const collectImageRefsFromSourceNode = (
  node: Node | null | undefined,
  sourceHandle?: string | null
): IncomingImageRef[] => {
  if (!node) return [];
  const data = ((node.data || {}) as Record<string, unknown>);
  const refs: IncomingImageRef[] = [];
  const seen = new Set<string>();
  const title =
    normalizeString(data.title) ||
    normalizeString(data.name) ||
    normalizeString(data.prompt) ||
    node.type ||
    node.id;

  const push = (value: unknown, suffix: string) => {
    const raw = firstImageValue(value);
    if (!raw || seen.has(raw)) return;
    seen.add(raw);
    refs.push({
      id: `${node.id}-${suffix}`,
      raw,
      sourceTitle: title,
      embeddableUrl: isHttpImageRef(raw) ? raw : undefined,
    });
  };

  const pushArrayItem = (key: string, index: number) => {
    const list = Array.isArray(data[key]) ? data[key] : [];
    push(list[index], `${key}-${index + 1}`);
  };

  const indexed = imageHandleIndex(sourceHandle);
  if (indexed !== null) {
    push(data[`image${indexed + 1}`], `image${indexed + 1}`);
    push(data[`img${indexed + 1}`], `img${indexed + 1}`);
    pushArrayItem("imageUrls", indexed);
    pushArrayItem("images", indexed);
    pushArrayItem("thumbnails", indexed);
    pushArrayItem("frames", indexed);
    return refs;
  }

  if (sourceHandle === "images" || sourceHandle === "images-range") {
    ["imageUrls", "images", "frames", "thumbnails"].forEach((key) => {
      const list = Array.isArray(data[key]) ? data[key] : [];
      list.slice(0, MAX_IMAGE_INPUTS).forEach((item, index) => push(item, `${key}-${index + 1}`));
    });
    return refs;
  }

  push(data.imageUrl, "imageUrl");
  push(data.imageData, "imageData");
  push(data.outputImage, "outputImage");
  ["imageUrls", "images", "frames", "thumbnails"].forEach((key) => {
    const list = Array.isArray(data[key]) ? data[key] : [];
    list.slice(0, MAX_IMAGE_INPUTS).forEach((item, index) => push(item, `${key}-${index + 1}`));
  });

  return refs;
};

const buildIncomingImageContext = (images: PreparedIncomingImage[]): string => {
  if (!images.length) return "";
  const lines = images.map((image, index) => {
    const label = `Image ${index + 1}`;
    const source = image.sourceTitle ? ` from ${image.sourceTitle}` : "";
    const generatedDetail = image.generatedAsset
      ? `；这是系统按用户意图先生成的视觉素材，角色=${image.generatedAsset.role}${
          image.generatedAsset.reason ? `，原因=${image.generatedAsset.reason}` : ""
        }，必须实际排入目标 PPT 页面`
      : "";
    if (image.embeddableUrl) {
      return `${label}${source}: 必须作为可用视觉素材纳入版式${generatedDetail}；HTML 中用该远程 URL 引用: ${image.embeddableUrl}`;
    }
    return `${label}${source}: 仅作为本次视觉理解输入，不要把运行时 data/blob/base64 写入 HTML。`;
  });
  return `上游图片输入:\n${lines.join("\n")}\n\n图片排版要求:\n- 先判断用户语义意图：封面、产品介绍、案例展示、图集、对比、流程、报告摘要等。\n- 根据意图决定每张图片的角色：主视觉、证据图、步骤图、背景图、对比图或缩略图组。\n- 对标注为远程 URL 的图片，不要只描述，应该实际排入 HTML 页面；多图时按语义分组、裁切比例和视觉层级排版。`;
};

const prepareImageRefsForAi = async (
  images: IncomingImageRef[],
  projectId?: string | null
): Promise<PreparedIncomingImage[]> => {
  const prepared: PreparedIncomingImage[] = [];
  const seen = new Set<string>();
  for (const [index, image] of images.slice(0, MAX_IMAGE_INPUTS).entries()) {
    const raw = image.raw.trim();
    if (!raw) continue;
    if (isHttpImageRef(raw)) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      prepared.push({ ...image, visionRef: raw, embeddableUrl: raw });
      continue;
    }

    const uploadDir = projectId
      ? `projects/${projectId}/flow/html-ppt/images/`
      : "uploads/flow/html-ppt/images/";
    const uploadResult = await imageUploadService.uploadImageSource(raw, {
      projectId: projectId ?? undefined,
      dir: uploadDir,
      fileName: `html-ppt-input-${index + 1}-${Date.now()}.png`,
      maxFileSize: 32 * 1024 * 1024,
    });
    const uploadedUrl = uploadResult.success ? uploadResult.asset?.url?.trim() : "";
    if (uploadedUrl) {
      if (seen.has(uploadedUrl)) continue;
      seen.add(uploadedUrl);
      prepared.push({
        ...image,
        visionRef: uploadedUrl,
        embeddableUrl: uploadedUrl,
        uploaded: true,
      });
      continue;
    }

    const resolved = await resolveImageToDataUrl(raw, { preferProxy: true });
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    prepared.push({ ...image, visionRef: resolved, embeddableUrl: undefined });
  }
  return prepared;
};

const HTML_DOCUMENT_MARKER_PATTERN = /<(?:!doctype|html|head|body|style)\b/i;
const ACTIVE_HTML_TAGS = ["script", "iframe", "object", "embed", "base"] as const;

const stripActiveHtmlElements = (value: string): string => {
  let next = value;
  ACTIVE_HTML_TAGS.forEach((tag) => {
    next = next
      .replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), "")
      .replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "");
  });
  return next;
};

const extractStyleBlocks = (value: string): string[] =>
  Array.from(value.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1]?.trim())
    .filter((item): item is string => Boolean(item));

const stripStyleBlocks = (value: string): string =>
  value.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

const removeUnsafeHtmlNodes = (root: ParentNode) => {
  ACTIVE_HTML_TAGS.forEach((tag) => {
    root.querySelectorAll(tag).forEach((node) => node.remove());
  });
  root.querySelectorAll("style").forEach((node) => node.remove());
};

const readElementTitle = (element: Element, fallback: string): string => {
  const explicit =
    normalizeString(element.getAttribute("data-title")) ||
    normalizeString(element.getAttribute("aria-label"));
  if (explicit) return explicit.slice(0, 80);
  const heading = element.querySelector("h1,h2,h3");
  const text = normalizeString(heading?.textContent);
  return text ? text.slice(0, 80) : fallback;
};

const fallbackExtractHtmlBody = (value: string): string => {
  const withoutDoctype = value.replace(/<!doctype[^>]*>/gi, "");
  const bodyMatch = withoutDoctype.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const source = bodyMatch?.[1] || withoutDoctype;
  return stripActiveHtmlElements(stripStyleBlocks(source))
    .replace(/<\/?(?:html|head|body|main)\b[^>]*>/gi, "")
    .trim();
};

const convertHtmlDocumentToSlideParts = (
  rawHtml: string,
  rawCss?: string
): { html: string; css: string } => {
  const html = rawHtml.trim();
  const css = normalizeString(rawCss) || "";
  if (!HTML_DOCUMENT_MARKER_PATTERN.test(html)) {
    return { html: rawHtml, css };
  }

  const styleCss = extractStyleBlocks(html).join("\n\n");
  let fragment = "";
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      removeUnsafeHtmlNodes(doc);
      const root =
        doc.querySelector(".slide-root") ||
        doc.querySelector(".slide-page") ||
        doc.querySelector("main") ||
        doc.body;
      if (root) {
        removeUnsafeHtmlNodes(root);
        fragment =
          root.classList.contains("slide-root") && root instanceof HTMLElement
            ? root.innerHTML
            : root.querySelector(".slide-root")?.innerHTML || root.innerHTML;
      }
    } catch {
      fragment = "";
    }
  }
  if (!fragment) {
    fragment = fallbackExtractHtmlBody(html);
  }

  return {
    html: stripActiveHtmlElements(stripStyleBlocks(fragment)).trim() || rawHtml,
    css: [styleCss, css].filter((item) => item.trim().length > 0).join("\n\n"),
  };
};

const convertHtmlDocumentToDeck = (
  rawHtml: string,
  currentDeck: HtmlPptDeck
): { slides: HtmlPptSlide[]; themeCss: string } | null => {
  const html = rawHtml.trim();
  if (!HTML_DOCUMENT_MARKER_PATTERN.test(html) || typeof DOMParser === "undefined") {
    return null;
  }

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const themeCss = extractStyleBlocks(html).join("\n\n");
    removeUnsafeHtmlNodes(doc);
    const candidates = Array.from(
      doc.querySelectorAll(".slide-root, .slide-page, article.slide, section.slide")
    );
    const slideElements = candidates.length
      ? candidates.filter((element, index, list) => {
          if (element.classList.contains("slide-root")) return true;
          return !element.querySelector(".slide-root") || list.length === 1;
        })
      : doc.body
      ? [doc.body]
      : [];
    const seen = new Set<Element>();
    const slides: HtmlPptSlide[] = [];

    slideElements.slice(0, MAX_SLIDES).forEach((element, index) => {
      const root = element.classList.contains("slide-root")
        ? element
        : element.querySelector(".slide-root") || element;
      if (!root || seen.has(root)) return;
      seen.add(root);
      removeUnsafeHtmlNodes(root);
      const fallback = currentDeck.slides[index] || createHtmlPptSlide(index + 1);
      const slide: HtmlPptSlide = {
        id: fallback.id || createHtmlPptId("slide"),
        title: readElementTitle(root, fallback.title || `Slide ${index + 1}`),
        html: stripActiveHtmlElements(stripStyleBlocks(root.innerHTML)).trim(),
        css: "",
        notes: fallback.notes,
      };
      if (slide.html) slides.push(slide);
    });

    return slides.length ? { slides, themeCss } : null;
  } catch {
    return null;
  }
};

const normalizeAiSlidePatch = (
  parsed: Record<string, unknown>,
  currentSlideId: string
): Partial<HtmlPptSlide> => {
  const patch =
    parsed.patch && typeof parsed.patch === "object"
      ? (parsed.patch as Record<string, unknown>)
      : parsed;
  const slides = Array.isArray(parsed.slides) ? parsed.slides : undefined;
  const matchedSlide = slides
    ?.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .find((item) => item.id === currentSlideId);
  const source = matchedSlide || patch;

  const next: Partial<HtmlPptSlide> = {
    title: pickString(source, ["title", "slideTitle"]),
    html: pickString(source, ["html", "slideHtml", "body"]),
    css: pickString(source, ["css", "slideCss", "style"]),
    notes: pickString(source, ["notes", "speakerNotes"]),
  };

  if (!next.title && !next.html && !next.css && !next.notes) {
    throw new Error("Ultra JSON patch did not include title, html, css, or notes.");
  }

  if (next.html !== undefined) {
    const converted = convertHtmlDocumentToSlideParts(next.html, next.css);
    next.html = converted.html;
    next.css = converted.css;
  }

  if (next.html !== undefined) assertSafeHtmlPptCode(next.html, "Slide HTML");
  if (next.css !== undefined) assertSafeHtmlPptCode(next.css, "Slide CSS");

  const totalLength = (next.html || "").length + (next.css || "").length;
  if (totalLength > MAX_CODE_LENGTH) {
    throw new Error("Slide patch is too large.");
  }

  return next;
};

const normalizeAiDeckPatch = (
  parsed: Record<string, unknown>,
  currentDeck: HtmlPptDeck
): HtmlPptDeck => {
  const deckRecord =
    parsed.deck && typeof parsed.deck === "object"
      ? (parsed.deck as Record<string, unknown>)
      : parsed;
  const rawSlides = Array.isArray(parsed.slides)
    ? parsed.slides
    : Array.isArray(deckRecord.slides)
    ? deckRecord.slides
    : undefined;

  if (!rawSlides?.length) {
    const rawDeckHtml =
      pickString(deckRecord, ["html", "deckHtml", "document", "fullHtml"]) ||
      pickString(parsed, ["html", "deckHtml", "document", "fullHtml"]);
    const convertedDeck = rawDeckHtml
      ? convertHtmlDocumentToDeck(rawDeckHtml, currentDeck)
      : null;
    if (convertedDeck) {
      const themeCss = convertedDeck.themeCss || currentDeck.themeCss;
      assertSafeHtmlPptCode(themeCss, "Deck theme CSS");
      convertedDeck.slides.forEach((slide) => {
        assertSafeHtmlPptCode(slide.html, "Slide HTML");
        assertSafeHtmlPptCode(slide.css, "Slide CSS");
      });
      const totalLength = convertedDeck.slides.reduce(
        (sum, slide) => sum + slide.html.length + slide.css.length + (slide.notes || "").length,
        themeCss.length
      );
      if (totalLength > MAX_CODE_LENGTH * 2) {
        throw new Error("Deck patch is too large.");
      }
      return {
        version: 1,
        aspectRatio: currentDeck.aspectRatio,
        themeCss,
        slides: convertedDeck.slides.slice(0, MAX_SLIDES),
      };
    }
    throw new Error("Ultra JSON patch did not include deck slides.");
  }

  const seenSlideIds = new Set<string>();
  const slides = rawSlides.slice(0, MAX_SLIDES).map((raw, index): HtmlPptSlide => {
    const fallback = currentDeck.slides[index] || createHtmlPptSlide(index + 1);
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const rawId =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : fallback.id;
    const id = seenSlideIds.has(rawId) ? createHtmlPptId("slide") : rawId;
    seenSlideIds.add(id);
    const slide: HtmlPptSlide = {
      id,
      title:
        typeof record.title === "string" && record.title.trim()
          ? record.title.trim()
          : fallback.title,
      html: typeof record.html === "string" ? record.html : fallback.html,
      css: typeof record.css === "string" ? record.css : fallback.css,
      notes: typeof record.notes === "string" ? record.notes : fallback.notes,
    };
    const converted = convertHtmlDocumentToSlideParts(slide.html, slide.css);
    slide.html = converted.html;
    slide.css = converted.css;
    assertSafeHtmlPptCode(slide.html, "Slide HTML");
    assertSafeHtmlPptCode(slide.css, "Slide CSS");
    return slide;
  });

  const rawAspectRatio =
    typeof deckRecord.aspectRatio === "string"
      ? deckRecord.aspectRatio
      : typeof parsed.aspectRatio === "string"
      ? parsed.aspectRatio
      : undefined;
  const aspectRatio =
    rawAspectRatio === "4:3"
      ? "4:3"
      : rawAspectRatio === "16:9"
      ? "16:9"
      : currentDeck.aspectRatio;
  const themeCss =
    typeof deckRecord.themeCss === "string"
      ? deckRecord.themeCss
      : typeof parsed.themeCss === "string"
      ? parsed.themeCss
      : currentDeck.themeCss;
  assertSafeHtmlPptCode(themeCss, "Deck theme CSS");

  const totalLength = slides.reduce(
    (sum, slide) => sum + slide.html.length + slide.css.length + (slide.notes || "").length,
    themeCss.length
  );
  if (totalLength > MAX_CODE_LENGTH * 2) {
    throw new Error("Deck patch is too large.");
  }

  return {
    version: 1,
    aspectRatio,
    themeCss,
    slides,
  };
};

const buildAiPrompt = (
  instruction: string,
  deck: HtmlPptDeck,
  slide: HtmlPptSlide,
  incomingContext: string,
  stylePreset?: HtmlPptAiStyleGuide | null
): string => {
  const outline = deck.slides
    .map((item, index) => `${index + 1}. ${item.id}: ${item.title}`)
    .join("\n");
  return `你是 Tanva 的 HTML PPT 页面代码编辑器。请只修改当前选中的这一页，并只返回合法 JSON，不要使用 Markdown，不要解释。

返回 JSON schema:
{
  "action": "replace_slide",
  "slideId": "${slide.id}",
  "title": "短标题",
  "html": "当前页 <section> 内部 HTML 片段，不要包含 html/head/body/script/iframe/base/object/embed",
  "css": "当前页 CSS，可使用 .slide-root 作为根容器",
  "notes": "可选备注"
}

硬性规则:
- 这是 ${deck.aspectRatio} 的演示页，视觉必须适合 PPT 页面。
- 不要输出 <script>、事件属性、iframe、object、embed、base、javascript:。
- 不要使用 data:、blob:、base64 图片；如需图片，只能使用远程 http(s) URL 或项目路径。
- 保持 HTML/CSS 自包含，不依赖外部 JS。
- 不要改其它页面。
- 如果有上游图片，请先理解图片内容、风格、构图和关键信息，再判断用户语义意图，并综合成适合 PPT 的排版与文字。
- 只要上游图片被标注为远程 URL，默认必须实际排入页面；不要只写图片描述或占位文案，除非用户明确要求不展示图片。
- 只有标注为可引用的远程 URL 才能写入 <img src>。

PPT 页面目录:
${outline}

当前页:
id: ${slide.id}
title: ${slide.title}
html:
${slide.html}

css:
${slide.css}

${buildStylePresetPromptSection(stylePreset)}

${incomingContext ? `上游输入:\n${incomingContext}\n\n` : ""}用户要求:
${instruction}`;
};

const buildAiDeckPrompt = (
  instruction: string,
  deck: HtmlPptDeck,
  incomingContext: string,
  stylePreset?: HtmlPptAiStyleGuide | null
): string => {
  const payload = JSON.stringify(
    {
      aspectRatio: deck.aspectRatio,
      themeCss: deck.themeCss,
      slides: deck.slides.map((slide) => ({
        id: slide.id,
        title: slide.title,
        html: slide.html,
        css: slide.css,
        notes: slide.notes || "",
      })),
    },
    null,
    2
  );

  return `你是 Tanva 的 HTML PPT deck 编辑器。请根据用户要求调整整套演示文稿，并只返回合法 JSON，不要使用 Markdown，不要解释。

返回 JSON schema:
{
  "action": "replace_deck",
  "aspectRatio": "16:9 或 4:3",
  "themeCss": "整套共享 CSS",
  "slides": [
    {
      "id": "优先沿用原 slide id；新增页可省略 id",
      "title": "短标题",
      "html": "该页 <section> 内部 HTML 片段，不要包含 html/head/body/script/iframe/base/object/embed",
      "css": "该页 CSS，可使用 .slide-root 作为根容器",
      "notes": "可选演讲备注"
    }
  ]
}

硬性规则:
- 最多 ${MAX_SLIDES} 页。
- 页面必须适合 ${deck.aspectRatio} PPT 展示，视觉风格要统一。
- 不要输出 <script>、事件属性、iframe、object、embed、base、javascript:。
- 不要使用 data:、blob:、base64 图片；如需图片，只能使用远程 http(s) URL 或项目路径。
- 保持 HTML/CSS 自包含，不依赖外部 JS。
- 如果有上游图片，请先理解图片内容、风格、构图和关键信息，再判断用户语义意图，并综合成整套 PPT 的结构、排版与文字。
- 只要上游图片被标注为远程 URL，默认必须实际排入对应页面；不要只写图片描述或占位文案，除非用户明确要求不展示图片。
- 只有标注为可引用的远程 URL 才能写入 <img src>。

当前 deck:
${payload}

${buildStylePresetPromptSection(stylePreset)}

${incomingContext ? `上游输入:\n${incomingContext}\n\n` : ""}用户要求:
${instruction}`;
};

function HtmlPptNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const edgeSignature = useStore((state: ReactFlowState) =>
    state.edges
      .map((edge) => `${edge.id}:${edge.source}:${edge.sourceHandle}:${edge.target}:${edge.targetHandle}`)
      .join("|")
  );
  const projectId = useProjectContentStore((state) => state.projectId);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const isDarkTheme = useAIChatStore((state) => state.chatTheme === "black");
  const deck = React.useMemo(() => normalizeDeck(data.deck), [data.deck]);
  const activeStylePreset = React.useMemo(
    () => findHtmlPptStylePreset(data.stylePresetKey),
    [data.stylePresetKey]
  );
  const activeBoldTemplate = React.useMemo(
    () => findHtmlPptBoldTemplate(data.boldTemplateSlug),
    [data.boldTemplateSlug]
  );
  const activeStyleGuide = React.useMemo<HtmlPptAiStyleGuide | null>(() => {
    if (activeBoldTemplate) return boldTemplateToStyleGuide(activeBoldTemplate);
    return activeStylePreset;
  }, [activeBoldTemplate, activeStylePreset]);
  const currentSlide =
    deck.slides.find((slide) => slide.id === data.currentSlideId) || deck.slides[0];
  const currentIndex = Math.max(0, deck.slides.findIndex((slide) => slide.id === currentSlide.id));
  const [viewMode, setViewMode] = React.useState<"preview" | "code">("preview");
  const [stylePreviewOpen, setStylePreviewOpen] = React.useState(false);
  const [promptDraft, setPromptDraft] = React.useState(data.promptDraft || "");
  const [isRunning, setIsRunning] = React.useState(false);
  const [hover, setHover] = React.useState<string | null>(null);
  const [statusText, setStatusText] = React.useState("");
  const previewFrameRef = React.useRef<HTMLDivElement | null>(null);
  const [previewFrameSize, setPreviewFrameSize] = React.useState({ width: 0, height: 0 });
  const title = data.title || "HTML PPT";
  const editScope = data.editScope === "deck" ? "deck" : "slide";
  const width = data.boxW || HTML_PPT_DEFAULT_WIDTH;
  const height = data.boxH || HTML_PPT_DEFAULT_HEIGHT;
  const effectiveProvider = React.useMemo<FlowModelProvider>(
    () => resolveFlowModelProvider(data.modelProvider, "banana-3.1"),
    [data.modelProvider]
  );
  const textModel = React.useMemo(
    () => getTextModelForProvider(effectiveProvider),
    [effectiveProvider]
  );
  const imageModel = React.useMemo(
    () => getImageModelForProvider(effectiveProvider),
    [effectiveProvider]
  );
  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: "gemini-text",
    model: textModel,
    requestParams: {
      aiProvider: effectiveProvider,
      channelHint: bananaImageRoute === "stable" ? "tencent" : "apimart",
    },
    enabled: true,
  });
  const resolvedRunCredits = backendCredits ?? data.creditsPerCall;

  React.useEffect(() => {
    setPromptDraft(data.promptDraft || "");
  }, [data.promptDraft]);

  React.useEffect(() => {
    if (data.sizeVersion === HTML_PPT_SIZE_VERSION) return;
    const nextBoxW = Math.max(Number(data.boxW) || 0, HTML_PPT_DEFAULT_WIDTH);
    const nextBoxH = Math.max(Number(data.boxH) || 0, HTML_PPT_DEFAULT_HEIGHT);
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            sizeVersion: HTML_PPT_SIZE_VERSION,
            boxW: nextBoxW,
            boxH: nextBoxH,
          },
        },
      })
    );
  }, [data.boxH, data.boxW, data.sizeVersion, id]);

  React.useEffect(() => {
    if (typeof data.modelProvider === "string" && data.modelProvider.trim()) return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { modelProvider: effectiveProvider } },
      })
    );
  }, [data.modelProvider, effectiveProvider, id]);

  const readIncomingTexts = React.useCallback(() => {
    return rf
      .getEdges()
      .filter((edge) => edge.target === id && edge.targetHandle === "text")
      .map((edge) => resolveTextFromSourceNode(rf.getNode(edge.source), edge.sourceHandle))
      .filter((text): text is string => typeof text === "string" && text.trim().length > 0);
  }, [id, rf]);

  const readIncomingImageRefs = React.useCallback(() => {
    return rf
      .getEdges()
      .filter((edge) => edge.target === id && edge.targetHandle === "img")
      .flatMap((edge) => collectImageRefsFromSourceNode(rf.getNode(edge.source), edge.sourceHandle))
      .slice(0, MAX_IMAGE_INPUTS);
  }, [id, rf]);

  const incomingTexts = React.useMemo(() => {
    void edgeSignature;
    return readIncomingTexts();
  }, [edgeSignature, readIncomingTexts]);

  const incomingImageRefs = React.useMemo(() => {
    void edgeSignature;
    return readIncomingImageRefs();
  }, [edgeSignature, readIncomingImageRefs]);

  const updateNodeData = React.useCallback(
    (patch: Record<string, unknown>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  const buildHistory = React.useCallback(
    (label: string): RevisionEntry[] => [
      {
        id: createHtmlPptId("rev"),
        label,
        createdAt: Date.now(),
        deck,
        currentSlideId: currentSlide.id,
      },
      ...(Array.isArray(data.revisionHistory) ? data.revisionHistory : []),
    ].slice(0, 10),
    [currentSlide.id, data.revisionHistory, deck]
  );

  const commitDeck = React.useCallback(
    (
      nextDeck: HtmlPptDeck,
      nextSlideId = currentSlide.id,
      options?: { historyLabel?: string; patch?: Record<string, unknown> }
    ) => {
      updateNodeData({
        deck: nextDeck,
        currentSlideId: nextSlideId,
        ...(options?.historyLabel ? { revisionHistory: buildHistory(options.historyLabel) } : {}),
        ...(options?.patch || {}),
      });
    },
    [buildHistory, currentSlide.id, updateNodeData]
  );

  const updateCurrentSlide = React.useCallback(
    (patch: Partial<HtmlPptSlide>, historyLabel?: string) => {
      if (patch.html !== undefined) assertSafeHtmlPptCode(patch.html, "Slide HTML");
      if (patch.css !== undefined) assertSafeHtmlPptCode(patch.css, "Slide CSS");
      const nextDeck: HtmlPptDeck = {
        ...deck,
        slides: deck.slides.map((slide) =>
          slide.id === currentSlide.id ? { ...slide, ...patch } : slide
        ),
      };
      commitDeck(nextDeck, currentSlide.id, historyLabel ? { historyLabel } : undefined);
    },
    [commitDeck, currentSlide.id, deck]
  );

  const setSlideByIndex = React.useCallback(
    (nextIndex: number) => {
      const next = deck.slides[Math.max(0, Math.min(deck.slides.length - 1, nextIndex))];
      if (!next) return;
      updateNodeData({ currentSlideId: next.id });
    },
    [deck.slides, updateNodeData]
  );

  const updateAspectRatio = React.useCallback(
    (aspectRatio: HtmlPptDeck["aspectRatio"]) => {
      if (deck.aspectRatio === aspectRatio) return;
      commitDeck(
        { ...deck, aspectRatio },
        currentSlide.id,
        { historyLabel: "change-aspect-ratio" }
      );
    },
    [commitDeck, currentSlide.id, deck]
  );

  const applyBoldTemplate = React.useCallback(
    (slug: HtmlPptBoldTemplateSlug) => {
      const template = getHtmlPptBoldTemplate(slug);
      const starterSlides = template.starterSlides.slice(0, MAX_SLIDES).map((slide, index) => ({
        id: createHtmlPptId("slide"),
        title: slide.title || `${template.name} ${index + 1}`,
        html: slide.html,
        css: slide.css,
        notes: slide.notes,
      }));
      assertSafeHtmlPptCode(template.themeCss, "Deck theme CSS");
      starterSlides.forEach((slide) => {
        assertSafeHtmlPptCode(slide.html, "Slide HTML");
        assertSafeHtmlPptCode(slide.css, "Slide CSS");
      });
      const nextDeck: HtmlPptDeck = starterSlides.length
        ? {
            version: 1,
            aspectRatio: "16:9",
            themeCss: template.themeCss,
            slides: starterSlides,
          }
        : { ...deck, themeCss: template.themeCss };
      const nextSlideId = nextDeck.slides[0]?.id || currentSlide.id;
      commitDeck(
        nextDeck,
        nextSlideId,
        {
          historyLabel: starterSlides.length
            ? "apply-bold-template-starter"
            : "apply-bold-template",
          patch: {
            boldTemplateSlug: template.slug,
            stylePresetKey: undefined,
            status: "idle",
            error: undefined,
          },
        }
      );
      setStatusText(
        starterSlides.length
          ? lt("已应用真实 HTML 模板", "HTML template starter applied")
          : lt("已应用 Bold 模板", "Bold template applied")
      );
    },
    [commitDeck, currentSlide.id, deck, lt]
  );

  const addSlide = React.useCallback((template: HtmlPptSlideTemplateKey = "content") => {
    if (deck.slides.length >= MAX_SLIDES) return;
    const nextSlide = createHtmlPptSlide(deck.slides.length + 1, template);
    commitDeck(
      { ...deck, slides: [...deck.slides, nextSlide] },
      nextSlide.id,
      { historyLabel: "add-slide" }
    );
  }, [commitDeck, deck]);

  const duplicateSlide = React.useCallback(() => {
    if (deck.slides.length >= MAX_SLIDES) return;
    const copy: HtmlPptSlide = {
      ...currentSlide,
      id: createHtmlPptId("slide"),
      title: `${currentSlide.title} Copy`,
    };
    const nextSlides = deck.slides.slice();
    nextSlides.splice(currentIndex + 1, 0, copy);
    commitDeck(
      { ...deck, slides: nextSlides },
      copy.id,
      { historyLabel: "duplicate-slide" }
    );
  }, [commitDeck, currentIndex, currentSlide, deck]);

  const deleteSlide = React.useCallback(() => {
    if (deck.slides.length <= 1) return;
    const nextSlides = deck.slides.filter((slide) => slide.id !== currentSlide.id);
    const nextSlide = nextSlides[Math.max(0, currentIndex - 1)] || nextSlides[0];
    commitDeck(
      { ...deck, slides: nextSlides },
      nextSlide.id,
      { historyLabel: "delete-slide" }
    );
  }, [commitDeck, currentIndex, currentSlide.id, deck]);

  const revertLast = React.useCallback(() => {
    const [last, ...rest] = Array.isArray(data.revisionHistory)
      ? data.revisionHistory
      : [];
    if (!last?.deck) return;
    updateNodeData({
      deck: last.deck,
      currentSlideId: last.currentSlideId || last.deck.slides[0]?.id,
      revisionHistory: rest,
      status: "idle",
      error: undefined,
    });
  }, [data.revisionHistory, updateNodeData]);

  const runAiEdit = React.useCallback(async () => {
    const instruction = promptDraft.trim();
    const latestIncomingTexts = readIncomingTexts();
    const latestIncomingImageRefs = readIncomingImageRefs();
    const incomingTextContext = latestIncomingTexts.join("\n\n").trim();
    const finalInstruction =
      instruction ||
      incomingTextContext ||
      (latestIncomingImageRefs.length
        ? "请根据上游图片进行 PPT 排版、关键信息提炼和文字综合。"
        : "");
    if (!finalInstruction) {
      setStatusText(lt("请输入修改要求", "Enter an edit request"));
      updateNodeData({
        status: "failed",
        error: lt("请输入修改要求", "Enter an edit request"),
      });
      return;
    }

    setIsRunning(true);
    setStatusText("");
    updateNodeData({ status: "running", error: undefined });
    try {
      if (latestIncomingImageRefs.length > 0) {
        setStatusText(lt("正在准备图片素材", "Preparing image assets"));
      }
      const preparedImages = await prepareImageRefsForAi(latestIncomingImageRefs, projectId);
      if (latestIncomingImageRefs.length > 0 && preparedImages.length === 0) {
        throw new Error(lt("图片素材准备失败，无法用于 PPT 排版", "Image asset preparation failed"));
      }
      let allPreparedImages = preparedImages;
      let incomingImageContext = buildIncomingImageContext(allPreparedImages);
      let incomingContext = [incomingTextContext, incomingImageContext]
        .filter((item) => item.trim().length > 0)
        .join("\n\n")
        .trim();
      const autoAssetIntent = getAutoAssetIntent(finalInstruction, preparedImages.length);
      if (autoAssetIntent.shouldPlan) {
        setStatusText(lt("正在判断是否需要生成视觉素材", "Planning visual asset"));
        let assetPlan: HtmlPptGeneratedAssetPlan | null = null;
        try {
          const planResult = await aiImageService.generateTextResponse({
            prompt: buildGeneratedAssetPlanPrompt({
              instruction: finalInstruction,
              deck,
              currentSlide,
              editScope,
              incomingContext,
              preparedImages,
              stylePreset: activeStyleGuide,
            }),
            imageUrls: preparedImages.length
              ? preparedImages.map((image) => image.visionRef).slice(0, MAX_IMAGE_INPUTS)
              : undefined,
            aiProvider: effectiveProvider,
            model: textModel,
            enableWebSearch: false,
            billingTag: "text_chat",
            providerOptions: buildBananaProviderOptions(bananaImageRoute),
          });

          if (planResult.success && planResult.data?.text) {
            const parsedPlan = extractJsonPayload(
              planResult.data.text,
              "Ultra did not return a visual asset plan."
            );
            assetPlan = normalizeGeneratedAssetPlan(parsedPlan, deck);
          } else if (autoAssetIntent.explicit) {
            assetPlan = buildFallbackGeneratedAssetPlan(
              finalInstruction,
              deck,
              currentSlide,
              editScope
            );
          } else {
            console.warn("HTML PPT visual asset planning skipped:", planResult.error);
          }
        } catch (error) {
          if (autoAssetIntent.explicit) {
            assetPlan = buildFallbackGeneratedAssetPlan(
              finalInstruction,
              deck,
              currentSlide,
              editScope
            );
          } else {
            console.warn("HTML PPT visual asset planning failed:", error);
          }
        }

        if ((!assetPlan || !assetPlan.shouldGenerateImages) && autoAssetIntent.explicit) {
          assetPlan = buildFallbackGeneratedAssetPlan(
            finalInstruction,
            deck,
            currentSlide,
            editScope
          );
        }

        const asset = assetPlan?.shouldGenerateImages ? assetPlan.assets[0] : null;
        if (asset) {
          const referenceImageUrls = preparedImages
            .map((image) => image.visionRef)
            .filter(isHttpImageRef)
            .slice(0, MAX_IMAGE_INPUTS);
          setStatusText(lt("正在生成视觉素材", "Generating visual asset"));
          const imageResult = await generateImageViaAPI({
            prompt: buildGeneratedImagePrompt(
              asset,
              finalInstruction,
              deck,
              referenceImageUrls.length,
              activeStyleGuide
            ),
            aiProvider: effectiveProvider,
            model: imageModel,
            aspectRatio: asset.aspectRatio || deck.aspectRatio,
            imageSize: "2K",
            outputFormat: "png",
            imageOnly: true,
            enableWebSearch: false,
            imageUrls: referenceImageUrls.length ? referenceImageUrls : undefined,
            providerOptions: buildBananaProviderOptions(bananaImageRoute),
            nodeId: id,
            nodeConfigKey: "html-ppt-auto-visual",
            nodeConfigNameZh: "HTML PPT 自动视觉素材",
            nodeConfigNameEn: "HTML PPT auto visual asset",
            billingTitleSource: "node",
          });
          if (!imageResult.success || !imageResult.data) {
            throw new Error(
              imageResult.error?.message ||
                lt("视觉素材生成失败", "Visual asset generation failed")
            );
          }

          setStatusText(lt("正在上传生成素材", "Uploading visual asset"));
          const generatedUrl = await resolveGeneratedImageUrl(imageResult.data, projectId);
          const generatedImage = createGeneratedPreparedImage({
            asset,
            url: generatedUrl,
            reason: assetPlan?.reason,
          });
          allPreparedImages = [generatedImage, ...preparedImages];
          incomingImageContext = buildIncomingImageContext(allPreparedImages);
          incomingContext = [incomingTextContext, incomingImageContext]
            .filter((item) => item.trim().length > 0)
            .join("\n\n")
            .trim();
        }
      }

      const imageUrls = allPreparedImages
        .map((image) => image.visionRef)
        .slice(0, MAX_IMAGE_INPUTS);
      setStatusText(lt("正在生成 PPT", "Generating PPT"));
      const result = await aiImageService.generateTextResponse({
        prompt:
          editScope === "deck"
            ? buildAiDeckPrompt(finalInstruction, deck, incomingContext, activeStyleGuide)
            : buildAiPrompt(finalInstruction, deck, currentSlide, incomingContext, activeStyleGuide),
        imageUrls: imageUrls.length ? imageUrls : undefined,
        aiProvider: effectiveProvider,
        model: textModel,
        enableWebSearch: false,
        billingTag: "text_chat",
        providerOptions: buildBananaProviderOptions(bananaImageRoute),
      });

      if (!result.success || !result.data?.text) {
        throw new Error(result.error?.message || lt("HTML PPT 生成失败", "HTML PPT generation failed"));
      }

      const parsed = extractJsonPayload(result.data.text);
      if (editScope === "deck") {
        const nextDeck = normalizeAiDeckPatch(parsed, deck);
        const nextSlideId =
          nextDeck.slides.find((slide) => slide.id === currentSlide.id)?.id ||
          nextDeck.slides[0]?.id ||
          currentSlide.id;
        commitDeck(nextDeck, nextSlideId, {
          historyLabel: "ultra-edit-deck",
          patch: {
            status: "succeeded",
            error: undefined,
            lastResponse: result.data.text,
          },
        });
        setStatusText(lt("已更新整套 PPT", "Deck updated"));
      } else {
        const patch = normalizeAiSlidePatch(parsed, currentSlide.id);
        const nextDeck: HtmlPptDeck = {
          ...deck,
          slides: deck.slides.map((slide) =>
            slide.id === currentSlide.id ? { ...slide, ...patch } : slide
          ),
        };
        commitDeck(nextDeck, currentSlide.id, {
          historyLabel: "ultra-edit-slide",
          patch: {
            status: "succeeded",
            error: undefined,
            lastResponse: result.data.text,
          },
        });
        setStatusText(lt("已更新当前页", "Slide updated"));
      }
      setViewMode("preview");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateNodeData({ status: "failed", error: message });
      setStatusText(message);
    } finally {
      setIsRunning(false);
    }
  }, [
    activeStyleGuide,
    bananaImageRoute,
    commitDeck,
    currentSlide,
    deck,
    editScope,
    effectiveProvider,
    id,
    imageModel,
    lt,
    promptDraft,
    projectId,
    readIncomingImageRefs,
    readIncomingTexts,
    textModel,
    updateNodeData,
  ]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>
      ).detail;
      if (!detail || detail.id !== id) return;
      void (async () => {
        try {
          await runAiEdit();
          detail.done?.(true);
        } catch {
          detail.done?.(false);
        }
      })();
    };
    window.addEventListener("flow:run-node", handler as EventListener);
    return () => window.removeEventListener("flow:run-node", handler as EventListener);
  }, [id, runAiEdit]);

  const exportHtml = React.useCallback(() => {
    const blob = new Blob([buildFullDeckHtml(deck, title)], {
      type: "text/html;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\w.-]+/g, "_") || "html-ppt"}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }, [deck, title]);

  const copyHtml = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildFullDeckHtml(deck, title));
      setStatusText(lt("HTML 已复制", "HTML copied"));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  }, [deck, lt, title]);

  const providerToggleOptions = React.useMemo<
    Array<{ value: FlowModelProvider; label: string; description: string }>
  >(
    () => [
      {
        value: "banana-2.5",
        label: "Fast",
        description: lt("Nano Banana/Gemini 2.5", "Nano Banana/Gemini 2.5"),
      },
      {
        value: "banana",
        label: "Pro",
        description: lt("Nano Banana Pro/Gemini 3 Pro", "Nano Banana Pro/Gemini 3 Pro"),
      },
      {
        value: "banana-3.1",
        label: "Ultra",
        description: lt("Nano Banana 2/Gemini 3.1", "Nano Banana 2/Gemini 3.1"),
      },
    ],
    [lt]
  );
  const currentProviderValue = effectiveProvider;
  const currentProviderOption = React.useMemo(
    () =>
      providerToggleOptions.find((option) => option.value === currentProviderValue) ??
      providerToggleOptions[1],
    [currentProviderValue, providerToggleOptions]
  );
  const status = isRunning ? "running" : data.status || "idle";
  const isBusy = status === "running";
  const slideWorkspaceHeight = React.useMemo(
    () => Math.max(420, Math.min(560, height - 210)),
    [height]
  );
  React.useEffect(() => {
    const element = previewFrameRef.current;
    if (!element) return;
    const updateSize = () => {
      setPreviewFrameSize((current) => {
        const nextWidth = Math.round(element.clientWidth);
        const nextHeight = Math.round(element.clientHeight);
        if (current.width === nextWidth && current.height === nextHeight) return current;
        return { width: nextWidth, height: nextHeight };
      });
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewMode, deck.aspectRatio]);
  const previewScale = React.useMemo(() => {
    const design = getDesignSize(deck.aspectRatio);
    if (previewFrameSize.width <= 0 || previewFrameSize.height <= 0) return 0.5;
    return Math.max(
      0.1,
      Math.min(previewFrameSize.width / design.width, previewFrameSize.height / design.height) *
        HTML_PPT_PREVIEW_FIT_INSET
    );
  }, [deck.aspectRatio, previewFrameSize.height, previewFrameSize.width]);
  const palette = isDarkTheme
    ? {
        bg: "#151515",
        panel: "#1f1f1f",
        panelSoft: "#252525",
        border: selected ? "#4a4a4a" : "#343434",
        text: "#f8fafc",
        muted: "#8a8a8a",
        inputBg: "#101010",
        button: "#2f2f2f",
        shadow: selected
          ? "0 0 0 2px rgba(125,125,125,0.2), 0 14px 28px rgba(0,0,0,0.42)"
          : "0 10px 22px rgba(0,0,0,0.35)",
      }
    : {
        bg: "#ffffff",
        panel: "#f8fafc",
        panelSoft: "#eef2f7",
        border: selected ? "#2563eb" : "#e5e7eb",
        text: "#111827",
        muted: "#64748b",
        inputBg: "#ffffff",
        button: "#111827",
        shadow: selected
          ? "0 0 0 2px rgba(37,99,235,0.12)"
          : "0 1px 2px rgba(0,0,0,0.04)",
      };

  return (
    <div
      style={{
        width,
        minHeight: height,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        boxShadow: palette.shadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        color: palette.text,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 8,
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div
              className="tanva-flow-node-title"
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: palette.text,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onPointerDownCapture={stopFlowPan}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  className="nodrag nopan tanva-flow-provider-mode-badge"
                  title={lt("切换模型模式", "Switch model mode")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "1px 8px",
                    borderRadius: 50,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    flexShrink: 0,
                    ...(isDarkTheme
                      ? {
                          color: "#ffffff",
                          background: "#343434",
                          border: "1px solid #4a4a4a",
                        }
                      : {
                          color:
                            currentProviderValue === "banana-3.1"
                              ? "#0f172a"
                              : "#475569",
                          background:
                            currentProviderValue === "banana-3.1"
                              ? "#e2e8f0"
                              : "#f1f5f9",
                          border: "1px solid #e2e8f0",
                        }),
                  }}
                >
                  {currentProviderOption.label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="bottom"
                sideOffset={8}
                className="min-w-[200px] rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:!border-slate-200 dark:!bg-white/95"
              >
                <DropdownMenuLabel className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 dark:!text-slate-400">
                  {lt("模型切换", "Model switch")}
                </DropdownMenuLabel>
                {providerToggleOptions.map((option) => {
                  const isActive = currentProviderValue === option.value;
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (currentProviderValue !== option.value) {
                          updateNodeData({ modelProvider: option.value });
                        }
                      }}
                      onPointerDownCapture={stopFlowPan}
                      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                        isActive
                          ? "bg-gray-100 text-gray-800 dark:!bg-gray-100 dark:!text-gray-800"
                          : "text-slate-600 hover:bg-gray-100 dark:!text-slate-600 dark:hover:!bg-gray-100"
                      }`}
                    >
                      <div className="flex-1 space-y-0.5">
                        <div className="font-medium leading-none">{option.label}</div>
                        <div className="text-[11px] leading-snug text-slate-400 dark:!text-slate-400">
                          {option.description}
                        </div>
                      </div>
                      {isActive ? <Check className="h-3.5 w-3.5 text-slate-700 dark:!text-slate-700" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>
            {currentIndex + 1}/{deck.slides.length} · {currentSlide.title}
          </div>
        </div>
        <button
          type="button"
          onClick={runAiEdit}
          disabled={isBusy}
          className="nodrag nopan run-btn-with-credit"
          onPointerDownCapture={stopFlowPan}
          title={
            resolvedRunCredits
              ? `${lt("消耗", "Cost")}: ${resolvedRunCredits} ${lt("积分", "credits")}`
              : lt("运行", "Run")
          }
          style={{
            minWidth: 64,
            height: 30,
            padding: "0 10px",
            boxSizing: "border-box",
            borderRadius: 6,
            border: "none",
            background: isBusy ? "#e5e7eb" : palette.button,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            cursor: isBusy ? "not-allowed" : "pointer",
            flexShrink: 0,
          }}
        >
          {isBusy ? <Loader2 size={15} className="animate-spin" /> : null}
          <span className="run-text-trigger">{isBusy ? "Running..." : "Run"}</span>
          {resolvedRunCredits ? <RunCreditBadge credits={resolvedRunCredits} runButton /> : null}
        </button>
      </div>

      <div
        className="nodrag nopan"
        onPointerDownCapture={stopFlowPan}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth: 0,
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setSlideByIndex(currentIndex - 1)}
            disabled={currentIndex === 0}
            title={lt("上一页", "Previous slide")}
            style={iconButtonStyle(palette, currentIndex === 0)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("preview")}
            title={lt("预览", "Preview")}
            style={toolButtonStyle(palette, viewMode === "preview")}
          >
            <Monitor size={14} />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setViewMode("code")}
            title={lt("代码", "Code")}
            style={toolButtonStyle(palette, viewMode === "code")}
          >
            <Code2 size={14} />
            Code
          </button>
          <button
            type="button"
            onClick={() => setStylePreviewOpen((value) => !value)}
            title={lt("风格预览", "Style previews")}
            style={toolButtonStyle(palette, stylePreviewOpen)}
          >
            <Palette size={14} />
            Style
          </button>
          <button
            type="button"
            onClick={() => setSlideByIndex(currentIndex + 1)}
            disabled={currentIndex >= deck.slides.length - 1}
            title={lt("下一页", "Next slide")}
            style={iconButtonStyle(palette, currentIndex >= deck.slides.length - 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <div
            style={{
              display: "inline-flex",
              height: 30,
              borderRadius: 7,
              overflow: "hidden",
              border: "1px solid rgba(148,163,184,0.35)",
            }}
          >
            {(["16:9", "4:3"] as const).map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => updateAspectRatio(ratio)}
                style={{
                  width: 42,
                  border: "none",
                  borderRight: ratio === "16:9" ? "1px solid rgba(148,163,184,0.35)" : "none",
                  background: deck.aspectRatio === ratio ? palette.button : palette.panel,
                  color: deck.aspectRatio === ratio ? "#fff" : palette.text,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {ratio}
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={lt("添加页", "Add slide")}
                disabled={deck.slides.length >= MAX_SLIDES}
                style={iconButtonStyle(palette, deck.slides.length >= MAX_SLIDES)}
              >
                <FilePlus2 size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="bottom"
              sideOffset={8}
              className="min-w-[210px] rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:!border-slate-200 dark:!bg-white/95"
            >
              <DropdownMenuLabel className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 dark:!text-slate-400">
                {lt("添加模板页", "Add template slide")}
              </DropdownMenuLabel>
              {HTML_PPT_SLIDE_TEMPLATE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.key}
                  onClick={(event) => {
                    event.stopPropagation();
                    addSlide(option.key);
                  }}
                  onPointerDownCapture={stopFlowPan}
                  className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-gray-100 dark:!text-slate-600 dark:hover:!bg-gray-100"
                >
                  <div className="flex-1 space-y-0.5">
                    <div className="font-medium leading-none">{option.label}</div>
                    <div className="text-[11px] leading-snug text-slate-400 dark:!text-slate-400">
                      {option.description}
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" title={lt("复制页", "Duplicate slide")} onClick={duplicateSlide} style={iconButtonStyle(palette, deck.slides.length >= MAX_SLIDES)}>
            <Copy size={14} />
          </button>
          <button type="button" title={lt("删除页", "Delete slide")} onClick={deleteSlide} disabled={deck.slides.length <= 1} style={iconButtonStyle(palette, deck.slides.length <= 1)}>
            <Trash2 size={14} />
          </button>
          <button type="button" title={lt("撤回", "Revert")} onClick={revertLast} disabled={!data.revisionHistory?.length} style={iconButtonStyle(palette, !data.revisionHistory?.length)}>
            <RotateCcw size={14} />
          </button>
          <button type="button" title={lt("复制 HTML", "Copy HTML")} onClick={copyHtml} style={iconButtonStyle(palette, false)}>
            <Copy size={14} />
          </button>
          <button type="button" title={lt("导出 HTML", "Export HTML")} onClick={exportHtml} style={iconButtonStyle(palette, false)}>
            <Download size={14} />
          </button>
        </div>
      </div>

      {stylePreviewOpen && (
        <div
          className="nodrag nopan nowheel"
          onPointerDownCapture={stopFlowPan}
          onWheelCapture={stopFlowPan}
          style={{
            border: `1px solid ${isDarkTheme ? "#333333" : "#e5e7eb"}`,
            borderRadius: 8,
            background: palette.panel,
            padding: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: palette.text, fontSize: 12, fontWeight: 800 }}>
                Beautiful templates
              </div>
              <div
                style={{
                  color: palette.muted,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {activeStyleGuide
                  ? `${activeStyleGuide.label} selected`
                  : lt("选择 GitHub HTML 模板作为当前 PPT 起点", "Select a GitHub HTML template as the deck starter")}
              </div>
            </div>
            <div
              style={{
                flexShrink: 0,
                color: palette.muted,
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              Bold 34
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 8,
              maxHeight: 620,
              overflowY: "auto",
              paddingRight: 2,
            }}
          >
            {HTML_PPT_BOLD_TEMPLATES.map((template) => (
              <StylePreviewTile
                key={template.slug}
                item={{
                  id: template.slug,
                  label: template.name,
                  description: template.tagline,
                  colors: template.colors,
                  themeCss: template.themeCss,
                  previewSlide: template.previewSlide,
                  previewSlides: template.previewSlides,
                  author: template.author,
                }}
                aspectRatio="16:9"
                active={activeBoldTemplate?.slug === template.slug}
                palette={palette}
                isDarkTheme={isDarkTheme}
                onClick={() => applyBoldTemplate(template.slug)}
              />
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "176px minmax(0, 1fr)",
          gap: 12,
          height: slideWorkspaceHeight,
          minHeight: slideWorkspaceHeight,
          overflow: "hidden",
        }}
      >
        <div
          className="nodrag nopan nowheel"
          onPointerDownCapture={stopFlowPan}
          onWheelCapture={stopFlowPan}
          style={{
            minWidth: 0,
            border: `1px solid ${isDarkTheme ? "#333333" : "#e5e7eb"}`,
            borderRadius: 8,
            background: palette.panel,
            padding: 8,
            height: "100%",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
              color: palette.muted,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            <span>Slides</span>
            <span>{deck.slides.length}</span>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              alignContent: "start",
              gap: 6,
              overflowY: "auto",
              overflowX: "hidden",
              paddingRight: 2,
            }}
          >
            {deck.slides.map((slide, index) => (
              <SlideThumbnail
                key={slide.id}
                deck={deck}
                slide={slide}
                index={index}
                active={slide.id === currentSlide.id}
                palette={palette}
                isDarkTheme={isDarkTheme}
                onClick={() => updateNodeData({ currentSlideId: slide.id })}
              />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, minHeight: 0 }}>
          {viewMode === "preview" ? (
            <div
              ref={previewFrameRef}
              style={{
                background: "linear-gradient(135deg, #111827 0%, #020617 100%)",
                borderRadius: 8,
                border: `1px solid ${isDarkTheme ? "#303030" : "#d6dde8"}`,
                overflow: "hidden",
                position: "relative",
                height: "100%",
                minHeight: 0,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
              }}
            >
              <SlideIframePreview
                deck={deck}
                slide={currentSlide}
                scale={previewScale}
                title={`${title} - ${currentSlide.title}`}
                borderRadius={4}
                shadow
              />
            </div>
          ) : (
            <div
              className="nodrag nopan nowheel"
              onPointerDownCapture={stopFlowPan}
              onWheelCapture={stopFlowPan}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minHeight: 250,
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ color: palette.muted, fontSize: 11, fontWeight: 700 }}>Title</span>
                <input
                  value={currentSlide.title}
                  onChange={(event) => updateCurrentSlide({ title: event.target.value })}
                  style={{
                    height: 32,
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.35)",
                    background: palette.inputBg,
                    color: palette.text,
                    padding: "0 10px",
                    outline: "none",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <CodeField
                  label="HTML"
                  value={currentSlide.html}
                  palette={palette}
                  onChange={(value) => {
                    try {
                      updateCurrentSlide({ html: value });
                      setStatusText("");
                    } catch (error) {
                      setStatusText(error instanceof Error ? error.message : String(error));
                    }
                  }}
                />
                <CodeField
                  label="CSS"
                  value={currentSlide.css}
                  palette={palette}
                  onChange={(value) => {
                    try {
                      updateCurrentSlide({ css: value });
                      setStatusText("");
                    } catch (error) {
                      setStatusText(error instanceof Error ? error.message : String(error));
                    }
                  }}
                />
              </div>
              <CodeField
                label="Notes"
                value={currentSlide.notes || ""}
                palette={palette}
                minHeight={64}
                onChange={(value) => updateCurrentSlide({ notes: value })}
              />
            </div>
          )}
        </div>
      </div>

      <div
        className="nodrag nopan nowheel"
        onPointerDownCapture={stopFlowPan}
        onWheelCapture={stopFlowPan}
        style={{ display: "block" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                height: 26,
                borderRadius: 7,
                overflow: "hidden",
                border: "1px solid rgba(148,163,184,0.35)",
              }}
            >
              {(["slide", "deck"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => updateNodeData({ editScope: scope })}
                  disabled={isBusy}
                  style={{
                    width: 52,
                    border: "none",
                    borderRight: scope === "slide" ? "1px solid rgba(148,163,184,0.35)" : "none",
                    background: editScope === scope ? palette.button : palette.panel,
                    color: editScope === scope ? "#fff" : palette.text,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: isBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {scope === "slide" ? "Slide" : "Deck"}
                </button>
              ))}
            </div>
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                color: palette.muted,
                fontSize: 11,
              }}
            >
              {editScope === "deck"
                ? lt("改整套页面", "Rewrite the whole deck")
                : lt("只改当前页", "Edit current slide only")}
            </span>
          </div>
          <textarea
            value={promptDraft}
            disabled={isBusy}
            onChange={(event) => {
              const next = event.target.value;
              setPromptDraft(next);
              updateNodeData({ promptDraft: next });
            }}
            placeholder={
              editScope === "deck"
                ? lt("描述整套 PPT 要怎么改", "Describe how to change the full deck")
                : lt("描述当前页要怎么改", "Describe how to change this slide")
            }
            style={{
              minHeight: 58,
              resize: "vertical",
              borderRadius: 8,
              border: `1px solid ${isDarkTheme ? "#3d3d3d" : "#d7dce5"}`,
              background: palette.inputBg,
              color: palette.text,
              padding: "9px 10px",
              fontSize: 12,
              lineHeight: 1.45,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      {(statusText || data.error || incomingTexts.length > 0 || incomingImageRefs.length > 0) && (
        <div
          style={{
            minHeight: 18,
            color: data.error || statusText.includes("cannot") ? "#ef4444" : palette.muted,
            fontSize: 11,
            lineHeight: 1.35,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={
            statusText ||
            data.error ||
            [
              incomingTexts.join("\n"),
              incomingImageRefs
                .map((image, index) => {
                  const preview = image.embeddableUrl || `${image.raw.slice(0, 96)}${image.raw.length > 96 ? "..." : ""}`;
                  return `Image ${index + 1}: ${preview}`;
                })
                .join("\n"),
            ]
              .filter(Boolean)
              .join("\n\n")
          }
        >
          {statusText ||
            data.error ||
            `${lt("上游输入", "Incoming")}: ${incomingTexts.length} text / ${incomingImageRefs.length} image`}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: "43%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "text-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "43%", transform: "translate(-100%, -50%)" }}>
          prompt
        </div>
      )}
      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: "58%" }}
        onMouseEnter={() => setHover("img-in")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "img-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "58%", transform: "translate(-100%, -50%)" }}>
          image
        </div>
      )}
    </div>
  );
}

const iconButtonStyle = (
  palette: { panel: string; text: string; muted: string; border?: string },
  disabled: boolean
): React.CSSProperties => ({
  width: 30,
  height: 30,
  borderRadius: 7,
  border: "1px solid rgba(148,163,184,0.35)",
  background: palette.panel,
  color: disabled ? "rgba(148,163,184,0.55)" : palette.text,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: disabled ? "not-allowed" : "pointer",
  padding: 0,
});

const toolButtonStyle = (
  palette: { panel: string; button: string; text: string; muted: string },
  active: boolean
): React.CSSProperties => ({
  height: 30,
  borderRadius: 7,
  border: "1px solid rgba(148,163,184,0.35)",
  background: active ? palette.button : palette.panel,
  color: active ? "#fff" : palette.text,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  cursor: "pointer",
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 700,
});

function CodeField({
  label,
  value,
  palette,
  minHeight = 205,
  onChange,
}: {
  label: string;
  value: string;
  palette: { panel: string; inputBg: string; text: string; muted: string };
  minHeight?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 5 }}>
      <span style={{ color: palette.muted, fontSize: 11, fontWeight: 700 }}>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        style={{
          flex: 1,
          minHeight,
          resize: "none",
          borderRadius: 8,
          border: "1px solid rgba(148,163,184,0.35)",
          background: palette.inputBg,
          color: palette.text,
          padding: 10,
          outline: "none",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          lineHeight: 1.45,
        }}
      />
    </label>
  );
}

function SlideIframePreview({
  deck,
  slide,
  scale,
  title,
  borderRadius = 0,
  shadow = false,
  loading,
}: {
  deck: HtmlPptDeck;
  slide: HtmlPptSlide;
  scale: number;
  title: string;
  borderRadius?: number;
  shadow?: boolean;
  loading?: "eager" | "lazy";
}) {
  const design = getDesignSize(deck.aspectRatio);
  const safeScale = Number.isFinite(scale) ? Math.max(0.02, Math.min(2, scale)) : 0.1;
  const frameWidth = design.width * safeScale;
  const frameHeight = design.height * safeScale;
  const srcDoc = React.useMemo(() => buildSlideSrcDoc(deck, slide, 1), [deck, slide]);

  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% - ${frameWidth / 2}px)`,
        top: `calc(50% - ${frameHeight / 2}px)`,
        width: frameWidth,
        height: frameHeight,
        overflow: "hidden",
        borderRadius,
        background: "#ffffff",
        boxShadow: shadow ? "0 18px 48px rgba(0,0,0,0.38)" : "none",
      }}
    >
      <div
        style={{
          width: design.width,
          height: design.height,
          transform: `scale(${safeScale})`,
          transformOrigin: "top left",
        }}
      >
        <iframe
          title={title}
          sandbox=""
          referrerPolicy="no-referrer"
          loading={loading}
          srcDoc={srcDoc}
          style={{
            width: design.width,
            height: design.height,
            border: "none",
            display: "block",
            pointerEvents: "none",
            background: "#ffffff",
          }}
        />
      </div>
    </div>
  );
}

function SlideThumbnail({
  deck,
  slide,
  index,
  active,
  palette,
  isDarkTheme,
  onClick,
}: {
  deck: HtmlPptDeck;
  slide: HtmlPptSlide;
  index: number;
  active: boolean;
  palette: { panel: string; inputBg: string; text: string; muted: string };
  isDarkTheme: boolean;
  onClick: () => void;
}) {
  const baseWidth = 640;
  const baseHeight = deck.aspectRatio === "4:3" ? 480 : 360;
  const thumbWidth = 148;
  const scale = thumbWidth / baseWidth;
  const thumbHeight = Math.round(baseHeight * scale);
  const tileHeight = thumbHeight + 34;
  const design = getDesignSize(deck.aspectRatio);
  const iframeScale = Math.min(thumbWidth / design.width, thumbHeight / design.height);

  return (
    <button
      type="button"
      onClick={onClick}
      title={slide.title}
      style={{
        width: "100%",
        border: `1px solid ${active ? "#2563eb" : isDarkTheme ? "#3a3a3a" : "#dbe3ef"}`,
        borderRadius: 7,
        background: active ? (isDarkTheme ? "rgba(37,99,235,0.22)" : "#eff6ff") : palette.inputBg,
        color: active ? (isDarkTheme ? "#bfdbfe" : "#1d4ed8") : palette.text,
        padding: 5,
        height: tileHeight,
        minHeight: tileHeight,
        maxHeight: tileHeight,
        textAlign: "left",
        cursor: "pointer",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: thumbWidth,
          height: thumbHeight,
          borderRadius: 5,
          overflow: "hidden",
          position: "relative",
          background: "#111827",
          border: `1px solid ${isDarkTheme ? "#333333" : "#e5e7eb"}`,
          boxSizing: "border-box",
        }}
      >
        <SlideIframePreview
          deck={deck}
          slide={slide}
          scale={iframeScale}
          title={`slide ${index + 1} thumbnail`}
          borderRadius={4}
          loading="lazy"
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginTop: 5,
          minWidth: 0,
          height: 18,
          overflow: "hidden",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: "14px",
        }}
      >
        <span style={{ color: active ? "inherit" : palette.muted, flex: "0 0 auto" }}>{index + 1}</span>
        <span
          style={{
            display: "block",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {slide.title}
        </span>
      </div>
    </button>
  );
}

function StylePreviewTile({
  item,
  aspectRatio,
  active,
  palette,
  isDarkTheme,
  onClick,
}: {
  item: HtmlPptStylePreviewItem;
  aspectRatio: HtmlPptDeck["aspectRatio"];
  active: boolean;
  palette: { panel: string; inputBg: string; text: string; muted: string };
  isDarkTheme: boolean;
  onClick: () => void;
}) {
  const previewSlides = React.useMemo(
    () => (item.previewSlides?.length ? item.previewSlides : [item.previewSlide]).slice(0, 3),
    [item.previewSlide, item.previewSlides]
  );
  const previewStageHeight = previewSlides.length > 1 ? 104 : 86;
  const previewScale = React.useMemo(() => {
    const design = getDesignSize(aspectRatio);
    const targetWidth = previewSlides.length > 1 ? 94 : 210;
    const targetHeight = previewStageHeight - 10;
    return Math.min(
      0.24,
      Math.max(0.02, Math.min(targetWidth / design.width, targetHeight / design.height))
    );
  }, [aspectRatio, previewSlides.length, previewStageHeight]);
  const previewDecks = React.useMemo(
    () =>
      previewSlides.map((slide, index) => {
        const previewDeck: HtmlPptDeck = {
          version: 1,
          aspectRatio,
          themeCss: item.themeCss,
          slides: [
            {
              id: `style-preview-${item.id}-${index + 1}`,
              title: slide.title,
              html: slide.html,
              css: slide.css,
            },
          ],
        };
        return previewDeck;
      }),
    [aspectRatio, item.id, item.themeCss, previewSlides]
  );

  return (
    <button
      type="button"
      onClick={onClick}
      title={item.author ? `${item.description}\nAuthor: ${item.author}` : item.description}
      style={{
        minWidth: 0,
        border: `1px solid ${active ? item.colors.accent : isDarkTheme ? "#3a3a3a" : "#dbe3ef"}`,
        borderRadius: 8,
        background: active
          ? isDarkTheme
            ? "rgba(255,255,255,0.08)"
            : "#ffffff"
          : palette.inputBg,
        color: palette.text,
        padding: 7,
        textAlign: "left",
        cursor: "pointer",
        boxShadow: active ? `0 0 0 1px ${item.colors.accent}` : "none",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          height: previewStageHeight,
          display: "grid",
          gridTemplateColumns: `repeat(${previewDecks.length}, minmax(0, 1fr))`,
          gap: previewDecks.length > 1 ? 5 : 0,
          borderRadius: 6,
          overflow: "hidden",
          background: "#111827",
          border: `1px solid ${isDarkTheme ? "#333333" : "#e5e7eb"}`,
        }}
      >
        {previewDecks.map((previewDeck, index) => (
          <div
            key={`${item.id}-${index}`}
            style={{
              position: "relative",
              minWidth: 0,
              overflow: "hidden",
              background: "#111827",
            }}
          >
            <SlideIframePreview
              deck={previewDeck}
              slide={previewDeck.slides[0]}
              scale={previewScale}
              title={`${item.label} preview ${index + 1}`}
              loading="lazy"
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background: item.colors.accent,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            flex: 1,
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {item.label}
        </span>
        {item.author ? (
          <span
            style={{
              flexShrink: 0,
              marginLeft: "auto",
              maxWidth: 116,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              border: `1px solid ${isDarkTheme ? "#4b5563" : "#d1d5db"}`,
              borderRadius: 999,
              padding: "1px 6px",
              color: active ? item.colors.accent : palette.muted,
              fontSize: 9,
              fontWeight: 800,
              lineHeight: "13px",
            }}
          >
            By {item.author}
          </span>
        ) : null}
      </div>
      <div
        style={{
          color: active ? item.colors.accent : palette.muted,
          fontSize: 10,
          lineHeight: 1.25,
          marginTop: 3,
          minHeight: 25,
          overflow: "hidden",
        }}
      >
        {item.description}
      </div>
    </button>
  );
}

export default React.memo(HtmlPptNodeInner);
