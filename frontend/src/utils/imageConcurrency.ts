import { createAsyncLimiter } from "@/utils/asyncLimit";

// 全局图片生成/转化并发限制（暂定 10）
export const IMAGE_CONCURRENCY = 10;

const imageConcurrencyLimiter = createAsyncLimiter(IMAGE_CONCURRENCY);

export const runWithImageConcurrency = async <T>(
  task: () => Promise<T>
): Promise<T> => imageConcurrencyLimiter.run(task);

const normalizePossiblyDuplicatedDataUrl = (dataUrl: string): string => {
  const trimmed = dataUrl?.trim?.() || "";
  if (!/^data:/i.test(trimmed)) return trimmed;
  // 处理 "data:image/png;base64,data:image/png;base64,AAAA..." 重复前缀
  const parts = trimmed.split(",");
  if (parts.length >= 3 && parts[1].startsWith("data:")) {
    const meta = parts[0];
    const last = parts[parts.length - 1];
    return `${meta},${last}`;
  }
  return trimmed;
};

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  runWithImageConcurrency(
    () =>
      new Promise((resolve, reject) => {
        try {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            if (typeof result === "string" && result.length > 0) {
              resolve(result);
            } else {
              reject(new Error("blob 转 dataURL 失败"));
            }
          };
          reader.onerror = () => reject(new Error("blob 转 dataURL 失败"));
          reader.readAsDataURL(blob);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("blob 转 dataURL 失败"));
        }
      })
  );

export const fileToDataUrl = (file: File | Blob): Promise<string> =>
  blobToDataUrl(file);

/**
 * dataURL -> Blob
 * - 优先使用 fetch 解码（避免 atob + 大数组导致 JS 堆峰值）
 * - 失败回退到同步解码（兼容极端环境）
 */
export const dataUrlToBlob = (dataUrl: string): Promise<Blob> =>
  runWithImageConcurrency(async () => {
    const normalized = normalizePossiblyDuplicatedDataUrl(dataUrl);
    const trimmed = normalized?.trim?.() || "";
    if (!/^data:/i.test(trimmed)) {
      throw new Error("非 dataURL，无法转换 Blob");
    }

    try {
      const response = await fetch(trimmed);
      if (response.ok) {
        const blob = await response.blob();
        if (blob && blob.size > 0) return blob;
      }
    } catch {
      // ignore fallback
    }

    const [meta, raw] = trimmed.split(",");
    const isBase64 = meta?.includes?.(";base64") ?? false;
    const mimeMatch = /data:([^;]+)/.exec(meta || "");
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    if (isBase64) {
      const binary = atob(raw || "");
      const len = binary.length;
      const array = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        array[i] = binary.charCodeAt(i);
      }
      return new Blob([array], { type: mime });
    }
    return new Blob([decodeURIComponent(raw || "")], { type: mime });
  });

export const canvasToDataUrl = (
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<string> =>
  runWithImageConcurrency(async () => {
    if (mimeType === "image/jpeg" || mimeType === "image/webp") {
      return canvas.toDataURL(mimeType, quality);
    }
    return canvas.toDataURL(mimeType);
  });

export const canvasToBlob = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: { type: string; quality?: number }
): Promise<Blob> =>
  runWithImageConcurrency(async () => {
    if ("convertToBlob" in canvas && typeof canvas.convertToBlob === "function") {
      const blob = await canvas.convertToBlob(options);
      if (blob) return blob;
      throw new Error("无法生成Blob");
    }

    return await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error("无法生成Blob"))),
        options.type,
        options.quality
      );
    });
  });

export const responseToBlob = (response: Response): Promise<Blob> =>
  runWithImageConcurrency(async () => {
    const blob = await response.blob();
    if (!blob) throw new Error("无法读取 Blob");
    return blob;
  });

export const createImageBitmapLimited = (blob: Blob): Promise<ImageBitmap> =>
  runWithImageConcurrency(async () => {
    if (typeof createImageBitmap !== "function") {
      throw new Error("createImageBitmap 不可用");
    }
    return await createImageBitmap(blob);
  });
