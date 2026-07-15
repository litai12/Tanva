import { resolveFlowNodeSendAnchorClient } from '../../utils/flowNodeSendAnchor'

// Tanva 约束：prompt 节点与 图片/视频节点是分开的。导演台产出「纯 image 节点」与「纯 video 节点」，
// 绝不建 combined taskNode、不带 prompt。喂 seedance v2v：视频走连边、prompt 由独立 prompt 节点提供。

export type HostedClip = { url: string; assetId?: string; name: string }

/**
 * 纯 image 节点：复用 Tanva 既有 `triggerQuickImageUpload`（与 ThreeNode/Seed3DNode 一致），
 * 由 FlowOverlay/DrawingController 上传 OSS + 生成 image 节点 + 锚定到导演台节点下方。
 * shots[].imageUrl 为截图 dataURL。多张时按下标纵向错开锚点，避免叠放。
 */
export function sendShotsToCanvas(directorNodeId: string, shots: { name: string; imageUrl: string }[]): void {
  const baseAnchor = resolveFlowNodeSendAnchorClient({ nodeId: directorNodeId })
  shots.forEach((shot, i) => {
    const anchorClient = baseAnchor ? { x: baseAnchor.x, y: baseAnchor.y + i * 60 } : undefined
    window.dispatchEvent(
      new CustomEvent('triggerQuickImageUpload', {
        detail: {
          imageData: shot.imageUrl,
          fileName: `${shot.name || 'director-shot'}.jpg`,
          operationType: 'generate',
          anchorClient,
          forceAnchorPosition: true,
        },
      }),
    )
  })
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
