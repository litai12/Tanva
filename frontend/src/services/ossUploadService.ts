import { logger } from "@/utils/logger";
import { fetchWithAuth } from "./authFetch";
import { dataUrlToBlob, fileToDataUrl } from "@/utils/imageConcurrency";

export type OssUploadOptions = {
  /** 指定上传的子目录，默认为 `uploads/` */
  dir?: string;
  /** 最大允许尺寸，默认 32MB（由后端 presign 默认值决定） */
  maxSize?: number;
  /** Suggested filename for extension inference */
  fileName?: string;
  /** 当前项目 ID，用于自动归档到项目目录 */
  projectId?: string | null;
  /** 指定 content-type */
  contentType?: string;
  /** 指定 OSS key（覆盖自动生成） */
  key?: string;
  /** Optional explicit access token for worker usage */
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
  accessId?: string;
  policy: string;
  signature: string;
  algorithm?: string;
  credential?: string;
  date?: string;
  securityToken?: string;
};

type PresignCacheEntry = {
  value: PresignResponse;
  expiresAtMs: number;
};

const PRESIGN_CACHE_TTL_FALLBACK_MS = 60_000;
const PRESIGN_CACHE_SAFETY_MS = 10_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;
const presignCache = new Map<string, PresignCacheEntry>();

async function fetchWithTimeout(
  input: string,
  init: Parameters<typeof fetchWithAuth>[1],
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchWithAuth(input, {
      ...(init || {}),
      signal: controller.signal,
    } as any);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL &&
    import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";
}

function isBackendImageRelayEnabled(): boolean {
  const raw = String((import.meta.env.VITE_IMAGE_UPLOAD_BACKEND_RELAY as string | undefined) || "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isBackendVideoRelayEnabled(): boolean {
  const raw = String((import.meta.env.VITE_VIDEO_UPLOAD_BACKEND_RELAY as string | undefined) || "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isBackendAudioRelayEnabled(): boolean {
  const raw = String((import.meta.env.VITE_AUDIO_UPLOAD_BACKEND_RELAY as string | undefined) || "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
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
      "application/pdf": ".pdf",
    };
    if (map[contentType]) return map[contentType];
  }
  return "";
}

export function dataURLToBlob(dataURL: string): Blob {
  // 🔧 修复：处理重复的 data URL 前缀（如 "data:image/png;base64,data:image/png;base64,xxx"�?
  let normalizedDataURL = dataURL;

  // 检测并修复重复前缀：如�?split(',') 后的 raw 部分仍然�?"data:" 开头，说明有重复前缀
  const firstSplit = dataURL.split(",");
  if (firstSplit.length >= 2 && firstSplit[1].startsWith("data:")) {
    // 使用第二�?data URL 部分作为实际数据
    normalizedDataURL = firstSplit.slice(1).join(",");
    logger.warn("检测到重复�?data URL 前缀，已自动修复");
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
    // 兜底：极端情况下 fetch(data:) 不可用时回退到同步解�?
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

  // 后端基础地址，统一�?.env 读取；无配置默认 http://localhost:4000
  const API_BASE = getApiBaseUrl();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetchWithTimeout(`${API_BASE}/api/uploads/presign`, {
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
    // 秒级时间�?
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

function isLikelyVideoUpload(data: Blob | File, options: OssUploadOptions): boolean {
  const type = String(options.contentType || (data as File).type || "").toLowerCase();
  return type.startsWith("video/");
}

const AUDIO_EXTENSION_PATTERN =
  /\.(mp3|wav|aac|m4a|ogg|opus|flac|weba|webm|amr|aiff|aif|wma)$/i;

function isLikelyAudioUpload(data: Blob | File, options: OssUploadOptions): boolean {
  const type = String(options.contentType || (data as File).type || "").toLowerCase();
  if (type.startsWith("audio/")) return true;
  // contentType 可能因文件无类型而退化成 application/octet-stream（来自 readAsDataURL），
  // 此时退而用文件名后缀判定，避免误走「直传 TOS → CORS Failed to fetch」。
  const name = String(options.fileName || (data as File).name || "");
  return AUDIO_EXTENSION_PATTERN.test(name);
}

function isLikelyDocumentUpload(data: Blob | File, options: OssUploadOptions): boolean {
  const type = String(options.contentType || (data as File).type || "").toLowerCase();
  if (type === "application/pdf") return true;
  const name = String(options.fileName || (data as File).name || "");
  return /\.pdf$/i.test(name);
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
    const res = await fetchWithTimeout(`${API_BASE}/api/uploads/image`, {
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

async function uploadVideoViaBackend(
  data: Blob | File,
  options: OssUploadOptions,
  fallbackKey?: string,
): Promise<OssUploadResult> {
  // 视频走后端中转上传（POST /api/uploads/video），由服务端写入 OSS。
  // 浏览器不直连 TOS 桶，从根本上绕开「直传 POST 无 CORS → Failed to fetch」。
  const API_BASE = getApiBaseUrl();
  const fileName = options.fileName || "upload-video.mp4";
  const file = data instanceof File
    ? data
    : new File([data], fileName, {
        type: options.contentType || (data as File).type || "video/mp4",
      });
  const formData = new FormData();
  formData.append("file", file);
  if (options.dir) formData.append("dir", options.dir);
  if (fileName) formData.append("fileName", fileName);
  if (fallbackKey) formData.append("key", fallbackKey);

  const headers: Record<string, string> = {};
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/uploads/video`,
      {
        method: "POST",
        body: formData,
        headers,
        auth: options.authToken ? "omit" : "auto",
        credentials: options.authToken ? "omit" : "include",
      },
      // 视频可达 500MB，上传耗时远超默认 60s，给足超时窗口。
      10 * 60_000
    );
    const dataJson = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        success: false,
        error:
          dataJson?.message ||
          dataJson?.error ||
          `Backend video upload failed: ${res.status}`,
      };
    }

    const url = typeof dataJson?.url === "string" ? dataJson.url : "";
    const key = typeof dataJson?.key === "string" ? dataJson.key : "";
    if (!url) {
      return { success: false, error: "Backend video upload returned empty url" };
    }
    return { success: true, url, key: key || undefined, size: data.size };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Backend video upload failed",
    };
  }
}

const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "audio/webm",
  amr: "audio/amr",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  wma: "audio/x-ms-wma",
};

function resolveAudioContentType(
  data: Blob | File,
  options: OssUploadOptions
): string {
  const declared = String(options.contentType || (data as File).type || "").toLowerCase();
  if (declared.startsWith("audio/")) return declared;
  // contentType 退化（如 application/octet-stream）时，用文件名后缀还原出真实音频 MIME，
  // 否则后端 SUPPORTED_AUDIO_TYPES 校验会 400。
  const name = String(options.fileName || (data as File).name || "");
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m ? m[1] : "";
  return AUDIO_EXT_TO_MIME[ext] || "audio/mpeg";
}

async function uploadAudioViaBackend(
  data: Blob | File,
  options: OssUploadOptions,
  fallbackKey?: string,
): Promise<OssUploadResult> {
  // 音频走后端中转上传（POST /api/uploads/audio），由服务端写入 OSS。
  // 浏览器不直连 TOS 桶，从根本上绕开「直传 POST 无 CORS → Failed to fetch」。
  const API_BASE = getApiBaseUrl();
  const fileName = options.fileName || (data as File).name || "upload-audio.mp3";
  const audioType = resolveAudioContentType(data, options);
  const file = data instanceof File && (data.type || "").toLowerCase().startsWith("audio/")
    ? data
    : new File([data], fileName, { type: audioType });
  const formData = new FormData();
  formData.append("file", file);
  if (options.dir) formData.append("dir", options.dir);
  if (fileName) formData.append("fileName", fileName);
  if (fallbackKey) formData.append("key", fallbackKey);

  const headers: Record<string, string> = {};
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/uploads/audio`,
      {
        method: "POST",
        body: formData,
        headers,
        auth: options.authToken ? "omit" : "auto",
        credentials: options.authToken ? "omit" : "include",
      },
      // 音频最大 100MB，给足超时窗口。
      10 * 60_000
    );
    const dataJson = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        success: false,
        error:
          dataJson?.message ||
          dataJson?.error ||
          `Backend audio upload failed: ${res.status}`,
      };
    }

    const url = typeof dataJson?.url === "string" ? dataJson.url : "";
    const key = typeof dataJson?.key === "string" ? dataJson.key : "";
    if (!url) {
      return { success: false, error: "Backend audio upload returned empty url" };
    }
    return { success: true, url, key: key || undefined, size: data.size };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Backend audio upload failed",
    };
  }
}

async function uploadDocumentViaBackend(
  data: Blob | File,
  options: OssUploadOptions,
  fallbackKey?: string,
): Promise<OssUploadResult> {
  const API_BASE = getApiBaseUrl();
  const fileName = options.fileName || (data as File).name || "upload-document.pdf";
  const file = data instanceof File && (data.type || "").toLowerCase() === "application/pdf"
    ? data
    : new File([data], fileName, { type: options.contentType || "application/pdf" });
  const formData = new FormData();
  formData.append("file", file);
  if (options.dir) formData.append("dir", options.dir);
  if (fileName) formData.append("fileName", fileName);

  const headers: Record<string, string> = {};
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/uploads/document`,
      {
        method: "POST",
        body: formData,
        headers,
        auth: options.authToken ? "omit" : "auto",
        credentials: options.authToken ? "omit" : "include",
      },
      2 * 60_000
    );
    const dataJson = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        success: false,
        error:
          dataJson?.message ||
          dataJson?.error ||
          `Backend document upload failed: ${res.status}`,
      };
    }

    const url = typeof dataJson?.url === "string" ? dataJson.url : "";
    const key = typeof dataJson?.key === "string" ? dataJson.key : "";
    if (!url) {
      return { success: false, error: "Backend document upload returned empty url" };
    }
    return { success: true, url, key: key || undefined, size: data.size };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Backend document upload failed",
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
  const tryBackendImageFallback = async (
    dir: string,
    fallbackKey?: string
  ): Promise<OssUploadResult | null> => {
    if (!isLikelyImageUpload(data, options)) return null;
    const backendUpload = await uploadImageViaBackend(data, { ...options, dir }, fallbackKey);
    if (!backendUpload.success || !backendUpload.url) {
      return {
        success: false,
        error: backendUpload.error || "Backend image upload fallback failed",
      };
    }
    return backendUpload;
  };
  const tryBackendVideoFallback = async (
    dir: string,
    fallbackKey?: string
  ): Promise<OssUploadResult | null> => {
    if (!isLikelyVideoUpload(data, options)) return null;
    const backendUpload = await uploadVideoViaBackend(data, { ...options, dir }, fallbackKey);
    if (!backendUpload.success || !backendUpload.url) {
      return {
        success: false,
        error: backendUpload.error || "Backend video upload fallback failed",
      };
    }
    return backendUpload;
  };
  const tryBackendAudioFallback = async (
    dir: string,
    fallbackKey?: string
  ): Promise<OssUploadResult | null> => {
    if (!isLikelyAudioUpload(data, options)) return null;
    const backendUpload = await uploadAudioViaBackend(data, { ...options, dir }, fallbackKey);
    if (!backendUpload.success || !backendUpload.url) {
      return {
        success: false,
        error: backendUpload.error || "Backend audio upload fallback failed",
      };
    }
    return backendUpload;
  };
  const tryBackendDocumentFallback = async (
    dir: string,
    fallbackKey?: string
  ): Promise<OssUploadResult | null> => {
    if (!isLikelyDocumentUpload(data, options)) return null;
    const backendUpload = await uploadDocumentViaBackend(data, { ...options, dir }, fallbackKey);
    if (!backendUpload.success || !backendUpload.url) {
      return {
        success: false,
        error: backendUpload.error || "Backend document upload fallback failed",
      };
    }
    return backendUpload;
  };

  try {
    const dir = normalizeDir(options.dir, options.projectId);
    const isImage = isLikelyImageUpload(data, options);
    const isVideo = isLikelyVideoUpload(data, options);
    const isAudio = isLikelyAudioUpload(data, options);
    const isDocument = isLikelyDocumentUpload(data, options);

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
      return {
        success: false,
        error: backendUpload.error || "Backend image upload failed",
      };
    }

    // 视频必须走后端中转：浏览器直传 TOS 桶的 POST 没有 CORS，会直接 Failed to fetch。
    if (isVideo && isBackendVideoRelayEnabled()) {
      const extension = inferExtension(
        options.fileName,
        options.contentType || (data as File).type
      );
      const preferredKey = (() => {
        const forced = typeof options.key === "string" ? options.key.trim() : "";
        if (forced) return forced.replace(/^\/+/, "");
        return buildKey(dir, options.fileName, extension);
      })();
      const backendUpload = await uploadVideoViaBackend(data, { ...options, dir }, preferredKey);
      if (backendUpload.success && backendUpload.url) {
        const backendReadable = await verifyUploadedAssetReadable(
          backendUpload.key,
          backendUpload.url,
          options.authToken
        );
        if (backendReadable) return backendUpload;
        return {
          success: false,
          error: "Backend video upload succeeded but asset is still not readable",
        };
      }
      return {
        success: false,
        error: backendUpload.error || "Backend video upload failed",
      };
    }

    // 音频必须走后端中转：浏览器直传 TOS 桶的 POST 没有 CORS，会直接 Failed to fetch。
    if (isAudio && isBackendAudioRelayEnabled()) {
      const extension = inferExtension(
        options.fileName,
        options.contentType || (data as File).type
      );
      const preferredKey = (() => {
        const forced = typeof options.key === "string" ? options.key.trim() : "";
        if (forced) return forced.replace(/^\/+/, "");
        return buildKey(dir, options.fileName, extension);
      })();
      const backendUpload = await uploadAudioViaBackend(data, { ...options, dir }, preferredKey);
      if (backendUpload.success && backendUpload.url) {
        const backendReadable = await verifyUploadedAssetReadable(
          backendUpload.key,
          backendUpload.url,
          options.authToken
        );
        if (backendReadable) return backendUpload;
        return {
          success: false,
          error: "Backend audio upload succeeded but asset is still not readable",
        };
      }
      return {
        success: false,
        error: backendUpload.error || "Backend audio upload failed",
      };
    }

    if (isDocument) {
      const extension = inferExtension(
        options.fileName,
        options.contentType || (data as File).type
      );
      const preferredKey = (() => {
        const forced = typeof options.key === "string" ? options.key.trim() : "";
        if (forced) return forced.replace(/^\/+/, "");
        return buildKey(dir, options.fileName, extension);
      })();
      const backendUpload = await uploadDocumentViaBackend(data, { ...options, dir }, preferredKey);
      if (backendUpload.success && backendUpload.url) return backendUpload;
      return {
        success: false,
        error: backendUpload.error || "Backend document upload failed",
      };
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
          throw new Error(`Specified key must start with ${expectedPrefix}`);
        }
        return normalized;
      }
      return buildKey(presign.dir || dir, options.fileName, extension);
    })();

    const formData = new FormData();
    formData.append("key", key);
    formData.append("policy", presign.policy);
    if (presign.algorithm && presign.credential && presign.date) {
      formData.append("x-tos-algorithm", presign.algorithm);
      formData.append("x-tos-credential", presign.credential);
      formData.append("x-tos-date", presign.date);
      if (presign.securityToken) {
        formData.append("x-tos-security-token", presign.securityToken);
      }
      formData.append("x-tos-signature", presign.signature);
    } else {
      formData.append("OSSAccessKeyId", presign.accessId || "");
      formData.append("signature", presign.signature);
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

    const uploadResp = await fetchWithTimeout(presign.host, {
      method: "POST",
      body: formData,
      auth: "omit",
      allowRefresh: false,
      credentials: "omit",
    });

    if (!uploadResp.ok) {
      const text = await uploadResp.text();
      const directError = new Error(
        `OSS upload failed: ${uploadResp.status} ${uploadResp.statusText} ${text || ""}`.trim()
      );
      const fallback = await tryBackendImageFallback(dir, key);
      if (fallback) return fallback;
      const videoFallback = await tryBackendVideoFallback(dir, key);
      if (videoFallback) return videoFallback;
      throw directError;
    }

    const publicUrl = `${presign.host}/${key}`;
    if (isLikelyImageUpload(data, options)) {
      const readable = await verifyUploadedAssetReadable(key, publicUrl, options.authToken);
      if (!readable) {
        logger.warn("OSS direct upload returned success but asset is not readable", {
          key,
          publicUrl,
        });
        const fallback = await tryBackendImageFallback(dir, key);
        if (fallback) return fallback;
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
    try {
      const dir = normalizeDir(options.dir, options.projectId);
      const extension = inferExtension(
        options.fileName,
        options.contentType || (data as File).type
      );
      const fallbackKey = (() => {
        const forced = typeof options.key === "string" ? options.key.trim() : "";
        if (forced) return forced.replace(/^\/+/, "");
        return buildKey(dir, options.fileName, extension);
      })();
      const fallback = await tryBackendImageFallback(dir, fallbackKey);
      if (fallback) return fallback;
      const videoFallback = await tryBackendVideoFallback(dir, fallbackKey);
      if (videoFallback) return videoFallback;
      const audioFallback = await tryBackendAudioFallback(dir, fallbackKey);
      if (audioFallback) return audioFallback;
      const documentFallback = await tryBackendDocumentFallback(dir, fallbackKey);
      if (documentFallback) return documentFallback;
    } catch {
      // keep original error
    }

    logger.error("OSS upload failed:", error);
    return {
      success: false,
      error: error?.message || "OSS upload failed",
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
    // 直接读取即可，mimeType 信息�?File 自身提供
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
