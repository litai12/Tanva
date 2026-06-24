// @ts-nocheck
import React from 'react'
import type { Node } from 'reactflow'
import { Viewport, type ViewportHandle } from './scene/Viewport'
import { aspectRatio } from './state/aspect'
import type { AspectKey, CharacterObj, DirectorScene, Vec3 } from './types'
import { dataUrlToBlob, uploadCanvasImageBlob } from './uploadCanvasImageBlob'
import { sendShotsToCanvas } from './sendToCanvas'
import { fetchWithAuth } from '@/services/authFetch'

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function getApiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL
  return base && String(base).trim() ? String(base).trim().replace(/\/+$/, '') : ''
}

async function claimDirectorCapture(
  captureId: string,
): Promise<{ ok: boolean; leaseToken?: string }> {
  const r = await fetchWithAuth(`${getApiBase()}/api/director-capture/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captureId }),
  })
  if (!r.ok && r.status !== 409) return { ok: false }
  return r.json()
}

async function reportDirectorCapture(input: {
  captureId: string
  leaseToken: string
  status: 'succeeded' | 'failed'
  imageUrl?: string
  error?: string
}): Promise<void> {
  await fetchWithAuth(`${getApiBase()}/api/director-capture/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PendingCapture = { captureId: string; scene: unknown; aspect?: string; status: 'queued' }

type CaptureJob = {
  pending: PendingCapture
  nodeId: string
  leaseToken: string
  scene: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPending(data: unknown): PendingCapture | null {
  const p = (data as { pendingCapture?: PendingCapture })?.pendingCapture
  if (p && typeof p.captureId === 'string' && p.status === 'queued' && p.scene) return p
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asVec3(value: unknown, fallback: Vec3): Vec3 {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return [value[0], value[1], value[2]] as Vec3
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * 单例执行器：监听画布上 directorConsole 节点的 data.pendingCapture 指令，
 * 原子认领后离屏渲染截图、上传 OSS、发到画布并上报结果——全程不打开导演台 Modal。
 */
export function DirectorCaptureRunner({ nodes }: { nodes: Node<any>[] }) {
  const [job, setJob] = React.useState<CaptureJob | null>(null)
  const processedRef = React.useRef<Set<string>>(new Set())
  const busyRef = React.useRef(false)

  React.useEffect(() => {
    if (busyRef.current || job) return
    for (const n of nodes) {
      if (n.type !== 'directorConsole') continue
      const data = n.data as unknown
      const pending = readPending(data)
      if (!pending || processedRef.current.has(pending.captureId)) continue
      busyRef.current = true
      processedRef.current.add(pending.captureId)
      const nodeId = n.id
      void (async () => {
        try {
          const claimed = await claimDirectorCapture(pending.captureId)
          if (!claimed.ok || !claimed.leaseToken) {
            busyRef.current = false
            return
          }
          const scene = asRecord(claimed.scene ?? pending.scene)
          setJob({ pending, nodeId, leaseToken: claimed.leaseToken, scene })
        } catch {
          busyRef.current = false
        }
      })()
      break
    }
  }, [nodes, job])

  if (!job) return null
  return (
    <OffscreenCapture
      job={job}
      onDone={() => {
        setJob(null)
        busyRef.current = false
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Offscreen renderer
// ---------------------------------------------------------------------------

function OffscreenCapture({ job, onDone }: { job: CaptureJob; onDone: () => void }) {
  const ref = React.useRef<ViewportHandle | null>(null)
  const firedRef = React.useRef(false)
  const camId = 'capture-cam'

  // 看门狗：GLB 挂起或 onSceneReady 不触发时，60 秒后上报失败并释放执行器。
  React.useEffect(() => {
    const watchdog = window.setTimeout(() => {
      if (firedRef.current) return
      firedRef.current = true
      void reportDirectorCapture({
        captureId: job.pending.captureId,
        leaseToken: job.leaseToken,
        status: 'failed',
        error: '离屏渲染超时（场景未就绪）',
      }).then(() => onDone())
    }, 60_000)
    return () => window.clearTimeout(watchdog)
  }, [job, onDone])

  const renderScene: DirectorScene = React.useMemo(() => {
    const cam = asRecord(job.scene.camera)
    const rawCharacters = Array.isArray(job.scene.characters) ? job.scene.characters : []
    const characters: CharacterObj[] = rawCharacters.map((raw, idx) => {
      const c = asRecord(raw)
      return {
        id: typeof c.id === 'string' ? c.id : `char-${idx}`,
        name: typeof c.name === 'string' ? c.name : `角色${idx + 1}`,
        modelId: typeof c.modelId === 'string' ? c.modelId : '',
        position: asVec3(c.position, [0, 0, 0]),
        rotation: asVec3(c.rotation, [0, 0, 0]),
        scale: asVec3(c.scale, [1, 1, 1]),
        uniformScale: typeof c.uniformScale === 'number' ? c.uniformScale : 1,
        colorHex: typeof c.colorHex === 'string' ? c.colorHex : '#9aa7b8',
        posePresetId: typeof c.posePresetId === 'string' ? c.posePresetId : undefined,
        pose: c.pose && typeof c.pose === 'object' ? (c.pose as CharacterObj['pose']) : undefined,
      }
    })
    const aspect = (
      typeof job.scene.aspect === 'string' ? job.scene.aspect : '16:9'
    ) as AspectKey
    return {
      characters,
      cameras: [
        {
          id: camId,
          name: '截图机位',
          position: asVec3(cam.position, [6, 4.5, 13]),
          lookAtMode: typeof cam.lookAtMode === 'string' ? cam.lookAtMode : 'manual',
          lookAt: asVec3(cam.lookAt, [0, 1, 0]),
          fovDeg: typeof cam.fovDeg === 'number' ? cam.fovDeg : 45,
        },
      ],
      aspect,
      activeCameraId: camId,
      skybox: typeof job.scene.skybox === 'string' ? job.scene.skybox : undefined,
    }
  }, [job.scene])

  const ratio = aspectRatio(renderScene.aspect, 16 / 9) || 16 / 9
  const w = 1280
  const h = Math.round(w / ratio)

  const onReady = React.useCallback(() => {
    if (firedRef.current) return
    firedRef.current = true
    void (async () => {
      try {
        const dataUrl = ref.current?.captureView()
        if (!dataUrl) throw new Error('captureView 返回空')
        // 发到画布（与手动截图路径一致）
        sendShotsToCanvas(job.nodeId, [{ imageUrl: dataUrl, name: 'director-shot' }])
        // 上传 OSS + 上报结果
        const blob = await dataUrlToBlob(dataUrl)
        const hosted = await uploadCanvasImageBlob(blob, job.nodeId)
        await reportDirectorCapture({
          captureId: job.pending.captureId,
          leaseToken: job.leaseToken,
          status: 'succeeded',
          imageUrl: hosted.url,
        })
      } catch (e) {
        await reportDirectorCapture({
          captureId: job.pending.captureId,
          leaseToken: job.leaseToken,
          status: 'failed',
          error: String((e as Error)?.message ?? e),
        })
      } finally {
        onDone()
      }
    })()
  }, [job, onDone])

  return (
    <div
      style={{
        position: 'fixed',
        left: -10000,
        top: 0,
        width: w,
        height: h,
        visibility: 'hidden',
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      <Viewport
        ref={ref}
        scene={renderScene}
        viewpoint="camera"
        skyboxUrl={renderScene.skybox}
        onSceneReady={onReady}
        onSelect={() => {}}
        onPatchCharacter={() => {}}
        onPatchCamera={() => {}}
      />
    </div>
  )
}
