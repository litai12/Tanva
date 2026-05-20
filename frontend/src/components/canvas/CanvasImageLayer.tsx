// GPU-accelerated DOM image layer — replaces paper.Raster canvas rendering.
// A single CSS matrix transform on the container maps world coordinates to CSS
// pixels for all child <img> elements, so only ONE React re-render is needed
// per zoom/pan change regardless of image count.
import React from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import type { ImageInstance } from '@/types/canvas'
import { toRenderableImageSrc } from '@/utils/imageSource'

interface Props {
  imageInstances: ImageInstance[]
}

function resolveImgSrc(img: ImageInstance): string {
  const d = img.imageData
  const candidates = [d.localDataUrl, d.remoteUrl, d.url, d.src, d.key]
  for (const c of candidates) {
    if (!c) continue
    const r = toRenderableImageSrc(c)
    if (r) return r
  }
  return ''
}

const CanvasImageLayer: React.FC<Props> = ({ imageInstances }) => {
  const zoom = useCanvasStore((s) => s.zoom)
  const panX = useCanvasStore((s) => s.panX)
  const panY = useCanvasStore((s) => s.panY)
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1

  // Paper.js view matrix: device_x = (world_x + panX) * zoom
  // CSS pixel:            css_x   = device_x / dpr = (world_x + panX) * zoom / dpr
  // CSS transform on container (children positioned in world coords):
  //   css_x = world_x * (zoom/dpr) + panX * zoom/dpr
  const scale = zoom / dpr
  const tx = (panX * zoom) / dpr
  const ty = (panY * zoom) / dpr

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: '0 0',
          transform: `matrix(${scale}, 0, 0, ${scale}, ${tx}, ${ty})`,
          willChange: 'transform',
        }}
      >
        {imageInstances.map((img) => {
          if (!img.visible) return null
          const src = resolveImgSrc(img)
          if (!src) return null
          const { x, y, width, height } = img.bounds
          return (
            <img
              key={img.id}
              src={src}
              crossOrigin="anonymous"
              draggable={false}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width,
                height,
                display: 'block',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

export default CanvasImageLayer
