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
  const API_BASE =
    import.meta.env.VITE_API_BASE_URL &&
    import.meta.env.VITE_API_BASE_URL.trim().length > 0
      ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
      : "http://localhost:4000";

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
