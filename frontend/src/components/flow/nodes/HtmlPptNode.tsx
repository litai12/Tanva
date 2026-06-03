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
  RotateCcw,
  Trash2,
} from "lucide-react";
import { aiImageService } from "@/services/aiImageService";
import { imageUploadService } from "@/services/imageUploadService";
import { getTextModelForProvider, useAIChatStore } from "@/stores/aiChatStore";
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
  };
  selected?: boolean;
};

const HTML_PPT_SIZE_VERSION = 2;
const HTML_PPT_DEFAULT_WIDTH = 980;
const HTML_PPT_DEFAULT_HEIGHT = 720;
const HTML_PPT_DESIGN_WIDTH_16_9 = 1280;
const HTML_PPT_DESIGN_HEIGHT_16_9 = 720;
const HTML_PPT_DESIGN_WIDTH_4_3 = 1024;
const HTML_PPT_DESIGN_HEIGHT_4_3 = 768;
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
  display: flex;
  align-items: center;
  justify-content: center;
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
    ? Math.max(0.1, Math.min(2, renderScale))
    : 1;
  const css = [
    baseSlideRuntimeCss(deck),
    deck.themeCss || "",
    slide.css || "",
    `.slide-stage > .slide-root {
  width: ${design.width}px !important;
  height: ${design.height}px !important;
  transform: scale(${safeScale}) !important;
  transform-origin: center center !important;
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

const extractJsonPayload = (text: string): Record<string, unknown> => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Ultra did not return a JSON patch.");
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
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const isHttpImageRef = (value: string): boolean => /^https?:\/\//i.test(value.trim());

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
    if (image.embeddableUrl) {
      return `${label}${source}: 必须作为可用视觉素材纳入版式；HTML 中用该远程 URL 引用: ${image.embeddableUrl}`;
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
  incomingContext: string
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

${incomingContext ? `上游输入:\n${incomingContext}\n\n` : ""}用户要求:
${instruction}`;
};

const buildAiDeckPrompt = (
  instruction: string,
  deck: HtmlPptDeck,
  incomingContext: string
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
  const currentSlide =
    deck.slides.find((slide) => slide.id === data.currentSlideId) || deck.slides[0];
  const currentIndex = Math.max(0, deck.slides.findIndex((slide) => slide.id === currentSlide.id));
  const [viewMode, setViewMode] = React.useState<"preview" | "code">("preview");
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
      const incomingImageContext = buildIncomingImageContext(preparedImages);
      const incomingContext = [incomingTextContext, incomingImageContext]
        .filter((item) => item.trim().length > 0)
        .join("\n\n")
        .trim();
      const imageUrls = preparedImages.map((image) => image.visionRef);
      setStatusText("");
      const result = await aiImageService.generateTextResponse({
        prompt:
          editScope === "deck"
            ? buildAiDeckPrompt(finalInstruction, deck, incomingContext)
            : buildAiPrompt(finalInstruction, deck, currentSlide, incomingContext),
        imageUrls: imageUrls.length ? imageUrls : undefined,
        aiProvider: effectiveProvider,
        model: textModel,
        enableWebSearch: false,
        billingTag: "text_chat",
        providerOptions: {
          banana: {
            imageRoute: bananaImageRoute === "stable" ? "stable" : "normal",
          },
          bananaImageRoute: bananaImageRoute === "stable" ? "stable" : "normal",
        },
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
    bananaImageRoute,
    commitDeck,
    currentSlide,
    deck,
    editScope,
    effectiveProvider,
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
  React.useEffect(() => {
    const element = previewFrameRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setPreviewFrameSize((current) => {
        const nextWidth = Math.round(rect.width);
        const nextHeight = Math.round(rect.height);
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
      Math.min(previewFrameSize.width / design.width, previewFrameSize.height / design.height)
    );
  }, [deck.aspectRatio, previewFrameSize.height, previewFrameSize.width]);
  const previewSrcDoc = React.useMemo(
    () => buildSlideSrcDoc(deck, currentSlide, previewScale),
    [currentSlide, deck, previewScale]
  );
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "176px minmax(0, 1fr)",
          gap: 12,
          minHeight: 300,
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
          <div style={{ display: "grid", gap: 6 }}>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          {viewMode === "preview" ? (
            <div
              ref={previewFrameRef}
              style={{
                background: "#111827",
                borderRadius: 8,
                border: `1px solid ${isDarkTheme ? "#303030" : "#e5e7eb"}`,
                overflow: "hidden",
                aspectRatio: deck.aspectRatio === "4:3" ? "4 / 3" : "16 / 9",
                minHeight: 420,
              }}
            >
              <iframe
                title={`${title} - ${currentSlide.title}`}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={previewSrcDoc}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  display: "block",
                  pointerEvents: "none",
                  background: "#111827",
                }}
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
  const design = getDesignSize(deck.aspectRatio);
  const iframeScale = Math.min(baseWidth / design.width, baseHeight / design.height);

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
        textAlign: "left",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: thumbWidth,
          height: Math.round(baseHeight * scale),
          borderRadius: 5,
          overflow: "hidden",
          background: "#111827",
          border: `1px solid ${isDarkTheme ? "#333333" : "#e5e7eb"}`,
        }}
      >
        <div
          style={{
            width: baseWidth,
            height: baseHeight,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <iframe
            title={`slide ${index + 1} thumbnail`}
            sandbox=""
            referrerPolicy="no-referrer"
            loading="lazy"
            srcDoc={buildSlideSrcDoc(deck, slide, iframeScale)}
            style={{
              width: baseWidth,
              height: baseHeight,
              border: "none",
              display: "block",
              pointerEvents: "none",
              background: "#111827",
            }}
          />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginTop: 5,
          minWidth: 0,
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        <span style={{ color: active ? "inherit" : palette.muted }}>{index + 1}</span>
        <span
          style={{
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

export default React.memo(HtmlPptNodeInner);
