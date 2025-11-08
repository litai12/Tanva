import { logger } from '@/utils/logger';
import { dataURLToBlob, getImageDimensions, uploadToOSS, type OssUploadOptions } from './ossUploadService';

export interface ImageUploadOptions extends OssUploadOptions {
  /** 允许的最大文件大小，默认 10MB */
  maxFileSize?: number;
}

export interface ImageUploadResult {
  success: boolean;
  error?: string;
  asset?: {
    id: string;
    url: string;
    key?: string;
    fileName?: string;
    width?: number;
    height?: number;
    contentType?: string;
  };
}

const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
];

function validateImageFile(file: File, options?: ImageUploadOptions): string | null {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
    return '不支持的图片格式，请选择 PNG、JPG、JPEG、GIF 或 WebP 图片';
  }
  const limit = options?.maxFileSize ?? 10 * 1024 * 1024;
  if (file.size > limit) {
    return `图片文件过大，请选择小于 ${(limit / 1024 / 1024).toFixed(1)}MB 的图片`;
  }
  return null;
}

async function uploadImageFile(file: File, options: ImageUploadOptions = {}): Promise<ImageUploadResult> {
  const validationError = validateImageFile(file, options);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const { width, height } = await getImageDimensions(file);
    const uploadResult = await uploadToOSS(file, {
      ...options,
      fileName: options.fileName || file.name,
      maxSize: options.maxSize ?? options.maxFileSize ?? 20 * 1024 * 1024,
      contentType: file.type,
    });

    if (!uploadResult.success || !uploadResult.url) {
      return { success: false, error: uploadResult.error || 'OSS 上传失败' };
    }

    return {
      success: true,
      asset: {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url: uploadResult.url,
        key: uploadResult.key,
        fileName: options.fileName || file.name,
        width,
        height,
        contentType: file.type,
      },
    };
  } catch (error: any) {
    logger.error('图片上传失败:', error);
    return { success: false, error: error?.message || '图片上传失败，请重试' };
  }
}

async function uploadImageDataUrl(dataUrl: string, options: ImageUploadOptions = {}): Promise<ImageUploadResult> {
  try {
    const blob = dataURLToBlob(dataUrl);
    const fileName = options.fileName || `image_${Date.now()}.png`;
    const file = new File([blob], fileName, { type: blob.type || 'image/png' });
    return uploadImageFile(file, { ...options, fileName });
  } catch (error: any) {
    logger.error('图片数据上传失败:', error);
    return { success: false, error: error?.message || '图片上传失败，请重试' };
  }
}

export const imageUploadService = {
  uploadImageFile,
  uploadImageDataUrl,
  validateImageFile,
};
