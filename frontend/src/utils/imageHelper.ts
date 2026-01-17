import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { canvasToDataUrl } from '@/utils/imageConcurrency';

export interface TrimTransparentResult {
  dataUrl: string;
  cropBounds: { left: number; top: number; width: number; height: number };
  originalSize: { width: number; height: number };
  changed: boolean;
}

/**
 * 加载图像元素，支持 data URL 和远程 URL
 */
export const loadImageElement = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('缺少图像地址'));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法加载图像数据'));
    img.src = proxifyRemoteAssetUrl(src);
  });
};

const normalizeDataUrl = (value: string): string => {
  const trimmed = value?.trim() || '';
  if (!trimmed) return '';
  if (/^data:image\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed}`;
};

interface TrimOptions {
  alphaThreshold?: number;
  padding?: number;
}

/**
 * 裁剪 PNG 中的透明边缘，返回新的 dataURL 及裁剪信息
 */
export async function trimTransparentPng(
  sourceData: string,
  options: TrimOptions = {}
): Promise<TrimTransparentResult | null> {
  const normalized = normalizeDataUrl(sourceData);
  if (!normalized || !normalized.startsWith('data:image/png')) {
    return null;
  }

  const image = await loadImageElement(normalized);
  const width = Math.max(1, image.naturalWidth || image.width);
  const height = Math.max(1, image.naturalHeight || image.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const threshold = Math.max(0, Math.min(255, options.alphaThreshold ?? 8));

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return {
      dataUrl: normalized,
      cropBounds: { left: 0, top: 0, width, height },
      originalSize: { width, height },
      changed: false,
    };
  }

  const padding = Math.max(0, options.padding ?? 0);
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const cropWidth = Math.max(1, maxX - minX + 1);
  const cropHeight = Math.max(1, maxY - minY + 1);

  if (minX === 0 && minY === 0 && cropWidth === width && cropHeight === height) {
    return {
      dataUrl: normalized,
      cropBounds: { left: 0, top: 0, width, height },
      originalSize: { width, height },
      changed: false,
    };
  }

  const trimmedCanvas = document.createElement('canvas');
  trimmedCanvas.width = cropWidth;
  trimmedCanvas.height = cropHeight;
  const trimmedCtx = trimmedCanvas.getContext('2d');
  if (!trimmedCtx) {
    return null;
  }

  trimmedCtx.putImageData(ctx.getImageData(minX, minY, cropWidth, cropHeight), 0, 0);
  const trimmedDataUrl = await canvasToDataUrl(trimmedCanvas, 'image/png');

  return {
    dataUrl: trimmedDataUrl,
    cropBounds: { left: minX, top: minY, width: cropWidth, height: cropHeight },
    originalSize: { width, height },
    changed: true,
  };
}

/**
 * 生成缩略图
 * @param sourceData 原始图片数据（base64 或 data URL）
 * @param maxWidth 最大宽度，默认 300
 * @param quality JPEG 质量，默认 0.8
 * @returns 缩略图的 data URL
 */
export async function generateThumbnail(
  sourceData: string,
  maxWidth: number = 300,
  quality: number = 0.8
): Promise<string | null> {
  try {
    const normalized = normalizeDataUrl(sourceData);
    if (!normalized) return null;

    const image = await loadImageElement(normalized);
    const origWidth = image.naturalWidth || image.width;
    const origHeight = image.naturalHeight || image.height;

    // 如果原图已经很小，直接返回
    if (origWidth <= maxWidth) {
      return normalized;
    }

    // 计算缩放后的尺寸
    const scale = maxWidth / origWidth;
    const newWidth = Math.round(origWidth * scale);
    const newHeight = Math.round(origHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 使用高质量缩放
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, newWidth, newHeight);

    // 返回 JPEG 格式以减小体积
    return await canvasToDataUrl(canvas, 'image/jpeg', quality);
  } catch {
    return null;
  }
}
