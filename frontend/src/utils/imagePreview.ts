/**
 * 生成缩略图数据 URL，默认保持较小尺寸以减少内存占用。
 */
export type ImagePreviewOptions = {
  maxSize?: number;
  mimeType?: string;
  quality?: number;
};

const loadImage = (dataUrl: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
};

export async function createImagePreviewDataUrl(
  dataUrl: string,
  options: ImagePreviewOptions = {}
): Promise<string> {
  if (typeof document === 'undefined') {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const maxSize = options.maxSize ?? 512;
  const maxDimension = Math.max(image.width, image.height) || 1;
  const scale = maxDimension > maxSize ? maxSize / maxDimension : 1;

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return dataUrl;
  }

  ctx.drawImage(image, 0, 0, width, height);
  const mimeType = options.mimeType ?? 'image/webp';
  const quality = options.quality ?? 0.85;
  try {
    return canvas.toDataURL(mimeType, quality);
  } catch {
    return dataUrl;
  }
}
