/**
 * 生成缩略图数据 URL，默认保持较小尺寸以减少内存占用。
 */

import { createAsyncLimiter } from '@/utils/asyncLimit';

export type ImagePreviewOptions = {
  maxSize?: number;
  mimeType?: string;
  quality?: number;
  /**
   * 可选缓存键：不传则使用 dataUrl 的轻量指纹。
   * 注意：不要直接传入完整 dataUrl（会导致无法释放大字符串）。
   */
  cacheKey?: string;
};

type PreviewCacheEntry = {
  value: string;
  timestamp: number;
};

const PREVIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const PREVIEW_CACHE_MAX_ENTRIES = 30;
const previewCache = new Map<string, PreviewCacheEntry>();
const previewInFlight = new Map<string, Promise<string>>();
// 限制并发生成缩略图，避免多图同时解码/转码导致内存峰值
const previewComputeLimiter = createAsyncLimiter(1);

const purgePreviewCache = () => {
  const now = Date.now();
  for (const [key, entry] of previewCache.entries()) {
    if (now - entry.timestamp >= PREVIEW_CACHE_TTL_MS) {
      previewCache.delete(key);
    }
  }
  while (previewCache.size > PREVIEW_CACHE_MAX_ENTRIES) {
    const oldestKey = previewCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    previewCache.delete(oldestKey);
  }
};

// FNV-1a 32-bit
const hash32 = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

const fingerprintDataUrl = (dataUrl: string): string => {
  const sampleSize = 256;
  const head = dataUrl.slice(0, sampleSize);
  const tail = dataUrl.slice(Math.max(0, dataUrl.length - sampleSize));
  return `${dataUrl.length}:${hash32(`${head}|${tail}`)}`;
};

const getPreviewCacheKey = (dataUrl: string, options: ImagePreviewOptions): string => {
  const maxSize = options.maxSize ?? 512;
  const mimeType = options.mimeType ?? 'image/webp';
  const quality = options.quality ?? 0.85;
  const sourceKey = options.cacheKey || fingerprintDataUrl(dataUrl);
  return `v1:${sourceKey}:${maxSize}:${mimeType}:${quality}`;
};

const loadImage = (dataUrl: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string' && result.length > 0) {
          resolve(result);
        } else {
          reject(new Error('blob 转 dataURL 失败'));
        }
      };
      reader.onerror = () => reject(new Error('blob 转 dataURL 失败'));
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('blob 转 dataURL 失败'));
    }
  });

export async function createImagePreviewDataUrl(
  dataUrl: string,
  options: ImagePreviewOptions = {}
): Promise<string> {
  if (typeof document === 'undefined') {
    return dataUrl;
  }

  const cacheKey = getPreviewCacheKey(dataUrl, options);
  purgePreviewCache();
  const cached = previewCache.get(cacheKey);
  if (cached) {
    // 触发 LRU：重新插入到队尾
    previewCache.delete(cacheKey);
    previewCache.set(cacheKey, { value: cached.value, timestamp: Date.now() });
    return cached.value;
  }

  const pending = previewInFlight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const compute = previewComputeLimiter.run(async (): Promise<string> => {
    const maxSize = options.maxSize ?? 512;
    const mimeType = options.mimeType ?? 'image/webp';
    const quality = options.quality ?? 0.85;

    // 优先尝试 WebCodecs / createImageBitmap + OffscreenCanvas，避免把 base64 dataURL 直接喂给 <img> 再入画布
    const tryDecodeViaWebCodecs = async (): Promise<string | null> => {
      const ImageDecoderCtor = (globalThis as any).ImageDecoder as
        | (new (init: any) => any)
        | undefined;
      if (!ImageDecoderCtor) return null;
      if (typeof OffscreenCanvas === 'undefined') return null;
      if (typeof fetch !== 'function') return null;

      try {
        const init: RequestInit = /^blob:/i.test(dataUrl)
          ? {}
          : { mode: 'cors', credentials: 'omit' };
        const response = await fetch(dataUrl, init);
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!blob || blob.size <= 0) return null;

        const decoder = new ImageDecoderCtor({
          data: typeof blob.stream === 'function' ? blob.stream() : await blob.arrayBuffer(),
          type: blob.type || 'image/png',
        });

        let frame: any;
        try {
          const decoded = await decoder.decode({ frameIndex: 0 });
          frame = decoded?.image;
          if (!frame) return null;

          const srcW =
            frame.displayWidth ?? frame.codedWidth ?? frame.width ?? 0;
          const srcH =
            frame.displayHeight ?? frame.codedHeight ?? frame.height ?? 0;
          if (!srcW || !srcH) return null;

          const maxDimension = Math.max(srcW, srcH) || 1;
          const scale = maxDimension > maxSize ? maxSize / maxDimension : 1;
          const width = Math.max(1, Math.round(srcW * scale));
          const height = Math.max(1, Math.round(srcH * scale));

          const canvas = new OffscreenCanvas(width, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          (ctx as any).drawImage(frame, 0, 0, width, height);

          const outBlob = await canvas.convertToBlob({ type: mimeType, quality });
          if (!outBlob || outBlob.size <= 0) return null;
          return await blobToDataUrl(outBlob);
        } finally {
          try {
            frame?.close?.();
          } catch {}
          try {
            decoder?.close?.();
          } catch {}
        }
      } catch {
        return null;
      }
    };

    const tryDecodeViaBitmap = async (): Promise<string | null> => {
      if (typeof createImageBitmap !== 'function') return null;
      if (typeof fetch !== 'function') return null;
      try {
        const init: RequestInit = /^blob:/i.test(dataUrl)
          ? {}
          : { mode: 'cors', credentials: 'omit' };
        const response = await fetch(dataUrl, init);
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!blob || blob.size <= 0) return null;

        const bitmap = await createImageBitmap(blob);
        const srcW = bitmap.width || 0;
        const srcH = bitmap.height || 0;
        if (!srcW || !srcH) {
          try {
            bitmap.close();
          } catch {}
          return null;
        }

        const maxDimension = Math.max(srcW, srcH) || 1;
        const scale = maxDimension > maxSize ? maxSize / maxDimension : 1;
        const width = Math.max(1, Math.round(srcW * scale));
        const height = Math.max(1, Math.round(srcH * scale));

        const canvas =
          typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
        (canvas as any).width = width;
        (canvas as any).height = height;
        const ctx = (canvas as any).getContext?.('2d');
        if (!ctx) {
          try {
            bitmap.close();
          } catch {}
          return null;
        }

        ctx.drawImage(bitmap, 0, 0, width, height);
        try {
          bitmap.close();
        } catch {}

        try {
          if (typeof (canvas as any).convertToBlob === 'function') {
            const outBlob = await (canvas as any).convertToBlob({
              type: mimeType,
              quality,
            });
            if (!outBlob || outBlob.size <= 0) return null;
            return await blobToDataUrl(outBlob);
          }
          return (canvas as HTMLCanvasElement).toDataURL(mimeType, quality);
        } catch {
          return null;
        }
      } catch {
        return null;
      }
    };

    const viaWebCodecs = await tryDecodeViaWebCodecs();
    if (viaWebCodecs) return viaWebCodecs;

    const viaBitmap = await tryDecodeViaBitmap();
    if (viaBitmap) return viaBitmap;

    // 兼容兜底：老路径（<img> + canvas.toDataURL）
    const image = await loadImage(dataUrl);
    const maxDimension = Math.max(image.width, image.height) || 1;
    const scale = maxDimension > maxSize ? maxSize / maxDimension : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return dataUrl;
    }
    ctx.drawImage(image, 0, 0, width, height);
    try {
      return canvas.toDataURL(mimeType, quality);
    } catch {
      return dataUrl;
    }
  });

  previewInFlight.set(cacheKey, compute);
  try {
    const result = await compute;
    // 只缓存“确实缩小/转码后的结果”，避免把大体积原图 dataUrl 固定在缓存里
    if (result && result !== dataUrl && result.length < dataUrl.length) {
      previewCache.set(cacheKey, { value: result, timestamp: Date.now() });
      purgePreviewCache();
    }
    return result;
  } finally {
    previewInFlight.delete(cacheKey);
  }

}
