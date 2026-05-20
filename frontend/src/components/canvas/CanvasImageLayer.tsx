// GPU-accelerated DOM image layer — replaces paper.Raster canvas rendering.
//
// Performance architecture:
//   Transform updates: Zustand subscribe → direct containerRef.style.transform mutation.
//     During pan/zoom (60 fps) this produces ZERO React re-renders. The GPU compositor
//     handles the CSS matrix change with no layout/paint work.
//   Viewport culling: debounced React state update, runs 100 ms after movement stops.
//     Off-screen images use visibility:hidden (DOM node preserved, GPU texture freed).
//     This is React's equivalent of DocumentFragment parking — avoids remount cost,
//     avoids network re-fetch, only GPU re-upload needed on return.
//   Image src resolution: stable per-image, not affected by pan/zoom.
import React from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import type { ImageInstance } from '@/types/canvas'
import { toRenderableImageSrc } from '@/utils/imageSource'

interface Props {
  imageInstances: ImageInstance[]
}

const VIEWPORT_MARGIN_WORLD = 300
const CULLING_DEBOUNCE_MS = 100

const scheduleIdle: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number =
  typeof requestIdleCallback !== 'undefined'
    ? (cb, opts) => requestIdleCallback(cb, opts)
    : (cb) => window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0)

const cancelIdle: (id: number) => void =
  typeof cancelIdleCallback !== 'undefined'
    ? (id) => cancelIdleCallback(id)
    : (id) => clearTimeout(id)

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

interface ViewportBounds {
  left: number; top: number; right: number; bottom: number
}

const SHOW_ALL: ViewportBounds = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }

const CanvasImageLayer: React.FC<Props> = ({ imageInstances }) => {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [viewportBounds, setViewportBounds] = React.useState<ViewportBounds>(SHOW_ALL)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleRef = React.useRef<number | null>(null)

  // Transform bypass: subscribe to Zustand directly and mutate DOM.
  // Pan/zoom at 60 fps → ZERO React renders.
  React.useEffect(() => {
    const applyTransform = (zoom: number, panX: number, panY: number) => {
      const el = containerRef.current
      if (!el) return
      const scale = zoom / dpr
      const tx = (panX * zoom) / dpr
      const ty = (panY * zoom) / dpr
      el.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${tx}, ${ty})`
    }
    // Sync immediately on mount so first render is correct.
    const { zoom, panX, panY } = useCanvasStore.getState()
    applyTransform(zoom, panX, panY)
    return useCanvasStore.subscribe((s) => applyTransform(s.zoom, s.panX, s.panY))
  }, [dpr])

  // Culling update: debounced via requestIdleCallback, runs after pan/zoom settles.
  // During movement: images stay at their last-known visibility (300 world unit margin
  // ensures pre-visibility before entering view).
  React.useEffect(() => {
    const computeBounds = (): ViewportBounds => {
      const { zoom, panX, panY } = useCanvasStore.getState()
      const dprOverZoom = dpr / zoom
      const vpW = typeof window !== 'undefined' ? window.innerWidth : 1920
      const vpH = typeof window !== 'undefined' ? window.innerHeight : 1080
      return {
        left:   -panX - VIEWPORT_MARGIN_WORLD,
        top:    -panY - VIEWPORT_MARGIN_WORLD,
        right:  vpW * dprOverZoom - panX + VIEWPORT_MARGIN_WORLD,
        bottom: vpH * dprOverZoom - panY + VIEWPORT_MARGIN_WORLD,
      }
    }

    const scheduleCulling = () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
      if (idleRef.current !== null) cancelIdle(idleRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        idleRef.current = scheduleIdle(() => {
          idleRef.current = null
          setViewportBounds(computeBounds())
        }, { timeout: 500 })
      }, CULLING_DEBOUNCE_MS)
    }

    setViewportBounds(computeBounds())
    return useCanvasStore.subscribe(scheduleCulling)
  }, [dpr])

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
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {imageInstances.map((img) => {
          if (!img.visible) return null
          const src = resolveImgSrc(img)
          if (!src) return null
          const { x, y, width, height } = img.bounds
          const inViewport =
            x + width  > viewportBounds.left &&
            x          < viewportBounds.right &&
            y + height > viewportBounds.top  &&
            y          < viewportBounds.bottom
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
