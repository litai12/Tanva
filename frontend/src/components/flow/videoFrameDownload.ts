import { zipSync } from 'fflate';
import type { VideoFrame } from './videoFrameSelection';

export type VideoFrameDownloadProgress = { completed: number; total: number };
type ImageBlobResolver = (imageUrl: string) => Promise<Blob | null>;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
};

function extensionForFrame(blob: Blob, imageUrl: string): string {
  const mime = blob.type.toLowerCase().split(';')[0].trim();
  if (MIME_EXTENSIONS[mime]) return MIME_EXTENSIONS[mime];
  try {
    const extension = new URL(imageUrl, 'https://frame.local').pathname.match(/\.([a-z0-9]+)$/i)?.[1];
    if (extension && /^(?:jpe?g|png|webp|avif|gif|bmp|tiff?|svg|ico|jxl)$/i.test(extension)) return extension.toLowerCase();
  } catch { /* The resolver can also support asset keys and runtime references. */ }
  return 'bin';
}

/** Fetch original bytes only. A failed frame rejects the whole export; no partial ZIP is returned. */
export async function buildVideoFramesZip(
  frames: VideoFrame[],
  resolveBlob: ImageBlobResolver,
  onProgress?: (progress: VideoFrameDownloadProgress) => void,
): Promise<Blob> {
  if (frames.length === 0) throw new Error('没有可下载的帧 / No frames to download');
  const entries: Record<string, Uint8Array> = {};
  onProgress?.({ completed: 0, total: frames.length });
  for (let position = 0; position < frames.length; position += 1) {
    const frame = frames[position];
    try {
      if (!frame.imageUrl?.trim()) throw new Error('原图地址不存在 / Original image URL is missing');
      const blob = await resolveBlob(frame.imageUrl);
      if (!blob || blob.size === 0) throw new Error('无法读取原图 / Unable to read original image');
      if (blob.type && !blob.type.toLowerCase().startsWith('image/')) {
        throw new Error('原图响应不是图片 / Original response is not an image');
      }
      const index = Number.isSafeInteger(frame.index) && frame.index >= 1 ? frame.index : position + 1;
      const milliseconds = Number.isFinite(frame.timestamp) ? Math.max(0, Math.round(frame.timestamp * 1000)) : 0;
      const stem = `frame_${String(index).padStart(4, '0')}_${milliseconds}ms`;
      const extension = extensionForFrame(blob, frame.imageUrl);
      let filename = `${stem}.${extension}`;
      // Duplicate historical frame numbers must never overwrite another ZIP entry.
      let duplicate = 2;
      while (Object.hasOwn(entries, filename)) filename = `${stem}_${duplicate++}.${extension}`;
      entries[filename] = new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`帧 ${frame.index} 下载失败 / Frame ${frame.index} download failed: ${reason}`);
    }
    onProgress?.({ completed: position + 1, total: frames.length });
  }
  // Images are already compressed. STORE preserves bytes and avoids needless compression work.
  const archive = zipSync(entries, { level: 0 });
  return new Blob([new Uint8Array(archive)], { type: 'application/zip' });
}

/** Release the temporary download URL after the browser has consumed the click. */
export function saveVideoFramesZip(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  try {
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
