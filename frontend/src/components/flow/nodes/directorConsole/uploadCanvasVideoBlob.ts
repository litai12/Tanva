import { ossUploadService } from '@/services/ossUploadService'

// Tanva 视频无后端 assetId（seedance v2v 从上游节点读 videoUrl，不需要 assetId）。
export type HostedCanvasVideo = { url: string; assetId: string }

async function sha256Hex(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前浏览器缺少摘要能力')
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function uploadCanvasVideoBlob(input: {
  blob: Blob
  label: string
  filePrefix: string
  ownerNodeId: string
  projectId?: string
}): Promise<HostedCanvasVideo> {
  const mime = (input.blob.type || '').split(';')[0].trim() || 'video/mp4'
  const digest = await sha256Hex(input.blob)
  const fileName = `${input.filePrefix}-${digest.slice(0, 16)}.mp4`
  const file = new File([input.blob], fileName, { type: mime, lastModified: 0 })
  const dir = input.projectId ? `projects/${input.projectId}/videos/` : 'videos/'
  const result = await ossUploadService.uploadToOSS(file, {
    dir,
    projectId: null,
    fileName,
    contentType: 'video/mp4',
    maxSize: 500 * 1024 * 1024,
  })
  if (!result.success || !result.url) throw new Error(`${input.label}上传失败`)
  return { url: result.url, assetId: '' }
}
