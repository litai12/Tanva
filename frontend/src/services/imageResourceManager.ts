import { runWithImageConcurrency, responseToBlob } from "@/utils/imageConcurrency";
import { toCanonicalPersistableImageRef, toRenderableImageSrc } from "@/utils/imageSource";

type BitmapCacheEntry = {
  bitmap: ImageBitmap;
  bytes: number;
  refCount: number;
  lastUsed: number;
};

export type AcquireImageBitmapOptions = {
  /**
   * 预览场景建议传入（例如 256/512/1024），用于对大图做降采样解码，降低内存与 GPU 纹理占用。
   * 若未传或无法计算缩放，将回退为原尺寸解码。
   */
  maxDimension?: number;
  /**
   * 原图尺寸（来自元数据/节点 crop/sourceWidth/sourceHeight 等），用于在解码前计算缩放目标；
   * 不传则无法在解码前做可靠的降采样。
   */
  intrinsicWidth?: number;
  intrinsicHeight?: number;
};

export type ImageBitmapHandle = {
  bitmap: ImageBitmap;
  release: () => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const estimateBitmapBytes = (w: number, h: number): number =>
  Math.max(0, Math.floor(w) * Math.floor(h) * 4);

const computeResizeTarget = (options: AcquireImageBitmapOptions): { w: number; h: number } | null => {
  const maxDimension = options.maxDimension;
  const intrinsicWidth = options.intrinsicWidth;
  const intrinsicHeight = options.intrinsicHeight;
  if (
    typeof maxDimension !== "number" ||
    !Number.isFinite(maxDimension) ||
    maxDimension <= 0
  ) {
    return null;
  }
  if (
    typeof intrinsicWidth !== "number" ||
    typeof intrinsicHeight !== "number" ||
    !Number.isFinite(intrinsicWidth) ||
    !Number.isFinite(intrinsicHeight) ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0
  ) {
    return null;
  }

  const maxIntrinsic = Math.max(intrinsicWidth, intrinsicHeight);
  if (maxIntrinsic <= 0) return null;

  const scale = clamp(maxDimension / maxIntrinsic, 0, 1);
  if (scale >= 1) return null;

  const w = Math.max(1, Math.round(intrinsicWidth * scale));
  const h = Math.max(1, Math.round(intrinsicHeight * scale));
  return { w, h };
};

/**
 * 统一图片资源管理：
 * - 以「唯一可持久化远程引用」作为缓存 key（优先 key/path，其次 URL）
 * - 去重：同一图片只解码一次（按 resize 目标维度区分）
 * - 释放：引用计数归零后可被 LRU 淘汰并 close()
 */
class ImageResourceManager {
  // 仅缓存解码后的 bitmap（blob 交给浏览器 HTTP cache；避免双份占用）
  private bitmapCache = new Map<string, BitmapCacheEntry>();
  private bitmapInFlight = new Map<string, Promise<ImageBitmap>>();
  private totalBitmapBytes = 0;

  // 预览型 bitmap 缓存上限：尽量保守，避免与 Paper.js/ReactFlow 叠加后顶爆内存
  private readonly MAX_BITMAP_BYTES = 200 * 1024 * 1024;
  private readonly MAX_BITMAP_ENTRIES = 120;

  private normalizeCacheKey(ref: string, options: AcquireImageBitmapOptions): string | null {
    const canonical = toCanonicalPersistableImageRef(ref);
    if (!canonical) return null;

    const resizeTarget = computeResizeTarget(options);
    if (!resizeTarget) return `${canonical}#full`;
    return `${canonical}#${resizeTarget.w}x${resizeTarget.h}`;
  }

  private async fetchBlobForRef(ref: string): Promise<Blob> {
    const canonical = toCanonicalPersistableImageRef(ref);
    if (!canonical) {
      throw new Error("Invalid image ref");
    }

    const renderable = toRenderableImageSrc(canonical) || canonical;
    const init: RequestInit =
      /^blob:/i.test(renderable) ? {} : { mode: "cors", credentials: "omit" };
    const response = await fetch(renderable, init);
    if (!response.ok) {
      throw new Error(`Image fetch failed: ${response.status}`);
    }
    return await responseToBlob(response);
  }

  private async decodeBitmap(ref: string, options: AcquireImageBitmapOptions): Promise<ImageBitmap> {
    return await runWithImageConcurrency(async () => {
      if (typeof createImageBitmap !== "function") {
        throw new Error("createImageBitmap not supported");
      }

      const blob = await this.fetchBlobForRef(ref);
      const resizeTarget = computeResizeTarget(options);
      if (!resizeTarget) {
        return await createImageBitmap(blob);
      }

      try {
        return await (createImageBitmap as any)(blob, {
          resizeWidth: resizeTarget.w,
          resizeHeight: resizeTarget.h,
          resizeQuality: "high",
        });
      } catch {
        // 兼容：部分环境不支持 options 形式，回退为原尺寸解码
        return await createImageBitmap(blob);
      }
    });
  }

  private evictIfNeeded() {
    if (
      this.totalBitmapBytes <= this.MAX_BITMAP_BYTES &&
      this.bitmapCache.size <= this.MAX_BITMAP_ENTRIES
    ) {
      return;
    }

    const entries = Array.from(this.bitmapCache.entries())
      .filter(([, entry]) => entry.refCount <= 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    for (const [key, entry] of entries) {
      if (
        this.totalBitmapBytes <= this.MAX_BITMAP_BYTES &&
        this.bitmapCache.size <= this.MAX_BITMAP_ENTRIES
      ) {
        break;
      }
      this.bitmapCache.delete(key);
      this.totalBitmapBytes -= entry.bytes;
      try {
        entry.bitmap.close();
      } catch {}
    }
  }

  async acquireImageBitmap(ref: string, options: AcquireImageBitmapOptions = {}): Promise<ImageBitmapHandle> {
    const cacheKey = this.normalizeCacheKey(ref, options);
    if (!cacheKey) {
      throw new Error("Invalid image ref");
    }

    const cached = this.bitmapCache.get(cacheKey);
    if (cached) {
      cached.refCount += 1;
      cached.lastUsed = Date.now();
      return {
        bitmap: cached.bitmap,
        release: () => {
          cached.refCount = Math.max(0, cached.refCount - 1);
          cached.lastUsed = Date.now();
          this.evictIfNeeded();
        },
      };
    }

    const pending = this.bitmapInFlight.get(cacheKey);
    if (pending) {
      const bitmap = await pending;
      const entry = this.bitmapCache.get(cacheKey);
      if (!entry) {
        // 理论上不会发生：inFlight resolve 后应写入 cache
        return { bitmap, release: () => {} };
      }
      entry.refCount += 1;
      entry.lastUsed = Date.now();
      return {
        bitmap,
        release: () => {
          entry.refCount = Math.max(0, entry.refCount - 1);
          entry.lastUsed = Date.now();
          this.evictIfNeeded();
        },
      };
    }

    const task = this.decodeBitmap(ref, options)
      .then((bitmap) => {
        const bytes = estimateBitmapBytes(bitmap.width, bitmap.height);
        this.bitmapCache.set(cacheKey, {
          bitmap,
          bytes,
          refCount: 0,
          lastUsed: Date.now(),
        });
        this.totalBitmapBytes += bytes;
        this.evictIfNeeded();
        return bitmap;
      })
      .finally(() => {
        this.bitmapInFlight.delete(cacheKey);
      });

    this.bitmapInFlight.set(cacheKey, task);

    const bitmap = await task;
    const entry = this.bitmapCache.get(cacheKey);
    if (!entry) {
      return { bitmap, release: () => {} };
    }
    entry.refCount += 1;
    entry.lastUsed = Date.now();

    return {
      bitmap,
      release: () => {
        entry.refCount = Math.max(0, entry.refCount - 1);
        entry.lastUsed = Date.now();
        this.evictIfNeeded();
      },
    };
  }

  clear() {
    for (const entry of this.bitmapCache.values()) {
      try {
        entry.bitmap.close();
      } catch {}
    }
    this.bitmapCache.clear();
    this.bitmapInFlight.clear();
    this.totalBitmapBytes = 0;
  }
}

export const imageResourceManager = new ImageResourceManager();

