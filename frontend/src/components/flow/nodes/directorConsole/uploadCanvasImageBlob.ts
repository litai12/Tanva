import { imageUploadService } from '@/services/imageUploadService'

export type HostedCanvasImage = { url: string; assetId: string }

async function sha256Hex(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前浏览器缺少摘要能力')
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  if (!res.ok) throw new Error('读取截图结果失败')
  const blob = await res.blob()
  if (!(blob.type || '').toLowerCase().startsWith('image/')) throw new Error('截图结果不是图片')
  return blob
}

export async function uploadCanvasImageBlob(input: {
  blob: Blob
  label: string
  filePrefix: string
  ownerNodeId: string
  projectId?: string
}): Promise<HostedCanvasImage> {
  const mime = (input.blob.type || '').split(';')[0].trim() || 'image/png'
  const digest = await sha256Hex(input.blob)
  const fileName = `${input.filePrefix}-${digest.slice(0, 16)}.${extFromMime(mime)}`
  const result = await imageUploadService.uploadImageSource(input.blob, {
    dir: 'director-shots/',
    fileName,
    contentType: mime,
  })
  if (!result.success || !result.asset?.url) throw new Error(`${input.label}上传失败`)
  return { url: result.asset.url, assetId: result.asset.id || '' }
}
