import { dataUrlToBlob, uploadCanvasImageBlob } from './uploadCanvasImageBlob'
import { isPersistableImageRef } from '@/utils/imageSource'

// Tanva 约束：prompt 节点与 图片/视频节点是分开的。导演台产出「纯 image 节点」与「纯 video 节点」，
// 绝不建 combined taskNode、不带 prompt。喂 seedance v2v：视频走连边、prompt 由独立 prompt 节点提供。

export type HostedClip = { url: string; assetId?: string; name: string }

/**
 * 纯 image 节点：复用 Tanva 既有 `triggerQuickImageUpload`（与 ThreeNode/Seed3DNode 一致），
 * 由 FlowOverlay/DrawingController 上传 OSS + 生成 image 节点 + 锚定到导演台节点下方。
 * shots[].imageUrl 为截图 dataURL。多张时按下标纵向错开锚点，避免叠放。
 */
export async function sendShotsToCanvas(
  directorNodeId: string,
  directorFlowPos: { x: number; y: number } | null,
  shots: { name: string; imageUrl: string }[],
): Promise<string[]> {
  const createdIds: string[] = []
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    const blob = await dataUrlToBlob(shot.imageUrl)
    const hosted = await uploadCanvasImageBlob({
      blob,
      label: shot.name || '导演台截图',
      filePrefix: 'director-shot',
      ownerNodeId: directorNodeId,
    })
    if (!isPersistableImageRef(hosted.url)) throw new Error(`${shot.name || '导演台截图'}未获得可持久化远程地址`)
    const createdId = await new Promise<string | null>((resolve) => {
      let settled = false
      const done = (id: string | null) => {
        if (settled) return
        settled = true
        resolve(id)
      }
      window.dispatchEvent(new CustomEvent('flow:createImageNode', {
        detail: {
          imageUrl: hosted.url,
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

/**
 * 纯 video 节点（VideoNode，data.videoUrl）：经小T 画布桥 `flow:agent-add-node` 建，落导演台右侧。
 * VideoNode 类型名含 "video"，seedance 上游解析器会自动读 data.videoUrl 作 v2v 灰块视频源——
 * 用户把该 video 节点连到 seedance 的 video 输入即可（不在此强制连边，保持节点语义清晰）。
 */
function addVideoNode(clip: HostedClip, origin: { x: number; y: number } | null, index: number): Promise<string | null> {
  const position = origin ? { x: origin.x + 800, y: origin.y + index * 300 } : undefined
  return new Promise((resolve) => {
    let settled = false
    const done = (id: string | null) => {
      if (settled) return
      settled = true
      resolve(id)
    }
    window.dispatchEvent(
      new CustomEvent('flow:agent-add-node', {
        detail: {
          type: 'video',
          data: {
            videoUrl: clip.url,
            videoName: clip.name,
            label: clip.name,
            mimeType: 'video/mp4',
            status: 'ready',
          },
          position,
          done,
        },
      }),
    )
    // done 兜底：onAgentAddNode 同步回调，正常即刻返回；异常时 3s 后判空。
    setTimeout(() => done(null), 3000)
  })
}

/** 把渲染好的灰模样片逐个生成纯 video 节点，落导演台右侧（竖向错开）。 */
export async function sendClipsToCanvas(
  directorNodeId: string,
  directorFlowPos: { x: number; y: number } | null,
  clips: HostedClip[],
): Promise<Array<string | null>> {
  const ids: Array<string | null> = []
  for (let i = 0; i < clips.length; i++) {
    ids.push(await addVideoNode(clips[i], directorFlowPos, i))
  }
  return ids
}

/**
 * 长片拆分后的多段成片：竖向排布。video 节点之间无自然的链式语义，故不强连边
 * （区别于 TapCanvas 的 combined taskNode 首尾相连）；段序由纵向位置体现。
 */
export async function sendClipChainToCanvas(
  directorNodeId: string,
  directorFlowPos: { x: number; y: number } | null,
  clips: HostedClip[],
): Promise<Array<string | null>> {
  return sendClipsToCanvas(directorNodeId, directorFlowPos, clips)
}
