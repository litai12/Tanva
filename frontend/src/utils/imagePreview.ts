/**
 * 生成缩略图数据 URL，默认保持较小尺寸以减少内存占用。
 */
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

  const compute = (async (): Promise<string> => {
    const image = await loadImage(dataUrl);
    const maxSize = options.maxSize ?? 512;
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
    const mimeType = options.mimeType ?? 'image/webp';
    const quality = options.quality ?? 0.85;
    try {
      return canvas.toDataURL(mimeType, quality);
    } catch {
      return dataUrl;
    }
  })();

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
