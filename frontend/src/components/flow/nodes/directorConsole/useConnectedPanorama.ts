import React from 'react'
import { useStore } from '@xyflow/react'
import { resolveImageToBlob } from '@/utils/imageSource'
import { createImageBitmapLimited } from '@/utils/imageConcurrency'
import { getImageSplitHandleIndex } from '../../utils/imageSplitHandles'

type CropSpec = {
  baseRef: string
  x: number
  y: number
  width: number
  height: number
  sourceWidth?: number
  sourceHeight?: number
}

type InputSpec = { url: string; crop?: CropSpec } | null

const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function nodeImageUrl(data: any): string {
  return stringValue(data?.imageUrl)
    || stringValue(data?.imageData)
    || stringValue(data?.imageResults?.[0]?.url)
    || stringValue(data?.results?.[0]?.url)
    || stringValue(data?.url)
}

async function cropToBlob(spec: CropSpec): Promise<Blob | null> {
  const source = await resolveImageToBlob(spec.baseRef, { preferProxy: true })
  if (!source) return null
  const bitmap = await createImageBitmapLimited(source)
  try {
    const sourceWidth = spec.sourceWidth && spec.sourceWidth > 0 ? spec.sourceWidth : bitmap.width
    const sourceHeight = spec.sourceHeight && spec.sourceHeight > 0 ? spec.sourceHeight : bitmap.height
    const scaleX = bitmap.width / sourceWidth
    const scaleY = bitmap.height / sourceHeight
    const sx = Math.max(0, Math.min(bitmap.width - 1, Math.round(spec.x * scaleX)))
    const sy = Math.max(0, Math.min(bitmap.height - 1, Math.round(spec.y * scaleY)))
    const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(spec.width * scaleX)))
    const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(spec.height * scaleY)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(spec.width))
    canvas.height = Math.max(1, Math.round(spec.height))
    canvas.getContext('2d')?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } finally {
    bitmap.close()
  }
}

/** Resolve the Director `target` input to what the upstream image node currently renders.
 * Crops stay as a short-lived object URL and are never written into design JSON. */
export function useConnectedPanorama(nodeId: string): string | undefined {
  const serialized = useStore((state: any) => {
    const edge = (state.edges ?? []).find((item: any) => item.target === nodeId && (!item.targetHandle || item.targetHandle === 'target'))
    if (!edge) return ''
    const source = (state.nodeLookup as Map<string, any>)?.get(edge.source)
    const data = source?.data ?? {}
    if (source?.type === 'imageSplit') {
      const index = getImageSplitHandleIndex(edge.sourceHandle)
      const rect = index === null ? null : data.splitRects?.[index]
      const baseRef = stringValue(data.inputImageUrl) || stringValue(data.inputImage)
      if (rect && baseRef) return JSON.stringify({ url: baseRef, crop: { baseRef, x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height), sourceWidth: data.sourceWidth, sourceHeight: data.sourceHeight } })
    }
    const url = nodeImageUrl(data)
    const crop = data.crop
    if (url && crop && Number(crop.width) > 0 && Number(crop.height) > 0) {
      return JSON.stringify({ url, crop: { baseRef: url, x: Number(crop.x) || 0, y: Number(crop.y) || 0, width: Number(crop.width), height: Number(crop.height), sourceWidth: crop.sourceWidth, sourceHeight: crop.sourceHeight } })
    }
    return url ? JSON.stringify({ url }) : ''
  })
  const spec = React.useMemo<InputSpec>(() => serialized ? JSON.parse(serialized) : null, [serialized])
  const [runtimeUrl, setRuntimeUrl] = React.useState<string>()

  React.useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined
    if (!spec) { setRuntimeUrl(undefined); return }
    if (!spec.crop) { setRuntimeUrl(spec.url); return }
    void cropToBlob(spec.crop).then((blob) => {
      if (cancelled) return
      if (!blob) { setRuntimeUrl(spec.url); return }
      objectUrl = URL.createObjectURL(blob)
      setRuntimeUrl(objectUrl)
    }).catch(() => { if (!cancelled) setRuntimeUrl(spec.url) })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [spec])

  return runtimeUrl
}
