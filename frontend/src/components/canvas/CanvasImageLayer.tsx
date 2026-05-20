// GPU-accelerated DOM image layer — replaces paper.Raster canvas rendering.
// A single CSS matrix transform on the container maps world coordinates to CSS
// pixels for all child <img> elements, so only ONE React re-render is needed
// per zoom/pan change regardless of image count.
//
// Viewport culling strategy: off-screen images use `visibility: hidden` rather
// than being removed from the DOM. This is the React-idiomatic equivalent of
// "DocumentFragment parking" — the DOM node stays alive (no React unmount/remount
// cycle, no re-fetch, no re-decode) but the browser can free the GPU texture.
// When an image re-enters the viewport, only a fast GPU re-upload is needed,
// not a full decode. HTMLImageElement instances remain in ImageResourceManager's
// LRU cache regardless of visibility state.
import React from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import type { ImageInstance } from '@/types/canvas'
import { toRenderableImageSrc } from '@/utils/imageSource'

interface Props {
  imageInstances: ImageInstance[]
}

// Pre-render images this many world units outside the visible viewport so they
// are ready before the user pans into view (avoids a 1-frame pop-in).
const VIEWPORT_MARGIN_WORLD = 300

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

  // Compute viewport bounds in world coordinates.
  // Inverse of css_x = world_x * scale + tx  →  world_x = (css_x - tx) / scale
  // At css_x = 0:              world_x = -panX
  // At css_x = window.innerWidth:  world_x = innerWidth * dpr/zoom - panX
  const dprOverZoom = dpr / zoom
  const vpW = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vpH = typeof window !== 'undefined' ? window.innerHeight : 1080
  const vpLeft   = -panX - VIEWPORT_MARGIN_WORLD
  const vpTop    = -panY - VIEWPORT_MARGIN_WORLD
  const vpRight  = vpW * dprOverZoom - panX + VIEWPORT_MARGIN_WORLD
  const vpBottom = vpH * dprOverZoom - panY + VIEWPORT_MARGIN_WORLD

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

          // Viewport culling: keep node in DOM (avoids remount cost) but hide it
          // with visibility:hidden so the browser can free the GPU texture.
          const inViewport =
            x + width  > vpLeft &&
            x          < vpRight &&
            y + height > vpTop  &&
            y          < vpBottom

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
                visibility: inViewport ? 'visible' : 'hidden',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

export default CanvasImageLayer
