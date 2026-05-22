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
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy'

interface Props {
  imageInstances: ImageInstance[]
}

const VIEWPORT_MARGIN_WORLD = 300
const CULLING_DEBOUNCE_MS = 100
// Direction-aware prefetch: how many ms of movement to pre-expand the margin
const LOOKAHEAD_MS = 250
// Cap extra expansion so a very fast fling doesn't load half the canvas
const MAX_EXTRA_MARGIN = 1200

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
  // localDataUrl (blob URL or data URL) — instant, no auth/CORS required.
  // Blob URLs are valid for <img> but blocked by toRenderableImageSrc, so return directly.
  if (d.localDataUrl) {
    if (d.localDataUrl.startsWith('blob:')) return d.localDataUrl
    const r = toRenderableImageSrc(d.localDataUrl)
    if (r) return r
  }
  // Remote URL fallbacks: route through backend proxy so private OSS buckets load correctly.
  // A plain <img> cannot send auth headers; the proxy handles OSS credentials server-side.
  const remoteCandidates = [d.remoteUrl, d.url, d.src, d.key]
  for (const c of remoteCandidates) {
    if (!c) continue
    const r = toRenderableImageSrc(c)
    if (!r) continue
    if (r.startsWith('data:') || r.startsWith('blob:')) return r
    if (r.includes('/api/assets/proxy')) return r  // already proxified
    return proxifyRemoteAssetUrl(r, { forceProxy: true })
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
  // Tracks pan velocity (world units / ms) to bias culling margins toward movement direction
  const panVelRef = React.useRef({ vx: 0, vy: 0, lastPanX: 0, lastPanY: 0, lastT: 0 })
  // Snapshot taken when debounce fires; used in computeBounds so stale velocity isn't lost
  const cullingVelRef = React.useRef({ vx: 0, vy: 0 })

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

      // Track velocity for direction-aware prefetch (world units / ms)
      const now = performance.now()
      const vel = panVelRef.current
      const dt = now - vel.lastT
      if (dt > 8) {
        vel.vx = (panX - vel.lastPanX) / dt
        vel.vy = (panY - vel.lastPanY) / dt
        vel.lastPanX = panX
        vel.lastPanY = panY
        vel.lastT = now
      }
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
      // Direction-aware margin: expand the leading edge based on last pan velocity.
      // vx>0 means panning right (canvas moves right → seeing left world content soon).
      const { vx, vy } = cullingVelRef.current
      const extraLeft   = Math.min(Math.max(0,  vx) * LOOKAHEAD_MS, MAX_EXTRA_MARGIN)
      const extraRight  = Math.min(Math.max(0, -vx) * LOOKAHEAD_MS, MAX_EXTRA_MARGIN)
      const extraTop    = Math.min(Math.max(0,  vy) * LOOKAHEAD_MS, MAX_EXTRA_MARGIN)
      const extraBottom = Math.min(Math.max(0, -vy) * LOOKAHEAD_MS, MAX_EXTRA_MARGIN)
      return {
        left:   -panX - VIEWPORT_MARGIN_WORLD - extraLeft,
        top:    -panY - VIEWPORT_MARGIN_WORLD - extraTop,
        right:  vpW * dprOverZoom - panX + VIEWPORT_MARGIN_WORLD + extraRight,
        bottom: vpH * dprOverZoom - panY + VIEWPORT_MARGIN_WORLD + extraBottom,
      }
    }

    const scheduleCulling = () => {
      // Snapshot velocity at debounce start (pan is still/just-stopped → velocity is fresh)
      cullingVelRef.current = { vx: panVelRef.current.vx, vy: panVelRef.current.vy }
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
