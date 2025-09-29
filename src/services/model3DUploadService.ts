import { logger } from '@/utils/logger';
import { uploadToOSS, type OssUploadOptions } from './ossUploadService';

export type Model3DFormat = 'glb' | 'gltf';

export interface Model3DUploadOptions extends OssUploadOptions {
  maxFileSize?: number;
}

export interface Model3DUploadResult {
  success: boolean;
  error?: string;
  asset?: Model3DAsset;
}

export interface Model3DAsset {
  url: string;
  key?: string;
  fileName: string;
  fileSize: number;
  format: Model3DFormat;
  contentType?: string;
}

export interface Model3DData {
  url: string;
  key?: string;
  format: Model3DFormat;
  fileName: string;
  fileSize: number;
  defaultScale: { x: number; y: number; z: number };
  defaultRotation: { x: number; y: number; z: number };
  timestamp: number;
  /** @deprecated 使用 url */
  path?: string;
}

const SUPPORTED_MODEL_EXTENSIONS: Record<string, Model3DFormat> = {
  '.glb': 'glb',
  '.gltf': 'gltf',
};

function inferFormat(fileName: string): Model3DFormat | null {
  const lower = fileName.toLowerCase();
  for (const ext of Object.keys(SUPPORTED_MODEL_EXTENSIONS)) {
    if (lower.endsWith(ext)) {
      return SUPPORTED_MODEL_EXTENSIONS[ext];
    }
  }
  return null;
}

async function uploadModelFile(file: File, options: Model3DUploadOptions = {}): Promise<Model3DUploadResult> {
  const format = inferFormat(file.name);
  if (!format) {
    return {
      success: false,
      error: '不支持的3D模型格式，请选择 GLB 或 GLTF 文件',
    };
  }

  const sizeLimit = options.maxFileSize ?? 50 * 1024 * 1024;
  if (file.size > sizeLimit) {
    return {
      success: false,
      error: `3D模型文件过大，请选择小于 ${(sizeLimit / 1024 / 1024).toFixed(1)}MB 的文件`,
    };
  }

  try {
    const dir = options.dir || (options.projectId ? `projects/${options.projectId}/models/` : 'uploads/models/');
    const uploadResult = await uploadToOSS(file, {
      ...options,
      dir,
      fileName: options.fileName || file.name,
      maxSize: options.maxSize ?? options.maxFileSize ?? sizeLimit,
      contentType: file.type || (format === 'glb' ? 'model/gltf-binary' : 'model/gltf+json'),
    });

    if (!uploadResult.success || !uploadResult.url) {
      return {
        success: false,
        error: uploadResult.error || '3D模型上传失败',
      };
    }

    const asset: Model3DAsset = {
      url: uploadResult.url,
      key: uploadResult.key,
      fileName: options.fileName || file.name,
      fileSize: file.size,
      format,
      contentType: file.type,
    };

    return { success: true, asset };
  } catch (error: any) {
    logger.error('3D 模型上传失败:', error);
    return { success: false, error: error?.message || '3D模型上传失败，请重试' };
  }
}

function createModel3DData(asset: Model3DAsset): Model3DData {
  return {
    url: asset.url,
    key: asset.key,
    path: asset.url,
    format: asset.format,
    fileName: asset.fileName,
    fileSize: asset.fileSize,
    defaultScale: { x: 1, y: 1, z: 1 },
    defaultRotation: { x: 0, y: 0, z: 0 },
    timestamp: Date.now(),
  };
}

export const model3DUploadService = {
  uploadModelFile,
  createModel3DData,
};
