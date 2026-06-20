import type { CameraShot } from './types'
import { resolveFlowNodeSendAnchorClient } from '../../utils/flowNodeSendAnchor'

/**
 * 把机位截图（dataURL）发到画布：复用 Tanva 既有 `triggerQuickImageUpload` 流程
 * （与 ThreeNode/Seed3DNode 一致），由 FlowOverlay 负责上传 OSS + 生成 image 节点 + 锚定位置。
 * 多张时按下标错开锚点纵向偏移，避免叠在一起。
 */
export function sendShotsToCanvas(directorNodeId: string, shots: CameraShot[]): void {
  const baseAnchor = resolveFlowNodeSendAnchorClient({ nodeId: directorNodeId })
  shots.forEach((shot, i) => {
    const anchorClient = baseAnchor
      ? { x: baseAnchor.x, y: baseAnchor.y + i * 60 }
      : undefined
    window.dispatchEvent(
      new CustomEvent('triggerQuickImageUpload', {
        detail: {
          imageData: shot.imageUrl, // 截图 dataURL，FlowOverlay 自行上传
          fileName: `${shot.name || 'director-shot'}.jpg`,
          operationType: 'generate',
          anchorClient,
          forceAnchorPosition: true,
        },
      }),
    )
  })
}
