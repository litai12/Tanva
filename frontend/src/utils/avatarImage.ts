import { normalizePersistableImageRef, toRenderableImageSrc } from '@/utils/imageSource';
import { getApiBaseUrl } from '@/utils/assetProxy';
import { fetchWithAuth } from '@/services/authFetch';

/** Decode the image itself: an HTTP 200 response can still contain an error page. */
export function canLoadAvatarImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (loaded: boolean) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    const timeout = setTimeout(() => finish(false), 15_000);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.src = src;
  });
}

/** Authenticated proxy fetch supports private buckets and desktop bearer tokens. */
export async function resolveAvatarFallback(input: string): Promise<string | null> {
  const normalized = normalizePersistableImageRef(input);
  const key = normalized.replace(/^\/+/, '');
  const query = /^(uploads|projects|templates)\//i.test(key)
    ? `key=${encodeURIComponent(key)}`
    : /^https?:\/\//i.test(normalized)
      ? `url=${encodeURIComponent(normalized)}`
      : null;
  if (!query) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchWithAuth(`${getApiBaseUrl()}/api/assets/proxy?${query}`, {
      credentials: 'include',
      allowRefresh: false,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    const mime = blob.type.toLowerCase().split(';')[0].trim();
    if (!blob.size || (mime && mime !== 'application/octet-stream' && !mime.startsWith('image/'))) return null;
    const objectUrl = URL.createObjectURL(blob);
    if (await canLoadAvatarImage(objectUrl)) return objectUrl;
    URL.revokeObjectURL(objectUrl);
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Only persist the stable upload reference after its image is actually usable. */
export async function ensureAvatarImageRenderable(input: string): Promise<void> {
  const direct = toRenderableImageSrc(input);
  if (direct && await canLoadAvatarImage(direct)) return;
  const fallback = await resolveAvatarFallback(input);
  if (!fallback) throw new Error('头像图片无法显示，请重新选择图片后上传');
  URL.revokeObjectURL(fallback);
}
