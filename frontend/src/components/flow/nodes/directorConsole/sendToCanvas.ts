import { dataUrlToBlob, uploadCanvasImageBlob } from './uploadCanvasImageBlob'
import { isPersistableImageRef } from '@/utils/imageSource'

// LibTV 导演台只向画布输出摄像机截图图片，不生成视频节点。

/**
 * 纯 image 节点：复用 Tanva 既有 `triggerQuickImageUpload`（与 ThreeNode/Seed3DNode 一致），
 * 由 FlowOverlay/DrawingController 上传 OSS + 生成 image 节点 + 锚定到导演台节点下方。
 * shots[].imageUrl may be a runtime dataURL or an already-persisted remote URL.
 */
export async function sendShotsToCanvas(
  directorNodeId: string,
  directorFlowPos: { x: number; y: number } | null,
  shots: { name: string; imageUrl: string }[],
): Promise<string[]> {
  const createdIds: string[] = []
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    let remoteUrl = shot.imageUrl
    if (!isPersistableImageRef(remoteUrl)) {
      const blob = await dataUrlToBlob(shot.imageUrl)
      const hosted = await uploadCanvasImageBlob({ blob, label: shot.name || '导演台截图', filePrefix: 'director-shot', ownerNodeId: directorNodeId })
      remoteUrl = hosted.url
    }
    if (!isPersistableImageRef(remoteUrl)) throw new Error(`${shot.name || '导演台截图'}未获得可持久化远程地址`)
    const createdId = await new Promise<string | null>((resolve) => {
      let settled = false
      const done = (id: string | null) => {
        if (settled) return
        settled = true
        resolve(id)
      }
      window.dispatchEvent(new CustomEvent('flow:createImageNode', {
        detail: {
          imageUrl: remoteUrl,
          label: shot.name || '导演台截图',
          imageName: shot.name || '导演台截图',
          worldPosition: directorFlowPos
            ? { x: directorFlowPos.x + 520, y: directorFlowPos.y + i * 280 }
            : undefined,
          sourceNodeId: directorNodeId,
          sourceHandle: 'source',
          targetHandle: 'img',
          done,
        },
      }))
      window.setTimeout(() => done(null), 3000)
    })
    if (!createdId) throw new Error(`${shot.name || '导演台截图'}已上传，但画布图片节点创建失败`)
    createdIds.push(createdId)
  }
  return createdIds
}
