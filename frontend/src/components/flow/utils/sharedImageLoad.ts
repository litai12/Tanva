const MAX_CACHED_IMAGES = 32;

type CachedImage = {
  promise: Promise<HTMLImageElement>;
  lastUsedAt: number;
};

const imageCache = new Map<string, CachedImage>();

const trimImageCache = () => {
  if (imageCache.size <= MAX_CACHED_IMAGES) return;
  const entries = Array.from(imageCache.entries()).sort(
    (a, b) => a[1].lastUsedAt - b[1].lastUsedAt
  );
  const removeCount = Math.max(0, imageCache.size - MAX_CACHED_IMAGES);
  for (let i = 0; i < removeCount; i += 1) {
    imageCache.delete(entries[i]?.[0] || "");
  }
};

export const loadSharedImage = (src: string): Promise<HTMLImageElement> => {
  const key = typeof src === "string" ? src.trim() : "";
  if (!key) return Promise.reject(new Error("missing image src"));

  const existing = imageCache.get(key);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing.promise;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => {
      imageCache.delete(key);
      reject(new Error("image load failed"));
    };
    img.src = key;
  });

  imageCache.set(key, { promise, lastUsedAt: Date.now() });
  trimImageCache();
  return promise;
};
