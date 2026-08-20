import type { HtmlPptDeck, HtmlPptSlide } from "@/utils/htmlPptDeck";

const DESIGN_SIZE = {
  "16:9": { width: 1920, height: 1080, pptxWidth: 13.333, pptxHeight: 7.5 },
  "4:3": { width: 1440, height: 1080, pptxWidth: 10, pptxHeight: 7.5 },
} as const;

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

const safeFileStem = (value: string): string => {
  const normalized = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80);
  return normalized || "tanva-presentation";
};

const waitForSlideAssets = async (root: HTMLElement): Promise<void> => {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      image.crossOrigin = "anonymous";
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener(
            "error",
            () => reject(new Error(`图片加载失败：${image.currentSrc || image.src}`)),
            { once: true }
          );
        });
      }
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        throw new Error(`图片不可用于导出：${image.currentSrc || image.src}`);
      }
      await image.decode?.().catch(() => undefined);
    })
  );

  if (typeof document !== "undefined" && "fonts" in document) {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
    ]);
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
};

const mountSlideForExport = (
  deck: HtmlPptDeck,
  slide: HtmlPptSlide
): { host: HTMLDivElement; slideElement: HTMLElement } => {
  const design = DESIGN_SIZE[deck.aspectRatio];
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${design.width}px`,
    height: `${design.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "-1",
  });
  host.innerHTML = `<style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
.slide-root {
  position: relative;
  width: ${design.width}px;
  height: ${design.height}px;
  overflow: hidden;
  isolation: isolate;
}
${deck.themeCss}
${slide.css}
</style><section class="slide-root">${slide.html}</section>`;
  document.body.appendChild(host);
  const slideElement = host.querySelector<HTMLElement>(".slide-root");
  if (!slideElement) {
    host.remove();
    throw new Error("PPT 页面渲染失败：缺少 slide-root。");
  }
  return { host, slideElement };
};

export type HtmlPptExportProgress = {
  current: number;
  total: number;
  stage: "render" | "package";
};

/**
 * 将现有 HTML PPT 按固定设计画布栅格化，并用 PptxGenJS 封装为高保真 PPTX。
 * 每页在 PowerPoint 中是一张整页高清图，优先保证与浏览器预览一致。
 */
export async function exportHtmlPptDeckAsPptx(options: {
  deck: HtmlPptDeck;
  title: string;
  onProgress?: (progress: HtmlPptExportProgress) => void;
}): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("PPTX 导出只能在浏览器中执行。");
  }

  const { deck, title, onProgress } = options;
  const slides = deck.slides;
  if (!slides.length) throw new Error("当前演示文稿没有可导出的页面。");

  const [{ toPng }, pptxModule] = await Promise.all([
    import("html-to-image"),
    import("pptxgenjs"),
  ]);
  const PptxGenJS = pptxModule.default;
  const pptx = new PptxGenJS();
  const design = DESIGN_SIZE[deck.aspectRatio];
  pptx.layout = deck.aspectRatio === "4:3" ? "LAYOUT_4x3" : "LAYOUT_WIDE";
  pptx.author = "Tanva";
  pptx.company = "Tanva";
  pptx.subject = "Tanva browser presentation export";
  pptx.title = title || "Tanva Presentation";
  pptx.revision = "1";

  for (const [index, slide] of slides.entries()) {
    onProgress?.({ current: index + 1, total: slides.length, stage: "render" });
    const mounted = mountSlideForExport(deck, slide);
    try {
      await waitForSlideAssets(mounted.slideElement);
      let imageFailed = false;
      const dataUrl = await toPng(mounted.slideElement, {
        width: design.width,
        height: design.height,
        canvasWidth: design.width,
        canvasHeight: design.height,
        pixelRatio: 1,
        cacheBust: true,
        includeQueryParams: true,
        imagePlaceholder: TRANSPARENT_PIXEL,
        fetchRequestInit: { credentials: "omit", mode: "cors" },
        onImageErrorHandler: () => {
          imageFailed = true;
        },
      });
      if (imageFailed) {
        throw new Error(
          "页面包含无法跨域读取的外部图片，请先把图片上传到 Tanva 项目库后再导出。"
        );
      }
      const pptxSlide = pptx.addSlide();
      pptxSlide.addImage({
        data: dataUrl,
        x: 0,
        y: 0,
        w: design.pptxWidth,
        h: design.pptxHeight,
      });
      if (slide.notes?.trim()) pptxSlide.addNotes(slide.notes.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`第 ${index + 1} 页导出失败：${message}`);
    } finally {
      mounted.host.remove();
    }
  }

  onProgress?.({ current: slides.length, total: slides.length, stage: "package" });
  const fileName = `${safeFileStem(title)}.pptx`;
  await pptx.writeFile({ fileName, compression: true });
  return fileName;
}

export const normalizeHtmlPptExportFileName = (title: string): string =>
  `${safeFileStem(title)}.pptx`;
