import { logger } from "@/utils/logger";
import { fetchWithAuth } from "./authFetch";
import { dataUrlToBlob, fileToDataUrl } from "@/utils/imageConcurrency";

export type OssUploadOptions = {
  /** 指定上传的子目录，默认为 `uploads/` */
  dir?: string;
  /** 最大允许尺寸，默认 32MB（由后端 presign 默认值决定） */
  maxSize?: number;
  /** 建议文件名（用于推断后缀） */
  fileName?: string;
  /** 当前项目 ID，用于自动归档到项目目录 */
  projectId?: string | null;
  /** 指定 content-type */
  contentType?: string;
  /** 指定 OSS key（覆盖自动生成） */
  key?: string;
  /** 可选：显式透传 access token（供 Worker 使用） */
  authToken?: string;
};

export type OssUploadResult = {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
  size?: number;
};

type PresignResponse = {
  host: string;
  dir: string;
  expire: number;
  accessId: string;
  policy: string;
  signature: string;
};

type PresignCacheEntry = {
  value: PresignResponse;
  expiresAtMs: number;
};

const PRESIGN_CACHE_TTL_FALLBACK_MS = 60_000;
const PRESIGN_CACHE_SAFETY_MS = 10_000;
const presignCache = new Map<string, PresignCacheEntry>();

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL &&
    import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";
}

function isBackendImageRelayEnabled(): boolean {
  const raw = String((import.meta.env.VITE_IMAGE_UPLOAD_BACKEND_RELAY as string | undefined) || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function normalizeDir(baseDir: string | undefined, projectId?: string | null) {
  const trimmed = baseDir?.trim();
  if (trimmed) return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  if (projectId) return `projects/${projectId}/assets/`;
  return "uploads/";
}

function inferExtension(fileName?: string, contentType?: string) {
  if (fileName && fileName.includes(".")) {
    return fileName.substring(fileName.lastIndexOf(".")).toLowerCase();
  }
  if (contentType) {
    const map: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "model/gltf-binary": ".glb",
      "model/gltf+json": ".gltf",
      "application/json": ".json",
    };
    if (map[contentType]) return map[contentType];
  }
  return "";
}

export function dataURLToBlob(dataURL: string): Blob {
  // 🔧 修复：处理重复的 data URL 前缀（如 "data:image/png;base64,data:image/png;base64,xxx"）
  let normalizedDataURL = dataURL;

  // 检测并修复重复前缀：如果 split(',') 后的 raw 部分仍然以 "data:" 开头，说明有重复前缀
  const firstSplit = dataURL.split(",");
  if (firstSplit.length >= 2 && firstSplit[1].startsWith("data:")) {
    // 使用第二个 data URL 部分作为实际数据
    normalizedDataURL = firstSplit.slice(1).join(",");
    logger.warn("检测到重复的 data URL 前缀，已自动修复");
  }

  const [meta, raw] = normalizedDataURL.split(",");
  const isBase64 = meta.includes(";base64");
  const mimeMatch = /data:([^;]+)/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  if (isBase64) {
    const binary = atob(raw);
    const len = binary.length;
    const array = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
  }
  return new Blob([decodeURIComponent(raw)], { type: mime });
}

export async function dataURLToBlobAsync(dataURL: string): Promise<Blob> {
  try {
    return await dataUrlToBlob(dataURL);
  } catch {
    // 兜底：极端情况下 fetch(data:) 不可用时回退到同步解码
    return dataURLToBlob(dataURL);
  }
}

async function requestPresign(
  dir: string,
  maxSize?: number,
  authToken?: string
): Promise<PresignResponse> {
  const cacheKey = `${dir}|${maxSize ?? ""}|${authToken ?? "__auto__"}`;
  const cached = presignCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + PRESIGN_CACHE_SAFETY_MS) {
    return cached.value;
  }

  // 后端基础地址，统一从 .env 读取；无配置默认 http://localhost:4000
  const API_BASE = getApiBaseUrl();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetchWithAuth(`${API_BASE}/api/uploads/presign`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dir, maxSize }),
    auth: authToken ? "omit" : "auto",
    credentials: authToken ? "omit" : "include",
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "获取上传凭证失败");
  }
  const presign = data as PresignResponse;
  const rawExpire = Number(presign.expire);
  const expiresAtMs = (() => {
    if (!Number.isFinite(rawExpire) || rawExpire <= 0) {
      return Date.now() + PRESIGN_CACHE_TTL_FALLBACK_MS;
    }
    // 毫秒级时间戳
    if (rawExpire > 1e12) return rawExpire;
    // 秒级时间戳
    if (rawExpire > 1e9) return rawExpire * 1000;
    // TTL 秒数
    return Date.now() + rawExpire * 1000;
  })();
  presignCache.set(cacheKey, { value: presign, expiresAtMs });
  return presign;
}

function isLikelyImageUpload(data: Blob | File, options: OssUploadOptions): boolean {
  const type = String(options.contentType || (data as File).type || "").toLowerCase();
  return type.startsWith("image/");
}

async function verifyUploadedAssetReadable(
  key: string | undefined,
  url: string | undefined,
  authToken?: string
): Promise<boolean> {
  const API_BASE = getApiBaseUrl();
  const relativeTarget = key
    ? `/api/assets/proxy?key=${encodeURIComponent(key)}`
    : url
      ? `/api/assets/proxy?url=${encodeURIComponent(url)}`
      : "";
  const absoluteTarget = key
    ? `${API_BASE}/api/assets/proxy?key=${encodeURIComponent(key)}`
    : url
      ? `${API_BASE}/api/assets/proxy?url=${encodeURIComponent(url)}`
      : "";
  const candidates: string[] = [];
  if (relativeTarget) candidates.push(relativeTarget);
  if (absoluteTarget && absoluteTarget !== relativeTarget) candidates.push(absoluteTarget);
  if (candidates.length === 0) return false;

  const headers: Record<string, string> = { Range: "bytes=0-0" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  for (const checkTarget of candidates) {
    try {
      const res = await fetchWithAuth(checkTarget, {
        method: "GET",
        headers,
        auth: authToken ? "omit" : "auto",
        credentials: authToken ? "omit" : "include",
        allowRefresh: false,
      });
      if (res.ok) return true;
    } catch {
      // try next target
    }
  }
  return false;
}

async function uploadImageViaBackend(
  data: Blob | File,
  options: OssUploadOptions,
  fallbackKey?: string
): Promise<OssUploadResult> {
  const API_BASE = getApiBaseUrl();
  const fileName = options.fileName || "upload-image";
  const file = data instanceof File
    ? data
    : new File([data], fileName, {
        type: options.contentType || (data as File).type || "image/png",
      });
  const formData = new FormData();
  formData.append("file", file);
  if (options.dir) formData.append("dir", options.dir);
  if (fileName) formData.append("fileName", fileName);
  if (fallbackKey) formData.append("key", fallbackKey);

  const headers: Record<string, string> = {};
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;

  try {
    const res = await fetchWithAuth(`${API_BASE}/api/uploads/image`, {
      method: "POST",
      body: formData,
      headers,
      auth: options.authToken ? "omit" : "auto",
      credentials: options.authToken ? "omit" : "include",
    });
    const dataJson = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        success: false,
        error:
          dataJson?.message ||
          dataJson?.error ||
          `Backend image upload failed: ${res.status}`,
      };
    }

    const url = typeof dataJson?.url === "string" ? dataJson.url : "";
    const key = typeof dataJson?.key === "string" ? dataJson.key : "";
    if (!url) {
      return { success: false, error: "Backend image upload returned empty url" };
    }
    return { success: true, url, key: key || undefined, size: data.size };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Backend image upload failed",
    };
  }
}

function buildKey(dir: string, fileName?: string, extensionHint?: string) {
  const ext = inferExtension(fileName, undefined) || extensionHint || "";
  const safeName = fileName?.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const finalName = safeName
    ? `${timestamp}_${random}_${safeName}`
    : `${timestamp}_${random}${ext}`;
  return `${dir}${finalName}`;
}

export function generateOssKey(
  options: Pick<OssUploadOptions, "dir" | "projectId" | "fileName" | "contentType">
): { dir: string; key: string } {
  const dir = normalizeDir(options.dir, options.projectId);
  const extension = inferExtension(options.fileName, options.contentType);
  return { dir, key: buildKey(dir, options.fileName, extension) };
}

export async function uploadToOSS(
  data: Blob | File,
  options: OssUploadOptions = {}
): Promise<OssUploadResult> {
  try {
    const dir = normalizeDir(options.dir, options.projectId);
    const isImage = isLikelyImageUpload(data, options);

    // Image uploads prefer backend relay to avoid browser-policy false positives
    // where direct OSS POST returns 200 but object is not immediately readable in render chain.
    if (isImage && isBackendImageRelayEnabled()) {
      const extension = inferExtension(
        options.fileName,
        options.contentType || (data as File).type
      );
      const preferredKey = (() => {
        const forced = typeof options.key === "string" ? options.key.trim() : "";
        if (forced) return forced.replace(/^\/+/, "");
        return buildKey(dir, options.fileName, extension);
      })();

      const backendUpload = await uploadImageViaBackend(data, { ...options, dir }, preferredKey);
      if (backendUpload.success && backendUpload.url) {
        const backendReadable = await verifyUploadedAssetReadable(
          backendUpload.key,
          backendUpload.url,
          options.authToken
        );
        if (backendReadable) return backendUpload;
        return {
          success: false,
          error: "Backend image upload succeeded but asset is still not readable",
        };
      }
      // backend failed: continue to legacy presign direct upload fallback below
      logger.warn("Backend image upload failed, fallback to direct OSS upload", {
        error: backendUpload.error,
      });
    }

    const presign = await requestPresign(dir, options.maxSize, options.authToken);

    const extension = inferExtension(
      options.fileName,
      options.contentType || (data as File).type
    );
    const key = (() => {
      const forced = typeof options.key === "string" ? options.key.trim() : "";
      if (forced) {
        const normalized = forced.replace(/^\/+/, "");
        const expectedPrefix = (presign.dir || dir).replace(/^\/+/, "");
        if (expectedPrefix && !normalized.startsWith(expectedPrefix)) {
          throw new Error(`指定 key 必须以 ${expectedPrefix} 开头`);
        }
        return normalized;
      }
      return buildKey(presign.dir || dir, options.fileName, extension);
    })();

    const formData = new FormData();
    formData.append("key", key);
    formData.append("policy", presign.policy);
    formData.append("OSSAccessKeyId", presign.accessId);
    formData.append("signature", presign.signature);
    formData.append("success_action_status", "200");
    if (options.contentType) {
      formData.append("Content-Type", options.contentType);
    }
    formData.append(
      "file",
      data instanceof File
        ? data
        : new File([data], options.fileName || "upload", {
            type:
              options.contentType ||
              (data as File).type ||
              "application/octet-stream",
          })
    );

    const uploadResp = await fetchWithAuth(presign.host, {
      method: "POST",
      body: formData,
      auth: "omit",
      allowRefresh: false,
      credentials: "omit",
    });

    if (!uploadResp.ok) {
      const text = await uploadResp.text();
      throw new Error(
        `OSS 上传失败: ${uploadResp.status} ${uploadResp.statusText} ${
          text || ""
        }`.trim()
      );
    }

    const publicUrl = `${presign.host}/${key}`;
    if (isLikelyImageUpload(data, options)) {
      const readable = await verifyUploadedAssetReadable(key, publicUrl, options.authToken);
      if (!readable) {
        logger.warn("OSS direct upload returned success but asset is not readable", {
          key,
          publicUrl,
        });
        if (isBackendImageRelayEnabled()) {
          const backendUpload = await uploadImageViaBackend(data, options, key);
          if (backendUpload.success && backendUpload.url) {
            const backendReadable = await verifyUploadedAssetReadable(
              backendUpload.key,
              backendUpload.url,
              options.authToken
            );
            if (backendReadable) return backendUpload;
            return {
              success: false,
              error: "Backend image upload succeeded but asset is still not readable",
            };
          }
          return {
            success: false,
            error: backendUpload.error || "Image upload fallback failed",
          };
        }
        return {
          success: false,
          error: "Image uploaded but remote asset is not readable",
        };
      }
    }
    return {
      success: true,
      url: publicUrl,
      key,
      size: data.size,
    };
  } catch (error: any) {
    logger.error("OSS 上传失败:", error);
    return {
      success: false,
      error: error?.message || "OSS 上传失败",
    };
  }
}

export async function getImageDimensions(
  file: File | Blob
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.width, height: img.height };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

export async function fileToDataURL(
  file: File | Blob,
  mimeType?: string
): Promise<string> {
  if (file instanceof File && mimeType && file.type !== mimeType) {
    // 直接读取即可，mimeType 信息由 File 自身提供
  }
  return await fileToDataUrl(file);
}

export const ossUploadService = {
  uploadToOSS,
  dataURLToBlob,
  dataURLToBlobAsync,
  getImageDimensions,
  fileToDataURL,
};
