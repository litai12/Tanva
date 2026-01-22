import { getPublicAssetBaseUrl, proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import {
  FLOW_IMAGE_ASSET_PREFIX,
  getFlowImageBlob,
  parseFlowImageAssetRef,
} from "@/services/flowImageAssetStore";
import { blobToDataUrl, responseToBlob } from "@/utils/imageConcurrency";
import { fetchWithAuth } from "@/services/authFetch";

export type RemoteUrl = `http://${string}` | `https://${string}`;
export type BlobUrl = `blob:${string}`;
export type DataUrl = `data:${string}`;
export type DataImageUrl = `data:image/${string}`;

// 优先使用环境变量配置的 OSS URL，否则使用默认值
const getOssBaseUrl = (): string => {
  const envBase = getPublicAssetBaseUrl();
  if (envBase) return envBase.endsWith("/") ? envBase : `${envBase}/`;
  return "https://tai-tanva-ai.oss-cn-shenzhen.aliyuncs.com/";
};

export const isRemoteUrl = (value?: string | null): value is RemoteUrl =>
  typeof value === "string" && /^https?:\/\//i.test(value.trim());

export const normalizeRemoteUrl = (value?: string | null): RemoteUrl | null => {
  if (!isRemoteUrl(value)) return null;
  return value.trim() as RemoteUrl;
};

export const areAllRemoteUrls = (
  values: Array<string | null | undefined>
): values is RemoteUrl[] => {
  if (!Array.isArray(values) || values.length === 0) return false;
  return values.every((value) => isRemoteUrl(value));
};

export const collectRemoteUrls = (
  values: Array<string | null | undefined>
): RemoteUrl[] =>
  values
    .map((value) => normalizeRemoteUrl(value))
    .filter((value): value is RemoteUrl => Boolean(value));

export const isBlobUrl = (value?: string | null): value is BlobUrl =>
  typeof value === "string" && /^blob:/i.test(value.trim());

export const isDataImageUrl = (value?: string | null): value is DataImageUrl =>
  typeof value === "string" && /^data:image\//i.test(value.trim());

export const isDataUrl = (value?: string | null): value is DataUrl =>
  typeof value === "string" && /^data:/i.test(value.trim());

export const isAssetProxyRef = (value?: string | null): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith("/api/assets/proxy") ||
    trimmed.startsWith("/assets/proxy")
  ) {
    return true;
  }
  if (!isRemoteUrl(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.pathname === "/api/assets/proxy" || url.pathname === "/assets/proxy";
  } catch {
    return false;
  }
};

export const isAssetKeyRef = (value?: string | null): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const withoutLeading = trimmed.replace(/^\/+/, "");
  return /^(templates|projects|uploads|videos)\//i.test(withoutLeading);
};

export const isPersistableImageRef = (value?: string | null): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    isDataUrl(trimmed) ||
    isBlobUrl(trimmed) ||
    trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)
  ) {
    return false;
  }
  if (isRemoteUrl(trimmed)) return true;
  if (isAssetProxyRef(trimmed)) return true;
  if (isAssetKeyRef(trimmed)) return true;
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return true;
  }
  return false;
};

/**
 * 将可持久化的图片引用做“去代理包装”：
 * - /api/assets/proxy?key=xxx -> xxx
 * - /api/assets/proxy?url=https://... -> https://...
 * 其他情况原样返回（trim 后）。
 */
export const normalizePersistableImageRef = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (!isAssetProxyRef(trimmed)) return trimmed;

  try {
    const base =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost";
    const url = new URL(trimmed, base);
    const key = url.searchParams.get("key");
    if (key) return key.replace(/^\/+/, "");
    const remote = url.searchParams.get("url");
    if (remote) return remote;
  } catch {
    // ignore
  }
  return trimmed;
};

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

/**
 * 用于 <img src> 的安全格式化：
 * - data:image/* -> 原样（并修复重复前缀）
 * - blob:/http(s) -> 原样（http(s) 会按需要走 assets proxy）
 * - /api/assets/proxy?... -> 补齐 base（适配生产静态部署）
 * - OSS key (projects/... 等) -> 转为 /api/assets/proxy?key=...
 * - 其他路径（/ ./ ../）-> 原样（视为同源静态资源）
 * - 其他（认为是裸 base64）-> 补 data:image/png;base64 前缀
 */
export const toRenderableImageSrc = (value?: string | null): string | null => {
  if (!value || typeof value !== "string") return null;
  const normalized = normalizePersistableImageRef(value);
  const trimmed = normalized.trim();
  if (!trimmed) return null;
  if (isDataImageUrl(trimmed)) return normalizePossiblyDuplicatedDataUrl(trimmed);
  if (isBlobUrl(trimmed)) return trimmed;
  if (isAssetKeyRef(trimmed)) {
    const withoutLeading = trimmed.replace(/^\/+/, "");
    return `${getOssBaseUrl()}${withoutLeading}`;
  }
  if (isRemoteUrl(trimmed)) return trimmed;
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }
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

  console.log(`[resolveImageToDataUrl] 输入: ${trimmed.slice(0, 80)}...`);

  const flowAssetId = parseFlowImageAssetRef(trimmed);
  if (flowAssetId) {
    console.log(`[resolveImageToDataUrl] 检测到 flow-asset 引用, assetId: ${flowAssetId}`);
    try {
      const blob = await getFlowImageBlob(flowAssetId);
      if (!blob) {
        console.warn(`[resolveImageToDataUrl] flow-asset blob 为空, assetId: ${flowAssetId}`);
        return null;
      }
      console.log(`[resolveImageToDataUrl] flow-asset blob 获取成功, size: ${blob.size}, type: ${blob.type}`);
      const dataUrl = await blobToDataUrl(blob);
      console.log(`[resolveImageToDataUrl] flow-asset 转换成功: ${dataUrl.slice(0, 50)}...`);
      return normalizePossiblyDuplicatedDataUrl(dataUrl);
    } catch (err) {
      console.error(`[resolveImageToDataUrl] flow-asset 转换失败:`, err);
      return null;
    }
  }

  if (isDataImageUrl(trimmed)) {
    console.log(`[resolveImageToDataUrl] 已是 data URL`);
    return normalizePossiblyDuplicatedDataUrl(trimmed);
  }

  // blob:/data:/http(s)/proxy-path/key/path 统一 fetch -> blob -> dataURL
  const candidates: string[] = [];
  if (isRemoteUrl(trimmed)) {
    console.log(`[resolveImageToDataUrl] 远程 URL`);
    const preferProxy = options?.preferProxy ?? true;
    if (preferProxy) {
      try {
        const proxied = proxifyRemoteAssetUrl(trimmed);
        if (proxied && proxied !== trimmed) candidates.push(proxied);
      } catch {}
    }
    candidates.push(trimmed);
  } else if (isBlobUrl(trimmed)) {
    console.log(`[resolveImageToDataUrl] blob URL`);
    candidates.push(trimmed);
  } else if (isDataUrl(trimmed)) {
    console.log(`[resolveImageToDataUrl] data URL (非图片)`);
    candidates.push(trimmed);
  } else if (isAssetProxyRef(trimmed)) {
    console.log(`[resolveImageToDataUrl] asset proxy 引用`);
    candidates.push(proxifyRemoteAssetUrl(trimmed));
  } else if (isAssetKeyRef(trimmed)) {
    console.log(`[resolveImageToDataUrl] asset key 引用`);
    const withoutLeading = trimmed.replace(/^\/+/, "");
    // 优先直接使用 OSS URL（CORS 已配置），避免走代理
    const directOssUrl = `${getOssBaseUrl()}${withoutLeading}`;
    candidates.push(directOssUrl);
    // 备选：走代理
    candidates.push(
      proxifyRemoteAssetUrl(
        `/api/assets/proxy?key=${encodeURIComponent(withoutLeading)}`
      )
    );
  } else if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    console.log(`[resolveImageToDataUrl] 相对路径`);
    try {
      const base =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "http://localhost";
      candidates.push(new URL(trimmed, base).toString());
    } catch {
      // ignore
    }
  } else {
    // 兜底：裸 base64
    console.log(`[resolveImageToDataUrl] 兜底处理为裸 base64`);
    const compact = trimmed.replace(/\s+/g, "");
    if (!compact) return null;
    return `data:image/png;base64,${compact}`;
  }

  console.log(`[resolveImageToDataUrl] 候选 URL 数量: ${candidates.length}`);

  for (const url of candidates) {
    console.log(`[resolveImageToDataUrl] 尝试 fetch: ${url.slice(0, 80)}...`);
    try {
      // 判断是否需要认证：本地 API 代理需要认证
      const needsAuth = url.includes("/api/assets/proxy") || url.includes("/assets/proxy");
      const init: RequestInit = isBlobUrl(url)
        ? {}
        : { mode: "cors", credentials: needsAuth ? "include" : "omit" };
      const response = await fetchWithAuth(url, {
        ...init,
        auth: needsAuth ? "auto" : "omit",
        allowRefresh: false,
      });
      if (!response.ok) {
        console.warn(`[resolveImageToDataUrl] fetch 失败: ${response.status}`);
        continue;
      }
      const blob = await responseToBlob(response);
      // 验证 blob 是图片类型
      if (!blob.type.startsWith("image/")) {
        console.warn(
          `[resolveImageToDataUrl] 跳过非图片类型: ${blob.type}, url: ${url}`
        );
        continue;
      }
      const dataUrl = await blobToDataUrl(blob);
      console.log(`[resolveImageToDataUrl] 转换成功: ${dataUrl.slice(0, 50)}...`);
      return normalizePossiblyDuplicatedDataUrl(dataUrl);
    } catch (err) {
      console.warn(`[resolveImageToDataUrl] fetch 异常:`, err);
      // try next candidate
    }
  }

  console.warn(`[resolveImageToDataUrl] 所有候选 URL 均失败`);
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

  const flowAssetId = parseFlowImageAssetRef(trimmed);
  if (flowAssetId) {
    try {
      return await getFlowImageBlob(flowAssetId);
    } catch {
      return null;
    }
  }

  const candidates: string[] = [];
  if (isRemoteUrl(trimmed)) {
    const preferProxy = options?.preferProxy ?? true;
    if (preferProxy) {
      try {
        const proxied = proxifyRemoteAssetUrl(trimmed);
        if (proxied && proxied !== trimmed) candidates.push(proxied);
      } catch {}
    }
    candidates.push(trimmed);
  } else if (isBlobUrl(trimmed) || isDataUrl(trimmed)) {
    candidates.push(trimmed);
  } else if (isAssetProxyRef(trimmed)) {
    candidates.push(proxifyRemoteAssetUrl(trimmed));
  } else if (isAssetKeyRef(trimmed)) {
    const withoutLeading = trimmed.replace(/^\/+/, "");
    candidates.push(
      proxifyRemoteAssetUrl(
        `/api/assets/proxy?key=${encodeURIComponent(withoutLeading)}`
      )
    );
  } else if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    try {
      const base =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "http://localhost";
      candidates.push(new URL(trimmed, base).toString());
    } catch {
      // ignore
    }
  } else {
    // 裸 base64：补 data:image 前缀后再 fetch，避免 atob+大数组导致 JS 堆峰值
    const compact = trimmed.replace(/\s+/g, "");
    if (!compact) return null;
    return await resolveImageToBlob(`data:image/png;base64,${compact}`, options);
  }

  for (const url of candidates) {
    try {
      const init: RequestInit = isBlobUrl(url)
        ? {}
        : { mode: "cors", credentials: "omit" };
      const response = await fetchWithAuth(url, {
        ...init,
        auth: "omit",
        allowRefresh: false,
      });
      if (!response.ok) continue;
      const blob = await responseToBlob(response);
      // 验证 blob 是图片类型
      if (blob.type && !blob.type.startsWith("image/")) {
        console.warn(
          `[resolveImageToBlob] 跳过非图片类型: ${blob.type}, url: ${url}`
        );
        continue;
      }
      return blob;
    } catch {
      // try next candidate
    }
  }
  return null;
};

/**
 * 将任意图片输入转换为可用于渲染的 ObjectURL（blob:...）。
 * 用途：避免在 UI（尤其画布）上直接使用 data:image/base64。
 */
export const resolveImageToObjectUrl = async (
  value?: string | null,
  options?: { preferProxy?: boolean }
): Promise<string | null> => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const blob = await resolveImageToBlob(trimmed, options);
  if (!blob) return null;
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
};
