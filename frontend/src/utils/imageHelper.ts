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
    img.src = src;
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
  const trimmedDataUrl = trimmedCanvas.toDataURL('image/png');

  return {
    dataUrl: trimmedDataUrl,
    cropBounds: { left: minX, top: minY, width: cropWidth, height: cropHeight },
    originalSize: { width, height },
    changed: true,
  };
}
