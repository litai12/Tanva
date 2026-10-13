import { useEffect, useState } from 'react';
import { useNonBase64ImageSrc } from './useNonBase64ImageSrc';
import { resolveImageToBlob } from '@/utils/imageSource';
import { createImageBitmapLimited, canvasToBlob } from '@/utils/imageConcurrency';
import type { ImagePreviewCrop } from '@/components/ui/ImagePreviewGalleryContext';

/** Cropped preview URLs are ephemeral; never display or download the base image. */
export function useImagePreviewResource(src: string, crop?: ImagePreviewCrop): { src: string; error: boolean } {
  const renderable = useNonBase64ImageSrc(src);
  const [result, setResult] = useState<{ key: string; url: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const cropKey = crop ? JSON.stringify(crop) : '';
  const key = `${renderable || ''}:${cropKey}`;
  useEffect(() => {
    if (!renderable || !cropKey) return;
    let active = true;
    let objectUrl: string | undefined;
    const rect = JSON.parse(cropKey) as ImagePreviewCrop;
    void (async () => {
      const blob = await resolveImageToBlob(renderable, { preferProxy: true });
      if (!active) return;
      if (!blob) throw new Error('Cannot load crop source');
      const bitmap = await createImageBitmapLimited(blob);
      try {
        if (!active) return;
        const sxRatio = bitmap.width / (rect.sourceWidth || bitmap.width);
        const syRatio = bitmap.height / (rect.sourceHeight || bitmap.height);
        const sx = Math.max(0, Math.min(bitmap.width - 1, rect.x * sxRatio));
        const sy = Math.max(0, Math.min(bitmap.height - 1, rect.y * syRatio));
        const sw = Math.max(1, Math.min(bitmap.width - sx, rect.width * sxRatio));
        const sh = Math.max(1, Math.min(bitmap.height - sy, rect.height * syRatio));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rect.width));
        canvas.height = Math.max(1, Math.round(rect.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot render crop');
        context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const cropped = await canvasToBlob(canvas, { type: 'image/png' });
        if (!active) return;
        if (!cropped) throw new Error('Cannot encode crop');
        objectUrl = URL.createObjectURL(cropped);
        setResult({ key, url: objectUrl });
      } finally {
        bitmap.close();
      }
    })().catch(() => {
      // Keep unavailable crops unavailable instead of exposing the base image.
      if (active) setFailedKey(key);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [renderable, cropKey, key]);
  return { src: crop ? (result?.key === key ? result.url : '') : renderable || '', error: Boolean(crop && failedKey === key) };
}
