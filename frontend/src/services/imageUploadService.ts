import { logger } from '@/utils/logger';
import { dataURLToBlob, getImageDimensions, uploadToOSS, type OssUploadOptions } from './ossUploadService';
import { createAsyncLimiter } from '@/utils/asyncLimit';
import { isRemoteUrl, resolveImageToBlob } from '@/utils/imageSource';

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
  'image/svg+xml',
];

// 限制并发上传，避免同时解码/压缩/网络导致内存峰值
const uploadLimiter = createAsyncLimiter(2);

function validateImageFile(file: File, options?: ImageUploadOptions): string | null {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
    return '不支持的图片格式，请选择 PNG、JPG、JPEG、GIF、WebP 或 SVG 图片';
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

  return uploadLimiter.run(async () => {
    try {
      // SVG 文件可能无法通过 Image 获取尺寸，使用默认值
      let width: number | undefined;
      let height: number | undefined;
      try {
        const dims = await getImageDimensions(file);
        width = dims.width;
        height = dims.height;
      } catch {
        // SVG 或其他格式可能无法获取尺寸，忽略错误
        logger.debug('无法获取图片尺寸，可能是 SVG 文件');
      }

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
  });
}

async function uploadImageSource(
  source: string | Blob | File,
  options: ImageUploadOptions = {}
): Promise<ImageUploadResult> {
  try {
    // 已是远程 URL：不重复上传，直接返回
    if (typeof source === 'string' && isRemoteUrl(source)) {
      const url = source.trim();
      return {
        success: true,
        asset: {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          url,
          fileName: options.fileName,
          contentType: options.contentType,
        },
      };
    }

    if (source instanceof File) {
      return uploadImageFile(source, options);
    }

    let blob: Blob | null = null;
    if (source instanceof Blob) {
      blob = source;
    } else if (typeof source === 'string') {
      // 优先用 fetch 解码 dataURL/blobURL/remoteURL，减少 JS 堆峰值；失败则回退到 atob 解码 dataURL
      blob =
        (await resolveImageToBlob(source, { preferProxy: true })) ||
        (source.startsWith('data:') ? dataURLToBlob(source) : null);
    }

    if (!blob) {
      return { success: false, error: '无法读取图片数据' };
    }

    const fileName = options.fileName || `image_${Date.now()}.png`;
    const file = new File([blob], fileName, {
      type: options.contentType || blob.type || 'image/png',
    });
    return uploadImageFile(file, { ...options, fileName });
  } catch (error: any) {
    logger.error('图片数据上传失败:', error);
    return { success: false, error: error?.message || '图片上传失败，请重试' };
  }
}

async function uploadImageDataUrl(dataUrl: string, options: ImageUploadOptions = {}): Promise<ImageUploadResult> {
  return uploadImageSource(dataUrl, options);
}

export const imageUploadService = {
  uploadImageFile,
  uploadImageSource,
  uploadImageDataUrl,
  validateImageFile,
};
