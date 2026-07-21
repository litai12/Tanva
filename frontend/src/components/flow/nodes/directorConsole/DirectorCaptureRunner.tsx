// @ts-nocheck
import React from 'react'
import type { Node } from '@xyflow/react'
import { fetchWithAuth } from '@/services/authFetch'
import { Viewport, type ViewportHandle } from './scene/Viewport'
import { aspectRatio } from './state/aspect'
import type { AspectKey, CharacterObj, DirectorScene, Vec3 } from './types'
import { sendShotsToCanvas } from './sendToCanvas'

// Tanva 后端 director-capture 租约（薄）：claim 原子认领 + report 记结果。前端建输出节点，后端不建。
function getApiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL
  return typeof base === 'string' && base ? base.replace(/\/$/, '') : ''
}
async function claimDirectorCapture(captureId: string): Promise<{ ok: boolean; leaseToken?: string; scene?: unknown }> {
  const r = await fetchWithAuth(`${getApiBase()}/api/director-capture/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captureId }),
  })
  if (!r.ok) return { ok: false }
  return r.json()
}
async function reportDirectorCapture(input: {
  captureId: string
  leaseToken: string
  status: 'succeeded' | 'failed'
  imageUrl?: string
  videoUrl?: string
  assetId?: string
  error?: string
}): Promise<void> {
  await fetchWithAuth(`${getApiBase()}/api/director-capture/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).catch(() => {})
}

type PendingCapture = {
  captureId: string
  scene: unknown
  aspect?: string
  status: 'queued'
}

type CaptureJob = {
  pending: PendingCapture
  nodeId: string
  leaseToken: string
  scene: Record<string, unknown>
}

function readPending(data: unknown): PendingCapture | null {
  const p = (data as { pendingCapture?: PendingCapture })?.pendingCapture
  if (p && typeof p.captureId === 'string' && p.status === 'queued' && p.scene) return p
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asVec3(value: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [value[0], value[1], value[2]] as Vec3
  }
  return fallback
}

/**
 * 当前有导演台 Modal 打开的节点集合：这些节点交给 Modal 内挂的 scoped runner 认领（它更鲜活、不会被 busyRef 卡死），
 * 全局 runner 跳过它们，避免双抢 + 避免全局 runner 偶发卡死时该节点永远没人接。
 */
export const openDirectorModalNodes = new Set<string>()

/**
 * 单例执行器：监听画布上 directorConsole 节点的 data.pendingCapture 指令，
 * 原子认领（多标签页只有一个胜出）后离屏渲染机位 POV、截图、上传并回报结果——全程不打开导演台 Modal。
 * onlyNodeId：scoped 模式，只认领该节点（导演台 Modal 内挂载，负责自己这个节点）。缺省=全局，认领所有「未被 Modal 接管」的节点。
 */
export function DirectorCaptureRunner({ nodes, onlyNodeId }: { nodes: Node<any>[]; onlyNodeId?: string }) {
  const [job, setJob] = React.useState<CaptureJob | null>(null)
  const processedRef = React.useRef<Set<string>>(new Set())
  const busyRef = React.useRef(false)

  React.useEffect(() => {
    if (busyRef.current || job) return
    for (const n of nodes) {
      const data = (n as { data?: unknown }).data
      if ((n as { type?: string }).type !== 'directorConsole') continue
      // 作用域：scoped 只认领自己那个节点；全局跳过已被 Modal 接管的节点
      if (onlyNodeId ? n.id !== onlyNodeId : openDirectorModalNodes.has(n.id)) continue
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
  }, [nodes, job, onlyNodeId])

  if (!job) return null
  const onDone = () => {
    setJob(null)
    busyRef.current = false
  }
  return <OffscreenCapture job={job} onDone={onDone} />
}

/**
 * 从 capture job 派生离屏渲染用的 DirectorScene（角色 + 单个 capture-cam）。
 * 截图任务只构造角色与单个 capture-cam；导演台不再执行视频渲染。
 */
function useRenderSceneFromJob(job: CaptureJob, camId: string): DirectorScene {
  return React.useMemo(() => {
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
    const aspect = (typeof job.scene.aspect === 'string' ? job.scene.aspect : '16:9') as AspectKey
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
      skyboxYaw: typeof (job.scene as { skyboxYaw?: unknown }).skyboxYaw === 'number' ? (job.scene as { skyboxYaw?: number }).skyboxYaw : undefined,
      customMotions: Array.isArray((job.scene as { customMotions?: unknown }).customMotions)
        ? ((job.scene as { customMotions?: DirectorScene['customMotions'] }).customMotions)
        : undefined,
    }
  }, [job.scene, camId])
}

function OffscreenCapture({ job, onDone }: { job: CaptureJob; onDone: () => void }) {
  const ref = React.useRef<ViewportHandle | null>(null)
  const firedRef = React.useRef(false)
  const camId = 'capture-cam'

  // 看门狗：GLB 挂起/onSceneReady 不触发时，限时上报失败并释放执行器，
  // 否则 busyRef 永久卡死，本页面从此不再认领任何 capture（服务端表现为 claim 超时）。
  React.useEffect(() => {
    const watchdog = window.setTimeout(() => {
      if (firedRef.current) return
      firedRef.current = true
      void reportDirectorCapture({
        captureId: job.pending.captureId,
        leaseToken: job.leaseToken,
        status: 'failed',
        error: '离屏渲染超时（场景未就绪）',
      }).catch(() => {}).then(() => onDone())
    }, 60_000)
    return () => window.clearTimeout(watchdog)
  }, [job, onDone])

  const renderScene = useRenderSceneFromJob(job, camId)

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
        // 前端建纯 image 节点：Tanva quick-upload 内部上传 OSS + 落 image 节点（锚定导演台下方）。
        const createdIds = await sendShotsToCanvas(
          job.nodeId,
          null,
          [{ name: '导演台出图', imageUrl: dataUrl }],
        )
        if (createdIds.length !== 1) throw new Error('导演台离屏截图未创建图片节点')
        await reportDirectorCapture({
          captureId: job.pending.captureId,
          leaseToken: job.leaseToken,
          status: 'succeeded',
        })
      } catch (e) {
        await reportDirectorCapture({
          captureId: job.pending.captureId,
          leaseToken: job.leaseToken,
          status: 'failed',
          error: String((e as Error)?.message ?? e),
        }).catch(() => {})
      } finally {
        onDone()
      }
    })()
  }, [job, onDone])

  return (
    <div
      style={{ position: 'fixed', left: -10000, top: 0, width: w, height: h, visibility: 'hidden', pointerEvents: 'none' }}
      aria-hidden
    >
      <Viewport
        ref={ref}
        scene={renderScene}
        viewpoint="camera"
        onSceneReady={onReady}
        onSelect={() => {}}
        onPatchCharacter={() => {}}
        onPatchCamera={() => {}}
      />
    </div>
  )
}
