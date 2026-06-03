import React from "react";
import {
  Handle,
  Position,
  useReactFlow,
  useStore,
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
import { getTextModelForProvider, useAIChatStore } from "@/stores/aiChatStore";
import {
  resolveFlowModelProvider,
  type FlowModelProvider,
} from "@/utils/flowModelProvider";
import { useLocaleText } from "@/utils/localeText";
import { assertSafeHtmlPptCode } from "@/utils/htmlPptSafety";
import {
  createDefaultHtmlPptDeck,
  createHtmlPptId,
  createHtmlPptSlide,
  type HtmlPptDeck,
  type HtmlPptSlide,
} from "@/utils/htmlPptDeck";
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
  };
  selected?: boolean;
};

const HTML_PPT_SIZE_VERSION = 1;
const MAX_SLIDES = 24;
const MAX_CODE_LENGTH = 120_000;

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

const baseSlideRuntimeCss = (deck: HtmlPptDeck) => {
  const ratio = getRatioParts(deck.aspectRatio);
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
  width: min(100vw, calc(100vh * ${ratio.w} / ${ratio.h}));
  aspect-ratio: ${ratio.w} / ${ratio.h};
  overflow: hidden;
  box-sizing: border-box;
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

const buildSlideSrcDoc = (deck: HtmlPptDeck, slide: HtmlPptSlide): string => {
  const origin = typeof window !== "undefined" ? `${window.location.origin}/` : "/";
  const css = [
    baseSlideRuntimeCss(deck),
    deck.themeCss || "",
    slide.css || "",
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
  const slides = deck.slides
    .map(
      (slide, index) => `<section class="slide-root" data-slide-index="${index}">
${slide.html || ""}
</section>`
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
body { background: #111827; }
.deck-export { width: 100vw; height: 100vh; display: grid; place-items: center; }
.slide-root { display: none; }
.slide-root.is-active { display: block; width: min(100vw, calc(100vh * ${ratio.w} / ${ratio.h})); }
.deck-counter { position: fixed; right: 18px; bottom: 14px; color: #cbd5e1; font: 12px/1.2 ui-sans-serif, system-ui; }
@media print {
  body { background: #fff; }
  .deck-export { display: block; width: auto; height: auto; }
  .deck-counter { display: none; }
  .slide-root { display: block !important; width: 100vw; height: auto; page-break-after: always; }
}
${escapeStyleContent(deck.themeCss || "")}
${escapeStyleContent(slideCss)}
  </style>
</head>
<body>
  <main class="deck-export">${slides}</main>
  <div class="deck-counter" id="deckCounter"></div>
  <script>
    const slides = Array.from(document.querySelectorAll(".slide-root"));
    let index = 0;
    function show(next) {
      index = Math.max(0, Math.min(slides.length - 1, next));
      slides.forEach((slide, i) => slide.classList.toggle("is-active", i === index));
      const counter = document.getElementById("deckCounter");
      if (counter) counter.textContent = (index + 1) + " / " + slides.length;
    }
    window.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") show(index + 1);
      if (event.key === "ArrowLeft" || event.key === "PageUp") show(index - 1);
    });
    show(0);
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

function HtmlPptNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const edgeSignature = useStore((state: ReactFlowState) =>
    state.edges
      .map((edge) => `${edge.id}:${edge.source}:${edge.sourceHandle}:${edge.target}:${edge.targetHandle}`)
      .join("|")
  );
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
  const title = data.title || "HTML PPT";
  const width = data.boxW || 620;
  const height = data.boxH || 560;
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
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { sizeVersion: HTML_PPT_SIZE_VERSION } },
      })
    );
  }, [data.sizeVersion, id]);

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

  const incomingTexts = React.useMemo(() => {
    void edgeSignature;
    return readIncomingTexts();
  }, [edgeSignature, readIncomingTexts]);

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

  const addSlide = React.useCallback(() => {
    if (deck.slides.length >= MAX_SLIDES) return;
    const nextSlide = createHtmlPptSlide(deck.slides.length + 1);
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
    const incomingContext = latestIncomingTexts.join("\n\n").trim();
    const finalInstruction = instruction || incomingContext;
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
      const result = await aiImageService.generateTextResponse({
        prompt: buildAiPrompt(finalInstruction, deck, currentSlide, incomingContext),
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
      setViewMode("preview");
      setStatusText(lt("已更新当前页", "Slide updated"));
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
    effectiveProvider,
    lt,
    promptDraft,
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
  const previewSrcDoc = React.useMemo(
    () => buildSlideSrcDoc(deck, currentSlide),
    [currentSlide, deck]
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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          type="button"
          className="nodrag nopan"
          onPointerDownCapture={stopFlowPan}
          onClick={() => setSlideByIndex(currentIndex - 1)}
          disabled={currentIndex === 0}
          title={lt("上一页", "Previous slide")}
          style={iconButtonStyle(palette, currentIndex === 0)}
        >
          <ChevronLeft size={15} />
        </button>
        <div
          className="nodrag nopan nowheel"
          onPointerDownCapture={stopFlowPan}
          onWheelCapture={stopFlowPan}
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            paddingBottom: 2,
          }}
        >
          {deck.slides.map((slide, index) => {
            const active = slide.id === currentSlide.id;
            return (
              <button
                key={slide.id}
                type="button"
                onClick={() => updateNodeData({ currentSlideId: slide.id })}
                style={{
                  minWidth: 34,
                  height: 28,
                  borderRadius: 7,
                  border: `1px solid ${active ? "#2563eb" : isDarkTheme ? "#3a3a3a" : "#dbe3ef"}`,
                  background: active ? "#eff6ff" : palette.panel,
                  color: active ? "#1d4ed8" : palette.muted,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
                title={slide.title}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="nodrag nopan"
          onPointerDownCapture={stopFlowPan}
          onClick={() => setSlideByIndex(currentIndex + 1)}
          disabled={currentIndex >= deck.slides.length - 1}
          title={lt("下一页", "Next slide")}
          style={iconButtonStyle(palette, currentIndex >= deck.slides.length - 1)}
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="nodrag nopan"
            onPointerDownCapture={stopFlowPan}
            onClick={() => setViewMode("preview")}
            title={lt("预览", "Preview")}
            style={toolButtonStyle(palette, viewMode === "preview")}
          >
            <Monitor size={14} />
            Preview
          </button>
          <button
            type="button"
            className="nodrag nopan"
            onPointerDownCapture={stopFlowPan}
            onClick={() => setViewMode("code")}
            title={lt("代码", "Code")}
            style={toolButtonStyle(palette, viewMode === "code")}
          >
            <Code2 size={14} />
            Code
          </button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" title={lt("添加页", "Add slide")} onClick={addSlide} className="nodrag nopan" onPointerDownCapture={stopFlowPan} style={iconButtonStyle(palette, deck.slides.length >= MAX_SLIDES)}>
            <FilePlus2 size={14} />
          </button>
          <button type="button" title={lt("复制页", "Duplicate slide")} onClick={duplicateSlide} className="nodrag nopan" onPointerDownCapture={stopFlowPan} style={iconButtonStyle(palette, deck.slides.length >= MAX_SLIDES)}>
            <Copy size={14} />
          </button>
          <button type="button" title={lt("删除页", "Delete slide")} onClick={deleteSlide} disabled={deck.slides.length <= 1} className="nodrag nopan" onPointerDownCapture={stopFlowPan} style={iconButtonStyle(palette, deck.slides.length <= 1)}>
            <Trash2 size={14} />
          </button>
          <button type="button" title={lt("撤回", "Revert")} onClick={revertLast} disabled={!data.revisionHistory?.length} className="nodrag nopan" onPointerDownCapture={stopFlowPan} style={iconButtonStyle(palette, !data.revisionHistory?.length)}>
            <RotateCcw size={14} />
          </button>
          <button type="button" title={lt("复制 HTML", "Copy HTML")} onClick={copyHtml} className="nodrag nopan" onPointerDownCapture={stopFlowPan} style={iconButtonStyle(palette, false)}>
            <Copy size={14} />
          </button>
          <button type="button" title={lt("导出 HTML", "Export HTML")} onClick={exportHtml} className="nodrag nopan" onPointerDownCapture={stopFlowPan} style={iconButtonStyle(palette, false)}>
            <Download size={14} />
          </button>
        </div>
      </div>

      {viewMode === "preview" ? (
        <div
          style={{
            background: "#111827",
            borderRadius: 8,
            border: `1px solid ${isDarkTheme ? "#303030" : "#e5e7eb"}`,
            overflow: "hidden",
            aspectRatio: deck.aspectRatio === "4:3" ? "4 / 3" : "16 / 9",
            minHeight: 210,
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
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            minHeight: 230,
          }}
        >
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
      )}

      <div
        className="nodrag nopan nowheel"
        onPointerDownCapture={stopFlowPan}
        onWheelCapture={stopFlowPan}
        style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}
      >
        <textarea
          value={promptDraft}
          disabled={isBusy}
          onChange={(event) => {
            const next = event.target.value;
            setPromptDraft(next);
            updateNodeData({ promptDraft: next });
          }}
          placeholder={lt("描述当前页要怎么改", "Describe how to change this slide")}
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
        <button
          type="button"
          onClick={runAiEdit}
          disabled={isBusy}
          className="run-btn-with-credit"
          title={
            resolvedRunCredits
              ? `${lt("消耗", "Cost")}: ${resolvedRunCredits} ${lt("积分", "credits")}`
              : lt("运行", "Run")
          }
          style={{
            minWidth: 64,
            minHeight: 30,
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
          }}
        >
          {isBusy ? <Loader2 size={15} className="animate-spin" /> : null}
          <span className="run-text-trigger">{isBusy ? "Running..." : "Run"}</span>
          {resolvedRunCredits ? <RunCreditBadge credits={resolvedRunCredits} runButton /> : null}
        </button>
      </div>

      {(statusText || data.error || incomingTexts.length > 0) && (
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
          title={statusText || data.error || incomingTexts.join("\n")}
        >
          {statusText || data.error || `${lt("上游输入", "Incoming text")}: ${incomingTexts.length}`}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "text-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}>
          prompt
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
  onChange,
}: {
  label: string;
  value: string;
  palette: { panel: string; inputBg: string; text: string; muted: string };
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
          minHeight: 205,
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

export default React.memo(HtmlPptNodeInner);
