export type DirectorFlowPosition = { x: number; y: number }
export type DirectorOutputShot = { name: string; imageUrl: string }

export type DirectorImageNodeRequest = {
  imageUrl: string
  label: string
  imageName: string
  worldPosition?: DirectorFlowPosition
  sourceNodeId: string
  sourceHandle: 'source'
  targetHandle: 'img'
}

/**
 * Stable Director Console → Flow image-node protocol.
 * Keeping handles and placement in one pure function makes the persisted edge
 * contract independently verifiable without a browser or an OSS upload.
 */
export function buildDirectorImageNodeRequest(
  directorNodeId: string,
  directorFlowPosition: DirectorFlowPosition | null,
  shot: DirectorOutputShot,
  outputIndex: number,
): DirectorImageNodeRequest {
  return {
    imageUrl: shot.imageUrl,
    label: shot.name,
    imageName: shot.name,
    worldPosition: directorFlowPosition
      ? {
          x: directorFlowPosition.x + 520,
          y: directorFlowPosition.y + outputIndex * 280,
        }
      : undefined,
    sourceNodeId: directorNodeId,
    sourceHandle: 'source',
    targetHandle: 'img',
  }
}
