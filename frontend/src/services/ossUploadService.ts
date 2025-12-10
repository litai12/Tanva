import { logger } from '@/utils/logger';

export type OssUploadOptions = {
  /** 指定上传的子目录，默认为 `uploads/` */
  dir?: string;
  /** 最大允许尺寸，默认 20MB */
  maxSize?: number;
  /** 建议文件名（用于推断后缀） */
  fileName?: string;
  /** 当前项目 ID，用于自动归档到项目目录 */
  projectId?: string | null;
  /** 指定 content-type */
  contentType?: string;
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

function normalizeDir(baseDir: string | undefined, projectId?: string | null) {
  const trimmed = baseDir?.trim();
  if (trimmed) return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  if (projectId) return `projects/${projectId}/assets/`;
  return 'uploads/';
}

function inferExtension(fileName?: string, contentType?: string) {
  if (fileName && fileName.includes('.')) {
    return fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  }
  if (contentType) {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'model/gltf-binary': '.glb',
      'model/gltf+json': '.gltf',
      'application/json': '.json',
    };
    if (map[contentType]) return map[contentType];
  }
  return '';
}

export function dataURLToBlob(dataURL: string): Blob {
  // 🔧 修复：处理重复的 data URL 前缀（如 "data:image/png;base64,data:image/png;base64,xxx"）
  let normalizedDataURL = dataURL;

  // 检测并修复重复前缀：如果 split(',') 后的 raw 部分仍然以 "data:" 开头，说明有重复前缀
  const firstSplit = dataURL.split(',');
  if (firstSplit.length >= 2 && firstSplit[1].startsWith('data:')) {
    // 使用第二个 data URL 部分作为实际数据
    normalizedDataURL = firstSplit.slice(1).join(',');
    logger.warn('检测到重复的 data URL 前缀，已自动修复');
  }

  const [meta, raw] = normalizedDataURL.split(',');
  const isBase64 = meta.includes(';base64');
  const mimeMatch = /data:([^;]+)/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
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

async function requestPresign(dir: string, maxSize?: number): Promise<PresignResponse> {
  const res = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ dir, maxSize }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || '获取上传凭证失败');
  }
  return data as PresignResponse;
}

function buildKey(dir: string, fileName?: string, extensionHint?: string) {
  const ext = inferExtension(fileName, undefined) || extensionHint || '';
  const safeName = fileName?.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const finalName = safeName ? `${timestamp}_${random}_${safeName}` : `${timestamp}_${random}${ext}`;
  return `${dir}${finalName}`;
}

export async function uploadToOSS(data: Blob | File, options: OssUploadOptions = {}): Promise<OssUploadResult> {
  try {
    const dir = normalizeDir(options.dir, options.projectId);
    const presign = await requestPresign(dir, options.maxSize);

    const extension = inferExtension(options.fileName, options.contentType || (data as File).type);
    const key = buildKey(presign.dir || dir, options.fileName, extension);

    const formData = new FormData();
    formData.append('key', key);
    formData.append('policy', presign.policy);
    formData.append('OSSAccessKeyId', presign.accessId);
    formData.append('signature', presign.signature);
    formData.append('success_action_status', '200');
    if (options.contentType) {
      formData.append('Content-Type', options.contentType);
    }
    formData.append('file', data instanceof File ? data : new File([data], options.fileName || 'upload', { type: options.contentType || (data as File).type || 'application/octet-stream' }));

    const uploadResp = await fetch(presign.host, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResp.ok) {
      const text = await uploadResp.text();
      throw new Error(`OSS 上传失败: ${uploadResp.status} ${uploadResp.statusText} ${text || ''}`.trim());
    }

    const publicUrl = `${presign.host}/${key}`;
    return {
      success: true,
      url: publicUrl,
      key,
      size: data.size,
    };
  } catch (error: any) {
    logger.error('OSS 上传失败:', error);
    return {
      success: false,
      error: error?.message || 'OSS 上传失败',
    };
  }
}

export async function getImageDimensions(file: File | Blob): Promise<{ width: number; height: number }> {
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

export async function fileToDataURL(file: File | Blob, mimeType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('文件读取失败'));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    if (file instanceof File && mimeType && file.type !== mimeType) {
      // 直接读取即可，mimeType 信息由 File 自身提供
    }
    reader.readAsDataURL(file);
  });
}

export const ossUploadService = {
  uploadToOSS,
  dataURLToBlob,
  getImageDimensions,
  fileToDataURL,
};
