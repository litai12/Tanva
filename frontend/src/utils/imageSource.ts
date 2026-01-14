import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";

export type RemoteUrl = `http://${string}` | `https://${string}`;
export type BlobUrl = `blob:${string}`;
export type DataUrl = `data:${string}`;
export type DataImageUrl = `data:image/${string}`;

export const isRemoteUrl = (value?: string | null): value is RemoteUrl =>
  typeof value === "string" && /^https?:\/\//i.test(value.trim());

export const isBlobUrl = (value?: string | null): value is BlobUrl =>
  typeof value === "string" && /^blob:/i.test(value.trim());

export const isDataImageUrl = (value?: string | null): value is DataImageUrl =>
  typeof value === "string" && /^data:image\//i.test(value.trim());

export const isDataUrl = (value?: string | null): value is DataUrl =>
  typeof value === "string" && /^data:/i.test(value.trim());

const normalizePossiblyDuplicatedDataUrl = (dataUrl: string): string => {
  const trimmed = dataUrl.trim();
  if (!/^data:image\//i.test(trimmed)) return trimmed;
  // 处理 "data:image/png;base64,data:image/png;base64,AAAA..." 重复前缀
  const parts = trimmed.split(",");
  if (parts.length >= 3 && parts[1].startsWith("data:")) {
    const meta = parts[0];
    const last = parts[parts.length - 1];
    return `${meta},${last}`;
  }
  return trimmed;
};

const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
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
  });

/**
 * 用于 <img src> 的安全格式化：
 * - data:image/* -> 原样（并修复重复前缀）
 * - blob:/http(s) -> 原样
 * - 其他（认为是裸 base64）-> 补 data:image/png;base64 前缀
 */
export const toRenderableImageSrc = (value?: string | null): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isDataImageUrl(trimmed)) return normalizePossiblyDuplicatedDataUrl(trimmed);
  if (isBlobUrl(trimmed) || isRemoteUrl(trimmed)) return trimmed;
  // 兜底：裸 base64
  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) return null;
  return `data:image/png;base64,${compact}`;
};

/**
 * 将任意图片输入（dataURL/base64/blobURL/remoteURL）转换为 dataURL（供 AI/上传使用）。
 * 注意：remoteURL 会优先走 proxifyRemoteAssetUrl 以降低 CORS 失败概率。
 */
export const resolveImageToDataUrl = async (
  value?: string | null,
  options?: { preferProxy?: boolean }
): Promise<string | null> => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isDataImageUrl(trimmed)) {
    return normalizePossiblyDuplicatedDataUrl(trimmed);
  }

  // 兜底：裸 base64
  if (!isRemoteUrl(trimmed) && !isBlobUrl(trimmed) && !isDataUrl(trimmed)) {
    const compact = trimmed.replace(/\s+/g, "");
    if (!compact) return null;
    return `data:image/png;base64,${compact}`;
  }

  // blob:/data:/http(s) 统一 fetch -> blob -> dataURL
  const candidates: string[] = [];
  if (isRemoteUrl(trimmed)) {
    const preferProxy = options?.preferProxy ?? true;
    if (preferProxy) {
      try {
        const proxied = proxifyRemoteAssetUrl(trimmed);
        if (proxied && proxied !== trimmed) {
          candidates.push(proxied);
        }
      } catch {
        // ignore
      }
    }
    candidates.push(trimmed);
  } else {
    candidates.push(trimmed);
  }

  for (const url of candidates) {
    try {
      const init: RequestInit = isBlobUrl(url)
        ? {}
        : { mode: "cors", credentials: "omit" };
      const response = await fetch(url, init);
      if (!response.ok) continue;
      const blob = await response.blob();
      const dataUrl = await readBlobAsDataUrl(blob);
      return normalizePossiblyDuplicatedDataUrl(dataUrl);
    } catch {
      // try next candidate
    }
  }

  return null;
};

/**
 * 将 dataURL/blobURL/remoteURL 转成 Blob（上传用）。对 dataURL 优先使用 fetch 解码，避免 atob+大数组导致 JS 堆峰值。
 */
export const resolveImageToBlob = async (
  value: string,
  options?: { preferProxy?: boolean }
): Promise<Blob | null> => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;

  const candidates: string[] = [];
  if (isRemoteUrl(trimmed)) {
    const preferProxy = options?.preferProxy ?? true;
    if (preferProxy) {
      try {
        const proxied = proxifyRemoteAssetUrl(trimmed);
        if (proxied && proxied !== trimmed) candidates.push(proxied);
      } catch {
        // ignore
      }
    }
    candidates.push(trimmed);
  } else {
    candidates.push(trimmed);
  }

  for (const url of candidates) {
    try {
      const init: RequestInit = isBlobUrl(url)
        ? {}
        : { mode: "cors", credentials: "omit" };
      const response = await fetch(url, init);
      if (!response.ok) continue;
      return await response.blob();
    } catch {
      // try next candidate
    }
  }
  return null;
};
