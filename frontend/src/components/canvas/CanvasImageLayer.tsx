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
  // Remote URL: direct-first. Proxy is used only as runtime fallback after load error.
  const remoteCandidates = [d.remoteUrl, d.url, d.src, d.key]
  for (const c of remoteCandidates) {
    if (!c) continue
    const r = toRenderableImageSrc(c)
    if (!r) continue
    if (r.startsWith('data:') || r.startsWith('blob:')) return r
    return r
  }
  return ''
}

interface ViewportBounds {
  left: number; top: number; right: number; bottom: number
}

const SHOW_ALL: ViewportBounds = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
const IMAGE_DRAG_PREVIEW_EVENT = 'tanva:image-drag-preview'

type ImageDragPreviewMove = {
  id: string
  position: { x: number; y: number }
}

const CanvasImageLayer: React.FC<Props> = ({ imageInstances }) => {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const containerRef = React.useRef<HTMLDivElement>(null)
  const imgRefs = React.useRef<Map<string, HTMLImageElement>>(new Map())
  const boundsByIdRef = React.useRef<Map<string, { x: number; y: number }>>(new Map())
  const previewPositionsRef = React.useRef<Map<string, { x: number; y: number }>>(new Map())
  const [viewportBounds, setViewportBounds] = React.useState<ViewportBounds>(SHOW_ALL)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleRef = React.useRef<number | null>(null)
  // Tracks pan velocity (world units / ms) to bias culling margins toward movement direction
  const panVelRef = React.useRef({ vx: 0, vy: 0, lastPanX: 0, lastPanY: 0, lastT: 0 })
  // Snapshot taken when debounce fires; used in computeBounds so stale velocity isn't lost
  const cullingVelRef = React.useRef({ vx: 0, vy: 0 })
  const [proxyFallbackSrcs, setProxyFallbackSrcs] = React.useState<
    Map<string, { original: string; fallback: string }>
  >(new Map())

  // Stable display src per image — prevents blank flash during blob→proxy URL transition.
  // resolveImgSrc may return a proxy URL that differs from what DrawingController preloads
  // (DrawingController preloads the raw OSS URL; resolveImgSrc generates a /api/assets/proxy
  // URL). By preloading the exact proxy URL here and only swapping displaySrc after it loads,
  // we ensure the <img> src attribute never changes to an uncached URL.
  const confirmedSrcsRef = React.useRef<Map<string, string>>(new Map())
  const pendingPreloadsRef = React.useRef<Map<string, string>>(new Map())
  const [, forceUpdate] = React.useReducer(n => n + 1, 0)

  React.useLayoutEffect(() => {
    const nextBounds = new Map<string, { x: number; y: number }>()
    imageInstances.forEach((img) => {
      nextBounds.set(img.id, { x: img.bounds.x, y: img.bounds.y })
    })
    boundsByIdRef.current = nextBounds

    previewPositionsRef.current.forEach((preview, id) => {
      const committed = nextBounds.get(id)
      if (
        !committed ||
        (Math.abs(committed.x - preview.x) < 0.01 &&
          Math.abs(committed.y - preview.y) < 0.01)
      ) {
        const el = imgRefs.current.get(id)
        if (el) {
          el.style.transform = ''
          el.style.willChange = ''
        }
        previewPositionsRef.current.delete(id)
      }
    })
  }, [imageInstances])

  React.useEffect(() => {
    const clearPreview = (ids?: string[]) => {
      const targetIds = ids && ids.length > 0 ? ids : Array.from(previewPositionsRef.current.keys())
      targetIds.forEach((id) => {
        const el = imgRefs.current.get(id)
        if (el) {
          el.style.transform = ''
          el.style.willChange = ''
        }
        previewPositionsRef.current.delete(id)
      })
    }

    const handlePreview = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {}
      const ids = Array.isArray(detail.ids)
        ? detail.ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : undefined

      if (detail.clear) {
        clearPreview(ids)
        return
      }

      const moves = Array.isArray(detail.moves) ? (detail.moves as ImageDragPreviewMove[]) : []
      moves.forEach((move) => {
        if (!move?.id || !move.position) return
        const el = imgRefs.current.get(move.id)
        const base = boundsByIdRef.current.get(move.id)
        if (!el || !base) return
        const dx = move.position.x - base.x
        const dy = move.position.y - base.y
        previewPositionsRef.current.set(move.id, move.position)
        el.style.willChange = 'transform'
        el.style.transform =
          Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01
            ? `translate3d(${dx}px, ${dy}px, 0)`
            : ''
      })
    }

    window.addEventListener(IMAGE_DRAG_PREVIEW_EVENT, handlePreview as EventListener)
    return () => {
      window.removeEventListener(IMAGE_DRAG_PREVIEW_EVENT, handlePreview as EventListener)
    }
  }, [])

  React.useEffect(() => {
    const confirmed = confirmedSrcsRef.current
    const pending = pendingPreloadsRef.current

    imageInstances.forEach((img) => {
      if (!img.visible) return
        const rawTarget = resolveImgSrc(img)
        const fallbackEntry = proxyFallbackSrcs.get(img.id)
        const target =
          fallbackEntry && fallbackEntry.original === rawTarget
            ? fallbackEntry.fallback
            : rawTarget
        if (!target) return
        if (confirmed.get(img.id) === target) return
        if (pending.get(img.id) === target) return

      if (!confirmed.has(img.id)) {
        // First appearance: blob URLs load synchronously from local memory, confirm immediately.
        // No forceUpdate needed — render already uses the ?? target fallback.
        confirmed.set(img.id, target)
        return
      }

      // Src changed (e.g. blob → proxy URL): preload the exact URL resolveImgSrc will render.
      // Only swap confirmedSrc after the new URL is in browser memory cache to avoid blank.
      pending.set(img.id, target)
      const preloader = new window.Image()
      const finish = (src: string) => {
        if (pending.get(img.id) !== src) return
        confirmed.set(img.id, src)
        pending.delete(img.id)
        forceUpdate()
      }
      preloader.onload = () => finish(target)
      preloader.onerror = () => finish(target)
      preloader.src = target
    })

    // Remove stale entries for images that have been deleted
    const activeIds = new Set(imageInstances.map(i => i.id))
    confirmed.forEach((_, id) => { if (!activeIds.has(id)) confirmed.delete(id) })
    pending.forEach((_, id) => { if (!activeIds.has(id)) pending.delete(id) })
  }, [imageInstances, proxyFallbackSrcs])

  React.useEffect(() => {
    const activeIds = new Set(imageInstances.map((item) => item.id))
    setProxyFallbackSrcs((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const key of next.keys()) {
        if (!activeIds.has(key)) {
          changed = true
          next.delete(key)
        }
      }
      return changed ? next : prev
    })
  }, [imageInstances])

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
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
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
          const rawTargetSrc = resolveImgSrc(img)
          const fallbackEntry = proxyFallbackSrcs.get(img.id)
          const targetSrc =
            fallbackEntry && fallbackEntry.original === rawTargetSrc
              ? fallbackEntry.fallback
              : rawTargetSrc
          if (!targetSrc) return null
          // Use confirmedSrc (last successfully preloaded src) to avoid blank during transitions.
          // Falls back to targetSrc on first render before the effect confirms the initial src.
          const displaySrc = confirmedSrcsRef.current.get(img.id) ?? targetSrc
          const { x, y, width, height } = img.bounds
          const inViewport =
            x + width  > viewportBounds.left &&
            x          < viewportBounds.right &&
            y + height > viewportBounds.top  &&
            y          < viewportBounds.bottom
          return (
            <img
              key={img.id}
              ref={(node) => {
                if (node) {
                  imgRefs.current.set(img.id, node)
                } else {
                  imgRefs.current.delete(img.id)
                }
              }}
              src={displaySrc}
              onError={() => {
                if (
                  displaySrc.startsWith('data:') ||
                  displaySrc.startsWith('blob:') ||
                  displaySrc.includes('/api/assets/proxy')
                ) {
                  return
                }
                const fallback = proxifyRemoteAssetUrl(displaySrc, { forceProxy: true })
                if (!fallback || fallback === displaySrc) return
                setProxyFallbackSrcs((prev) => {
                  const existing = prev.get(img.id)
                  if (
                    existing &&
                    existing.original === rawTargetSrc &&
                    existing.fallback === fallback
                  ) {
                    return prev
                  }
                  const next = new Map(prev)
                  next.set(img.id, { original: rawTargetSrc, fallback })
                  return next
                })
              }}
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
