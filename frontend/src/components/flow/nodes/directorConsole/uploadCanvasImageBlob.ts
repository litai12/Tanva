import { imageUploadService } from '@/services/imageUploadService';

export type HostedCanvasImage = { url: string; assetId: string };

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error('读取截图结果失败');
  const blob = await res.blob();
  if (!(blob.type || '').toLowerCase().startsWith('image/')) throw new Error('截图结果不是图片');
  return blob;
}

export async function uploadCanvasImageBlob(
  blob: Blob,
  ownerNodeId: string,
): Promise<HostedCanvasImage> {
  const result = await imageUploadService.uploadImageSource(blob, {
    dir: 'director-shots/',
    fileName: `director-shot-${ownerNodeId.slice(0, 8)}-${Date.now()}.png`,
    contentType: blob.type || 'image/png',
  });
  if (!result.success || !result.asset?.url) throw new Error('导演台截图上传失败');
  return { url: result.asset.url, assetId: result.asset.id || '' };
}
