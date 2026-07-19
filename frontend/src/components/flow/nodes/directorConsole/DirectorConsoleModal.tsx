// @ts-nocheck
import React from 'react'
import * as THREE from 'three'
import { createPortal } from 'react-dom'
import { IconHelpCircle, IconX } from '@tabler/icons-react'
import { useReactFlow, useStore, useNodes } from '@xyflow/react'
import { DirectorCaptureRunner, openDirectorModalNodes } from './DirectorCaptureRunner'
import type { DirectorConsoleData, CameraShot, Vec3 } from './types'
import { createDefaultDirectorConsoleData } from './types'
import {
  addCharacter, addCamera, selectObject, removeObject,
  patchCharacter, patchCamera, setAspect, setViewpoint, setActiveCamera, setSkybox, setSkyboxYaw,
} from './state/scene'
import { createHistory, pushHistory, undoHistory, redoHistory, snapshotOf, type HistorySnapshot } from './state/history'
import { copySelection, pasteClipboard, type DirectorClipboard } from './state/clipboard'
import { addCrowdCharacters, patchCrowdMembers, removeCrowd, type CrowdInput } from './state/crowd'
import { aspectFrameRect } from './state/aspect'
import { AspectFrameOverlay } from './panels/AspectFrameOverlay'
import { Viewport, type ViewportHandle, type GizmoMode } from './scene/Viewport'
import { SceneTreePanel } from './panels/SceneTreePanel'
import { ScenePropertiesPanel } from './panels/ScenePropertiesPanel'
import { CharacterPropertiesPanel } from './panels/CharacterPropertiesPanel'
import { LibTvCameraPropertiesPanel } from './panels/LibTvCameraPropertiesPanel'
import { Toolbar } from './panels/Toolbar'
import { uploadCanvasImageBlob, dataUrlToBlob } from './uploadCanvasImageBlob'
import { sendShotsToCanvas } from './sendToCanvas'
import { TimelinePanel } from './panels/TimelinePanel'
import { advancePlayhead } from './state/playback'
import { useConnectedPanorama } from './useConnectedPanorama'
import { addObjectTracks, ensurePropertyTimeline, hasKeyframeAt, removeKeyframe, removeObjectTracks, samplePropertyTimeline, setKeyframe, setPropertyKeyframes, setPositionTrajectory, type PropertyName } from './state/propertyTimeline'
import type { GroundPath } from './state/groundPath'
import { model3DUploadService } from '@/services/model3DUploadService'
import { uploadToOSS } from '@/services/ossUploadService'
import { generateImageViaAPI } from '@/services/aiBackendAPI'
import { isPersistableImageRef, resolveImageToBlob } from '@/utils/imageSource'
import { AiSceneImportDialog, type AiSceneImportMode } from './panels/AiSceneImportDialog'
import { snapPositionToGround } from './state/gaussianGround'

let uidCounter = 0
const uid = (p: string) => `${p}-${Date.now()}-${uidCounter++}`

type Props = { nodeId: string; onClose: () => void }

export default function DirectorConsoleModal({ nodeId, onClose }: Props) {
  const rf = useReactFlow()
  // 写回节点 data：走 Tanva 既有 `flow:updateNodeData` 事件（FlowOverlay 负责 setNodes + baseVersion 保存）。
  const updateNodeData = React.useCallback(
    (id: string, patch: Record<string, unknown>) => {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch } }))
    },
    [],
  )
  // 读节点 data：订阅 React Flow 12 的 nodeLookup，外部/小T 改 scene 会实时反映到这里。
  const storeData = useStore((s: any) => (s.nodeLookup as Map<string, any>)?.get(nodeId)?.data) as DirectorConsoleData | undefined
  // 供 Modal 内挂的 scoped runner 反应式读取节点（认领本节点的 pendingCapture）。runner 内部按 onlyNodeId 过滤。
  const scopedRunnerNodes = useNodes()
  // 新建的导演台节点 data 里没有 scene（createNodeAtWorldCenter 未 seed 场景），
  // 而下方 `if (!scene) return null` 会让整个 Modal 渲染空白（点击「打开导演台」没反应）。
  // 故首帧就用默认场景兜底；首次 apply() 会把 scene 落库。
  const [data, setData] = React.useState<DirectorConsoleData>(() =>
    storeData?.scene ? storeData : createDefaultDirectorConsoleData(),
  )
  const dataRef = React.useRef(data); dataRef.current = data
  const viewportRef = React.useRef<ViewportHandle | null>(null)
  const cameraPreviewRef = React.useRef<ViewportHandle | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [gizmoMode, setGizmoMode] = React.useState<GizmoMode>('translate')
  // 截图先以 dataURL 即时预览，随后上传远程并写入 scene.cameraShots；设计 JSON 永不保存 inline 数据。
  const [shots, setShots] = React.useState<Record<string, CameraShot[]>>(() => storeData?.scene?.cameraShots ?? {})
  // 右栏 摄像机 面板 tab（受控：截图后自动切到「摄像机截图」）
  const [cameraTab, setCameraTab] = React.useState<'props' | 'shots'>('props')
  const [aiImportOpen, setAiImportOpen] = React.useState(false)
  const [aiImportSourceUrl, setAiImportSourceUrl] = React.useState<string>()
  // 导演台内吐司（modal 在画布之上，全局 toast 会被盖住）
  const [modalToast, setModalToast] = React.useState<{ msg: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null)
  const toastTimerRef = React.useRef<number | null>(null)
  const historyPickerCallbacksRef = React.useRef(new Map<string, (url: string, name?: string) => void>())
  const showToast = React.useCallback((msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setModalToast({ msg, type })
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setModalToast(null), 2800)
  }, [])
  React.useEffect(() => {
    const onSelected = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; url?: string; name?: string }>).detail
      if (!detail?.requestId || !detail.url) return
      const callback = historyPickerCallbacksRef.current.get(detail.requestId)
      if (!callback) return
      historyPickerCallbacksRef.current.delete(detail.requestId)
      callback(detail.url, detail.name)
    }
    window.addEventListener('tanva:global-history-selected', onSelected)
    return () => {
      window.removeEventListener('tanva:global-history-selected', onSelected)
      historyPickerCallbacksRef.current.clear()
    }
  }, [])
  const requestHistoryImage = React.useCallback((purpose: string, callback: (url: string, name?: string) => void) => {
    const requestId = uid('history-pick')
    historyPickerCallbacksRef.current.set(requestId, callback)
    window.dispatchEvent(new CustomEvent('tanva:open-global-history', { detail: { requestId, purpose } }))
  }, [])
  // 全局时间线播放：playhead(全局秒)/playing/倍速/选中镜头
  const [playhead, setPlayhead] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  // 对齐导演工作区：场景编辑与动画时间轴是互斥工作模式，时间轴不再永久占据视口高度。
  const [editorMode, setEditorMode] = React.useState<'scene' | 'timeline'>('scene')
  const [trajectoryDraft, setTrajectoryDraft] = React.useState<{ objectKind: 'character' | 'camera'; objectId: string; path: GroundPath; selectedIndex?: number } | null>(null)
  const trajectoryDraftRef = React.useRef(trajectoryDraft)
  trajectoryDraftRef.current = trajectoryDraft
  const [autoKeyframe, setAutoKeyframe] = React.useState(false)
  const [timelineLoop, setTimelineLoop] = React.useState(false)
  // Repair historical nodes that were created before Director Console seeded
  // its scene at node-creation time. Opening and closing without editing must
  // still persist the same default scene users saw on screen.
  React.useEffect(() => {
    if (storeData?.scene) return
    const initial = dataRef.current
    updateNodeData(nodeId, { scene: initial.scene, activeViewpoint: initial.activeViewpoint, selectedObjectId: initial.selectedObjectId })
  }, [nodeId, storeData?.scene, updateNodeData])
  // 接管本节点的 capture 认领：打开导演台时由 Modal 内挂的 scoped runner 负责（鲜活、不会被全局 runner 的 busyRef 卡死），
  // 全局 runner 跳过本节点。这样「在导演台里让小T 出图/出片」不再出现「无浏览器认领」。
  React.useEffect(() => {
    openDirectorModalNodes.add(nodeId)
    return () => { openDirectorModalNodes.delete(nodeId) }
  }, [nodeId])

  // 变换模式快捷键 V/R/S（工具条按钮 title 中已标注）
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'v') setGizmoMode('translate')
      else if (k === 'r') setGizmoMode('rotate')
      else if (k === 's') setGizmoMode('scale')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── 撤销/重做：所有变更都经 apply() 单点落盘 → scene 引用变化即入栈（连续拖拽按时间窗合并） ──
  const historyRef = React.useRef(createHistory())

  const apply = React.useCallback((next: DirectorConsoleData) => {
    const before = dataRef.current
    if (before.scene && next.scene !== before.scene) {
      historyRef.current = pushHistory(historyRef.current, snapshotOf(before.scene, before.selectedObjectId), performance.now())
    }
    // React state commits asynchronously. Keep the imperative source current
    // before dispatching persistence so a fast follow-up edit/upload cannot
    // rebuild from the previous scene and silently drop the first change.
    dataRef.current = next
    setData(next)
    updateNodeData(nodeId, { scene: next.scene, activeViewpoint: next.activeViewpoint, selectedObjectId: next.selectedObjectId } as Record<string, unknown>)
  }, [nodeId, updateNodeData])

  // 撤销/重做恢复：不经 apply（不能再入栈）
  const restoreSnapshot = React.useCallback((snap: HistorySnapshot) => {
    const d = dataRef.current
    const next = { ...d, scene: snap.scene, selectedObjectId: snap.selectedObjectId }
    dataRef.current = next
    setData(next)
    updateNodeData(nodeId, { scene: next.scene, activeViewpoint: next.activeViewpoint, selectedObjectId: next.selectedObjectId } as Record<string, unknown>)
  }, [nodeId, updateNodeData])

  const onUndo = React.useCallback(() => {
    const d = dataRef.current
    if (!d.scene) return
    const step = undoHistory(historyRef.current, snapshotOf(d.scene, d.selectedObjectId), performance.now())
    if (!step) return
    historyRef.current = step.history
    restoreSnapshot(step.snapshot)
  }, [restoreSnapshot])

  const onRedo = React.useCallback(() => {
    const d = dataRef.current
    if (!d.scene) return
    const step = redoHistory(historyRef.current, snapshotOf(d.scene, d.selectedObjectId), performance.now())
    if (!step) return
    historyRef.current = step.history
    restoreSnapshot(step.snapshot)
  }, [restoreSnapshot])

  // ── 复制/粘贴（对象级剪贴板）：Cmd/Ctrl+C 复制选中角色/机位，Cmd/Ctrl+V 递增偏移粘贴 ──
  const clipboardRef = React.useRef<DirectorClipboard | null>(null)
  const pasteCountRef = React.useRef(0)
  const onCopy = React.useCallback((): boolean => {
    const clip = copySelection(dataRef.current)
    if (!clip) return false
    clipboardRef.current = clip
    pasteCountRef.current = 0
    showToast(`已复制「${clip.kind === 'character' ? clip.character.name : clip.camera.name}」，Cmd/Ctrl+V 粘贴`, 'info')
    return true
  }, [showToast])
  const onPaste = React.useCallback((): boolean => {
    const clip = clipboardRef.current
    if (!clip) return false
    pasteCountRef.current += 1
    apply(pasteClipboard(dataRef.current, clip, uid(clip.kind === 'character' ? 'char' : 'cam'), pasteCountRef.current))
    return true
  }, [apply])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedo()
        else onUndo()
      } else if (k === 'c' && !e.shiftKey) {
        if (window.getSelection()?.toString()) return // 有文本选区时让系统复制
        if (onCopy()) e.preventDefault()
      } else if (k === 'v' && !e.shiftKey) {
        if (onPaste()) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onUndo, onRedo, onCopy, onPaste])

  // 选中对象的键盘操作：方向键微调（拖拽难精调）：←→↑↓ 沿地面、Alt+↑↓ 调高度；Shift=0.5m 粗调，默认 0.1m；
  // Delete/Backspace 删除（锁定对象不响应）。↑ 的方向取当前相机朝向在地面上的投影并吸附到最近世界轴，保证按键方向与屏幕直觉一致。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        if (!data.selectedObjectId) return
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        apply(selectObject(data, undefined))
        return
      }
      const isArrow = e.key.startsWith('Arrow')
      const isDelete = e.key === 'Delete' || e.key === 'Backspace'
      if (!isArrow && !isDelete) return
      if (e.metaKey || e.ctrlKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const id = data.selectedObjectId
      if (!id || !data.scene) return
      const ch = data.scene.characters.find((c) => c.id === id)
      const cam = ch ? undefined : data.scene.cameras.find((c) => c.id === id)
      const obj = ch ?? cam
      if (!obj || obj.locked) return
      e.preventDefault()
      // Director modal owns object editing while open. Capture + immediate stop prevents the
      // underlying Flow canvas Delete handler from deleting the Director node itself.
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (isDelete) {
        apply(removeObject(data, id))
        return
      }
      const step = e.shiftKey ? 0.5 : 0.1
      let dx = 0, dy = 0, dz = 0
      if (e.altKey) {
        if (e.key === 'ArrowUp') dy = step
        else if (e.key === 'ArrowDown') dy = -step
        else return
      } else {
        let fx = 0, fz = -1
        const view = viewportRef.current?.getCurrentCamera()
        if (view) {
          const vx = view.lookAt[0] - view.position[0]
          const vz = view.lookAt[2] - view.position[2]
          if (Math.abs(vx) > Math.abs(vz)) { fx = Math.sign(vx) || 1; fz = 0 } else { fx = 0; fz = Math.sign(vz) || -1 }
        }
        const rx = -fz, rz = fx // forward 绕 y 轴 -90° 即屏幕右方
        if (e.key === 'ArrowUp') { dx = fx * step; dz = fz * step }
        else if (e.key === 'ArrowDown') { dx = -fx * step; dz = -fz * step }
        else if (e.key === 'ArrowRight') { dx = rx * step; dz = rz * step }
        else if (e.key === 'ArrowLeft') { dx = -rx * step; dz = -rz * step }
      }
      const r3 = (v: number) => Math.round(v * 1000) / 1000 // 消浮点累加噪声（0.6000000000000001）
      const rawPos: Vec3 = [r3(obj.position[0] + dx), r3(obj.position[1] + dy), r3(obj.position[2] + dz)]
      const pos = ch && !e.altKey && (data.scene.gaussianGroundSnap ?? true)
        ? snapPositionToGround(rawPos, data.scene.groundHeight ?? 0, true)
        : rawPos
      apply(ch ? patchCharacter(data, id, { position: pos }) : patchCamera(data, id, { position: pos }))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [data, apply])

  // 全景背景：连线图片是默认输入；上传、AI 生成或历史选择写入 scene.skybox 后，
  // 它代表用户在导演台内明确选择的当前背景，必须优先渲染。否则会出现“生成成功但画面没变”。
  const connectedPanoUrl = useConnectedPanorama(nodeId)

  const scene = data.scene
  const effectiveSkyboxUrl = scene.skybox ?? connectedPanoUrl
  const selectedId = data.selectedObjectId
  const selectedCamera = scene?.cameras.find((c) => c.id === selectedId)
  const selectedCharacter = scene?.characters.find((c) => c.id === selectedId)

  // 实时同步：小T(或其它外部 flow_patch)改了本节点 scene → 灌进模态。
  // 判源靠 scene 引用：自己 apply 后 store.scene === 本地 scene（同引用，不回灌）；外部改 = 新引用 → 同步。
  // 外部改动也入撤销栈：Cmd+Z 可回滚小T 的摆位。
  React.useEffect(() => {
    if (storeData?.scene && storeData.scene !== dataRef.current.scene) {
      if (dataRef.current.scene) {
        historyRef.current = pushHistory(historyRef.current, snapshotOf(dataRef.current.scene, dataRef.current.selectedObjectId), performance.now())
      }
      dataRef.current = storeData
      setData(storeData)
      setShots(storeData.scene.cameraShots ?? {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeData])
  const propertyTimeline = React.useMemo(() => ensurePropertyTimeline(scene?.propertyTimeline), [scene?.propertyTimeline])
  const totalDuration = propertyTimeline.duration
  const displayedScene = React.useMemo(() => scene && editorMode === 'timeline' ? samplePropertyTimeline(scene, playhead) : scene, [scene, editorMode, playhead])
  // Playback advances every RAF. Keep inspector key diamonds stable instead of
  // flashing as the playhead repeatedly crosses their ±20ms hit window.
  const inspectorKeyframeTime = playing ? null : playhead

  const commitTrajectory = React.useCallback((draft: NonNullable<typeof trajectoryDraft>) => {
    const current = dataRef.current
    const object = draft.objectKind === 'character'
      ? current.scene.characters.find((item) => item.id === draft.objectId)
      : current.scene.cameras.find((item) => item.id === draft.objectId)
    if (!object) return
    const baseY = object.position[1]
    const yAt = draft.objectKind === 'character'
      ? (x: number, z: number) => snapPositionToGround([x, baseY, z], current.scene.groundHeight ?? 0, current.scene.gaussianGroundSnap ?? true)[1]
      : () => baseY
    apply({
      ...current,
      scene: {
        ...current.scene,
        propertyTimeline: setPositionTrajectory(current.scene.propertyTimeline, draft.objectKind, draft.objectId, draft.path, yAt),
      },
    })
  }, [apply])

  const updateTrajectory = React.useCallback((mutate: (draft: NonNullable<typeof trajectoryDraft>) => NonNullable<typeof trajectoryDraft>) => {
    const current = trajectoryDraftRef.current
    if (!current) return
    const next = mutate(current)
    trajectoryDraftRef.current = next
    setTrajectoryDraft(next)
    commitTrajectory(next)
  }, [commitTrajectory])

  const toggleTrajectory = React.useCallback((objectKind: 'character' | 'camera', objectId: string) => {
    if (trajectoryDraft?.objectId === objectId) { trajectoryDraftRef.current = null; setTrajectoryDraft(null); return }
    const current = dataRef.current
    const object = objectKind === 'character'
      ? current.scene.characters.find((item) => item.id === objectId)
      : current.scene.cameras.find((item) => item.id === objectId)
    if (!object) return
    const saved = ensurePropertyTimeline(current.scene.propertyTimeline).trajectories?.[objectId]
    const path: GroundPath = saved
      ? { ...saved, waypoints: saved.waypoints.map((point) => [point[0], point[1]]), facingMode: saved.facingMode ?? (objectKind === 'character' ? 'follow' : 'fixed'), fixedHeading: saved.fixedHeading ?? object.rotation?.[1] ?? 0 }
      : { waypoints: [[object.position[0], object.position[2]]], mode: 'linear', facingMode: objectKind === 'character' ? 'follow' : 'fixed', facingOffset: 0, fixedHeading: object.rotation?.[1] ?? 0 }
    setPlaying(false)
    const draft = { objectKind, objectId, path }
    trajectoryDraftRef.current = draft
    setTrajectoryDraft(draft)
    commitTrajectory(draft)
    apply(setViewpoint(selectObject(dataRef.current, objectId), 'director'))
  }, [apply, commitTrajectory, trajectoryDraft?.objectId])

  // LibTV 属性时间线是导演台唯一的播放时钟。
  const playRefs = React.useRef({ playhead, total: totalDuration, loop: timelineLoop })
  playRefs.current = { playhead, total: totalDuration, loop: timelineLoop }
  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now
      const r = playRefs.current
      const step = advancePlayhead(r.playhead, dt, 1, r.total, r.loop)
      r.playhead = step.t
      setPlayhead(step.t)
      if (step.ended) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const onPlayToggle = React.useCallback(() => {
    setPlaying((p) => {
      const next = !p
      if (next) {
        if (playRefs.current.playhead >= playRefs.current.total - 0.001) {
          playRefs.current.playhead = 0
          setPlayhead(0)
        }
      }
      return next
    })
  }, [])
  const onSeek = React.useCallback((t: number) => { setPlayhead(t); playRefs.current.playhead = t }, [])

  const toggleInspectorKeyframe = React.useCallback((objectKind: 'character' | 'camera', objectId: string, property: PropertyName, component?: 0 | 1 | 2) => {
    const current = dataRef.current
    const time = playRefs.current.playhead
    const timeline = current.scene.propertyTimeline
    const nextTimeline = hasKeyframeAt(timeline, objectId, property, time, component)
      ? removeKeyframe(timeline, objectId, property, time, component)
      : setKeyframe(timeline, current.scene, objectKind, objectId, property, time, component)
    apply({ ...current, scene: { ...current.scene, propertyTimeline: nextTimeline } })
  }, [apply])

  // LibTV 时间线顶栏「导出到画布」：只录制属性时间线的主机位画面。
  // 不复活旧 shot/分段/视频节点工作流；产物上传为远程视频后交给现有画板视频素材链路。
  const onExportTimelineToCanvas = React.useCallback(async () => {
    if (exporting || !scene.activeCameraId) return
    const canvas = viewportBoxRef.current?.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement) || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      showToast('当前浏览器不支持动画导出', 'error')
      return
    }
    const mimeCandidates = [
      // avc3 tolerates encoder description changes if the WebGL backing size
      // changes while responsive panels settle; Chromium warns/corrupts avc1
      // in that case.
      'video/mp4;codecs=avc3.42E01E',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ]
    const mimeType = mimeCandidates.find((value) => MediaRecorder.isTypeSupported(value))
    if (!mimeType) { showToast('当前浏览器没有可用的视频编码器', 'error'); return }

    setExporting(true)
    const previousViewpoint = data.activeViewpoint
    const previousMode = editorMode
    const previousPlayhead = playhead
    try {
      setEditorMode('timeline')
      if (data.activeViewpoint !== 'camera') apply(setViewpoint(data, 'camera'))
      playRefs.current.playhead = 0
      setPlayhead(0)
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

      const stream = canvas.captureStream(30)
      const chunks: BlobPart[] = []
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
        recorder.onerror = () => reject(new Error('动画录制失败'))
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] }))
      })
      recorder.start(250)
      setPlaying(true)
      await new Promise((resolve) => window.setTimeout(resolve, Math.ceil(propertyTimeline.duration * 1000) + 120))
      setPlaying(false)
      recorder.stop()
      stream.getTracks().forEach((track) => track.stop())
      const blob = await stopped
      if (!blob.size) throw new Error('动画导出结果为空')

      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm'
      const fileName = `director-animation-${Date.now()}.${extension}`
      const uploaded = await uploadToOSS(blob, {
        dir: 'director-animations/',
        fileName,
        contentType: blob.type,
        maxSize: 512 * 1024 * 1024,
      })
      if (!uploaded.success || !uploaded.url) throw new Error(uploaded.error || '动画上传失败')
      window.dispatchEvent(new CustomEvent('canvas:insert-video', {
        detail: {
          asset: {
            id: uid('director-animation'),
            url: uploaded.url,
            sourceUrl: uploaded.url,
            fileName,
            contentType: blob.type,
            width: canvas.width,
            height: canvas.height,
            metadata: { source: 'directorConsole', nodeId, duration: propertyTimeline.duration },
          },
        },
      }))
      showToast('动画视频已导出到画布', 'success')
    } catch (error) {
      setPlaying(false)
      showToast(error instanceof Error ? error.message : '动画导出失败', 'error')
    } finally {
      playRefs.current.playhead = previousPlayhead
      setPlayhead(previousPlayhead)
      setEditorMode(previousMode)
      if (previousViewpoint !== 'camera') apply(setViewpoint(dataRef.current, previousViewpoint))
      setExporting(false)
    }
  }, [apply, data, editorMode, exporting, nodeId, playhead, propertyTimeline.duration, scene.activeCameraId, showToast])

  // 选中机位时直接截右侧实时机位预览并归入该机位；未选机位时才从导演视角创建新机位。
  // 画幅框可见时按 框高/视口高 收窄 FOV → 截图只含框内内容（所见即所得）
  const onCapture = React.useCallback(async () => {
    const current = dataRef.current
    const currentScene = current.scene
    const selectedCamera = currentScene.cameras.find((camera) => camera.id === current.selectedObjectId)
    if (selectedCamera && !cameraPreviewRef.current) setCameraTab('props')
    if (selectedCamera) await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const captureViewport = selectedCamera ? cameraPreviewRef.current : viewportRef.current
    const view = captureViewport?.getCurrentCamera()
    const box = viewportBoxRef.current
    const frame = box ? aspectFrameRect(currentScene.aspect, box.clientWidth, box.clientHeight) : null
    const fovScale = frame && box && box.clientHeight > 0 ? frame.height / box.clientHeight : undefined
    const dataUrl = captureViewport?.captureView(selectedCamera ? undefined : (fovScale ? { fovScale } : undefined))
    if (!view || !dataUrl) { showToast('截图失败，请重试', 'error'); return }
    const cameraId = selectedCamera?.id ?? uid('cam')
    const next = selectedCamera ? current : addCamera(current, { id: cameraId, position: view.position, lookAt: view.lookAt, fovDeg: view.fovDeg })
    if (!selectedCamera) apply(next)
    const camName = next.scene.cameras.find((c) => c.id === cameraId)?.name ?? '机位'
    const shotIndex = (next.scene.cameraShots?.[cameraId]?.length ?? shots[cameraId]?.length ?? 0) + 1
    const shot: CameraShot = { id: uid('shot'), name: `${camName}-截图${String(shotIndex).padStart(2, '0')}`, imageUrl: dataUrl, aspect: currentScene.aspect, createdAt: Date.now() }
    setShots((prev) => ({ ...prev, [cameraId]: [...(prev[cameraId] ?? []), shot] }))
    setCameraTab('shots') // 截图后自动切到「摄像机截图」，立刻看到结果——对齐 liblib
    try {
      const blob = await dataUrlToBlob(dataUrl)
      const hosted = await uploadCanvasImageBlob({ blob, label: shot.name, filePrefix: 'director-shot', ownerNodeId: nodeId })
      if (!isPersistableImageRef(hosted.url)) throw new Error('截图未获得可持久化远程地址')
      const persistedShot = { ...shot, imageUrl: hosted.url }
      setShots((current) => ({ ...current, [cameraId]: (current[cameraId] ?? []).map((item) => item.id === shot.id ? persistedShot : item) }))
      const current = dataRef.current
      apply({ ...current, scene: { ...current.scene, cameraShots: { ...(current.scene.cameraShots ?? {}), [cameraId]: [...(current.scene.cameraShots?.[cameraId] ?? []), persistedShot] } } })
      showToast('相机截图已保存', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '相机截图保存失败', 'error')
    }
  }, [apply, nodeId, shots, showToast])

  const onClearAll = React.useCallback(() => {
    setShots({})
    const current = dataRef.current
    apply({ ...current, scene: { ...current.scene, cameraShots: {} } })
  }, [apply])

  const onDeleteShot = React.useCallback((cameraId: string, shotId: string) => {
    setShots((prev) => ({ ...prev, [cameraId]: (prev[cameraId] ?? []).filter((s) => s.id !== shotId) }))
    const current = dataRef.current
    const cameraShots = { ...(current.scene.cameraShots ?? {}), [cameraId]: (current.scene.cameraShots?.[cameraId] ?? []).filter((shot) => shot.id !== shotId) }
    apply({ ...current, scene: { ...current.scene, cameraShots } })
  }, [apply])

  // 发送机位截图到画布：直接把 dataURL 交给 Tanva quick-upload（其内部上传 OSS + 建纯 image 节点），
  // 不在此预上传、不建 combined taskNode。
  const uploadAndSend = React.useCallback(async (list: CameraShot[]) => {
    if (!list.length) { showToast('该机位还没有截图', 'warning'); return }
    if (busy) return
    setBusy(true)
    try {
      const created = await sendShotsToCanvas(
        nodeId,
        rf.getNode(nodeId)?.position ?? null,
        list.map((s) => ({ name: s.name, imageUrl: s.imageUrl })),
      )
      if (created.length !== list.length) throw new Error(`只创建了 ${created.length}/${list.length} 个图片节点`)
      showToast(`已发送 ${created.length} 张截图到画布`, 'success')
    } catch (e: any) {
      showToast(e?.message || '发送失败，请重试', 'error')
    } finally {
      setBusy(false)
    }
  }, [nodeId, rf, busy])

  // 摄像机截图画廊：汇总所有机位的截图，按机位分组（对齐 liblib）
  const shotGroups = (scene?.cameras ?? [])
    .map((c) => ({ cameraId: c.id, cameraName: c.name, shots: shots[c.id] ?? [] }))
    .filter((g) => g.shots.length > 0)
  const onSendAll = React.useCallback(() => uploadAndSend(shotGroups.flatMap((group) => group.shots)), [shotGroups, uploadAndSend])
  const onSendShot = React.useCallback((cameraId: string, shotId: string) => {
    const s = (shots[cameraId] ?? []).find((x) => x.id === shotId)
    if (s) uploadAndSend([s])
  }, [shots, uploadAndSend])

  // 群演阵列：行×列×间距×素体一键铺开，共享 crowdId（场景树按组折叠、属性面板可整组广播）
  const onAddCrowd = React.useCallback((input: CrowdInput) => {
    const res = addCrowdCharacters(dataRef.current, input, () => uid('char'))
    apply(res.data)
    showToast(`已铺 ${res.memberIds.length} 个群演（${res.data.scene.characters.find((c) => c.crowdId === res.crowdId)?.crowdLabel ?? ''}）`, 'success')
  }, [apply, showToast])

  const onCharacterPatch = React.useCallback((id: string, patch: Partial<import('./types').CharacterObj>) => {
    const d = dataRef.current
    let next = patchCharacter(d, id, patch)
    if (autoKeyframe && editorMode === 'timeline') {
      for (const property of ['position', 'rotation', 'scale', 'uniformScale', 'pose'] as PropertyName[]) if (property in patch) next = { ...next, scene: { ...next.scene, propertyTimeline: setPropertyKeyframes(next.scene.propertyTimeline, next.scene, 'character', id, property, playRefs.current.playhead) } }
    }
    apply(next)
  }, [apply, autoKeyframe, editorMode])

  const onCameraPatch = React.useCallback((id: string, patch: Partial<import('./types').CameraObj>) => {
    let next = patchCamera(dataRef.current, id, patch)
    if (autoKeyframe && editorMode === 'timeline') {
      for (const property of ['position', 'rotation', 'fovDeg', 'lookAt'] as PropertyName[]) if (property in patch) next = { ...next, scene: { ...next.scene, propertyTimeline: setPropertyKeyframes(next.scene.propertyTimeline, next.scene, 'camera', id, property, playRefs.current.playhead) } }
    }
    apply(next)
  }, [apply, autoKeyframe, editorMode])

  const onUploadModel = React.useCallback(async (files: File[]) => {
    const entries = files.map((file) => ({
      file,
      path: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/^\/+/, ''),
    }))
    const roots = entries.filter(({ path }) => /\.(?:glb|gltf)$/i.test(path))
    if (roots.length !== 1) { showToast('请选择一个 GLB，或一个 GLTF 入口及其全部 .bin/纹理依赖', 'warning'); return }
    const root = roots[0]
    setBusy(true)
    try {
      if (/\.glb$/i.test(root.path)) {
        const result = await model3DUploadService.uploadModelFile(root.file, { dir: 'director-models/' })
        if (!result.success || !result.asset?.url) throw new Error(result.error || '模型上传失败')
        apply(addCharacter(dataRef.current, { id: uid('char'), modelId: result.asset.url }))
        showToast('模型已上传并添加', 'success')
        return
      }
      const json = JSON.parse(await root.file.text()) as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> }
      const rootDirectory = root.path.includes('/') ? root.path.slice(0, root.path.lastIndexOf('/') + 1) : ''
      const normalize = (value: string) => {
        const decoded = decodeURIComponent(value.split(/[?#]/)[0]).replace(/\\/g, '/')
        const segments: string[] = []
        for (const segment of `${rootDirectory}${decoded}`.split('/')) {
          if (!segment || segment === '.') continue
          if (segment === '..') { if (!segments.pop()) throw new Error(`GLTF 依赖越出所选目录：${value}`); continue }
          segments.push(segment)
        }
        return segments.join('/')
      }
      const externalUris = [...(json.buffers ?? []), ...(json.images ?? [])]
        .map((item) => item.uri?.trim())
        .filter((uri): uri is string => !!uri && !/^(?:data:|https?:|blob:)/i.test(uri))
      const byPath = new Map(entries.map((entry) => [entry.path, entry]))
      const dependencies = [...new Set(externalUris.map(normalize))]
      const findEntry = (path: string) => {
        const relative = path.startsWith(rootDirectory) ? path.slice(rootDirectory.length) : path
        const exact = byPath.get(path) ?? byPath.get(relative)
        if (exact) return exact
        const basename = relative.slice(relative.lastIndexOf('/') + 1)
        const matches = entries.filter((entry) => entry.path.slice(entry.path.lastIndexOf('/') + 1) === basename)
        return matches.length === 1 ? matches[0] : undefined
      }
      const missing = dependencies.filter((path) => !findEntry(path))
      if (missing.length) throw new Error(`GLTF 缺少依赖：${missing.join('、')}`)
      const packageDir = `director-models/gltf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}/`
      const uploadEntry = async (entry: typeof root, targetPath?: string) => {
        const relativePath = targetPath ?? (entry.path.startsWith(rootDirectory) ? entry.path.slice(rootDirectory.length) : entry.path)
        const slash = relativePath.lastIndexOf('/')
        const dir = `${packageDir}${slash >= 0 ? relativePath.slice(0, slash + 1) : ''}`
        const fileName = slash >= 0 ? relativePath.slice(slash + 1) : relativePath
        const uploaded = await uploadToOSS(entry.file, { dir, fileName, contentType: entry.file.type || undefined, maxSize: 200 * 1024 * 1024 })
        if (!uploaded.success || !uploaded.url) throw new Error(uploaded.error || `上传失败：${relativePath}`)
        return uploaded.url
      }
      for (const path of dependencies) await uploadEntry(findEntry(path)!, path.startsWith(rootDirectory) ? path.slice(rootDirectory.length) : path)
      const modelUrl = await uploadEntry(root)
      apply(addCharacter(dataRef.current, { id: uid('char'), modelId: modelUrl }))
      showToast(`GLTF 模型包已上传并添加（${dependencies.length} 个依赖）`, 'success')
    } catch (error: any) {
      showToast(error?.message || '模型上传失败', 'error')
    } finally {
      setBusy(false)
    }
  }, [apply, showToast])

  const onUploadGaussian = React.useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.splat')) { showToast('请选择 .splat 高斯泼溅文件', 'warning'); return }
    setBusy(true)
    void uploadToOSS(file, { dir: 'director-gaussians/', fileName: file.name, contentType: file.type || 'application/octet-stream', maxSize: 200 * 1024 * 1024 }).then((result) => {
      if (!result.success || !result.url) throw new Error(result.error || '高斯泼溅上传失败')
      apply(addCharacter(dataRef.current, { id: uid('gaussian'), modelId: result.url, name: '高斯泼溅' }))
      showToast('高斯泼溅已上传并添加', 'success')
    }).catch((error) => showToast(error?.message || '高斯泼溅上传失败', 'error')).finally(() => setBusy(false))
  }, [apply, showToast])

  const onSetSkybox = React.useCallback((file: File | null) => {
    if (!file) { apply(setSkybox(dataRef.current, undefined)); return }
    setBusy(true)
    void uploadCanvasImageBlob({ blob: file, label: '全景图', filePrefix: 'director-panorama', ownerNodeId: nodeId }).then((hosted) => {
      apply(setSkybox(dataRef.current, hosted.url))
      showToast('全景图已上传', 'success')
    }).catch((error) => showToast(error?.message || '全景图上传失败', 'error')).finally(() => setBusy(false))
  }, [apply, nodeId, showToast])

  const onGeneratePanorama = React.useCallback(async (prompt: string) => {
    if (!prompt.trim()) return
    setBusy(true)
    try {
      const result = await generateImageViaAPI({
        prompt: `${prompt.trim()}。生成完整无缝的 360° 等距柱状全景环境图，严格 2:1 比例，左右边缘可无缝衔接，不要画框，不要文字。`,
        aspectRatio: '2:1',
        imageSize: '2K',
        imageOnly: true,
      })
      if (!result.success || !result.data) throw new Error(result.error?.message || '全景图生成失败')
      const candidate = (result.data.imageUrl || result.data.imageData || '').trim()
      if (!candidate) throw new Error('全景图生成结果为空')
      let remoteUrl = isPersistableImageRef(candidate) ? candidate : ''
      if (!remoteUrl) {
        const blob = await resolveImageToBlob(candidate, { preferProxy: true })
        if (!blob) throw new Error('读取全景图生成结果失败')
        remoteUrl = (await uploadCanvasImageBlob({ blob, label: 'AI 全景图', filePrefix: 'director-panorama-ai', ownerNodeId: nodeId })).url
      }
      if (!isPersistableImageRef(remoteUrl)) throw new Error('全景图未获得可持久化远程地址')
      apply(setSkybox(dataRef.current, remoteUrl))
      showToast('AI 全景图已生成并应用', 'success')
    } catch (error: any) {
      showToast(error?.message || '全景图生成失败', 'error')
      throw error
    } finally {
      setBusy(false)
    }
  }, [apply, nodeId, showToast])

  const createConnectedImageNode = React.useCallback((imageUrl: string, label: string) => new Promise<string>((resolve, reject) => {
    let settled = false
    const done = (id: string | null) => {
      if (settled) return
      settled = true
      if (id) resolve(id); else reject(new Error(`${label}图片节点创建失败`))
    }
    window.dispatchEvent(new CustomEvent('flow:createImageNode', { detail: {
      imageUrl, label, imageName: label,
      worldPosition: rf.getNode(nodeId)?.position ? { x: (rf.getNode(nodeId)?.position.x ?? 0) - 420, y: rf.getNode(nodeId)?.position.y ?? 0 } : undefined,
      connectAsSourceToNodeId: nodeId,
      connectAsSourceHandle: 'img',
      connectAsTargetHandle: 'target',
      replaceIncomingForTarget: true,
      done,
    } }))
    window.setTimeout(() => done(null), 3000)
  }), [nodeId, rf])

  const onAiImportUpload = React.useCallback(async (file: File) => {
    setBusy(true)
    try {
      const hosted = await uploadCanvasImageBlob({ blob: file, label: '识图来源', filePrefix: 'director-ai-source', ownerNodeId: nodeId })
      if (!isPersistableImageRef(hosted.url)) throw new Error('识图来源未获得远程地址')
      await createConnectedImageNode(hosted.url, 'AI识图来源')
      setAiImportSourceUrl(hosted.url)
      showToast('识图来源已上传并连接导演台', 'success')
    } catch (error: any) {
      showToast(error?.message || '识图来源上传失败', 'error')
    } finally { setBusy(false) }
  }, [createConnectedImageNode, nodeId, showToast])

  const onGeneratePlacementReference = React.useCallback(async (mode: AiSceneImportMode) => {
    const sourceUrl = aiImportSourceUrl
    if (!sourceUrl) return
    setBusy(true)
    try {
      const result = await generateImageViaAPI({
        prompt: '根据参考图生成影视 3D 导演台站位参考图：保留人物数量、相对站位、朝向、动作、主要道具和摄像机构图；转换成中性灰色 3D blocking 素体与简洁空间，透视准确，无文字，无边框。',
        imageUrls: [sourceUrl], aspectRatio: '16:9', imageSize: '2K', imageOnly: true,
      })
      if (!result.success || !result.data) throw new Error(result.error?.message || '站位参考生成失败')
      const candidate = (result.data.imageUrl || result.data.imageData || '').trim()
      if (!candidate) throw new Error('站位参考生成结果为空')
      let remoteUrl = isPersistableImageRef(candidate) ? candidate : ''
      if (!remoteUrl) {
        const blob = await resolveImageToBlob(candidate, { preferProxy: true })
        if (!blob) throw new Error('读取站位参考失败')
        remoteUrl = (await uploadCanvasImageBlob({ blob, label: '站位参考', filePrefix: 'director-placement-reference', ownerNodeId: nodeId })).url
      }
      await createConnectedImageNode(remoteUrl, '导演台站位参考')
      const current = dataRef.current
      if (mode === 'overwrite') {
        const defaults = createDefaultDirectorConsoleData()
        const reference = addCharacter({ ...current, scene: { ...current.scene, characters: [], cameras: defaults.scene.cameras, activeCameraId: defaults.scene.activeCameraId, skybox: undefined } }, { id: uid('reference'), modelId: `reference-image:${remoteUrl}`, name: '站位参考层', position: [0, 0, 0] })
        apply(reference)
      } else {
        apply(addCharacter(current, { id: uid('reference'), modelId: `reference-image:${remoteUrl}`, name: '站位参考层', position: [0, 0, -1] }))
      }
      setAiImportOpen(false)
      showToast('站位参考已生成并导入导演台', 'success')
    } catch (error: any) {
      showToast(error?.message || '站位参考生成失败', 'error')
    } finally { setBusy(false) }
  }, [aiImportSourceUrl, apply, createConnectedImageNode, nodeId, showToast])

  // ── 画幅取景框：跟踪视口尺寸 → 非 auto 画幅时内切居中框（框外遮罩），截图按框收窄 FOV 所见即所得 ──
  const viewportBoxRef = React.useRef<HTMLDivElement | null>(null)
  const [viewportSize, setViewportSize] = React.useState({ w: 0, h: 0 })
  React.useEffect(() => {
    const el = viewportBoxRef.current
    if (!el) return
    const measure = () => setViewportSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const frameRect = React.useMemo(
    () => (scene ? aspectFrameRect(scene.aspect, viewportSize.w, viewportSize.h) : null),
    [scene, viewportSize],
  )
  if (!scene) return null

  return createPortal(
    <div data-testid="director-console-modal" data-skybox-url={effectiveSkyboxUrl ?? ''} style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#111', display: 'flex', flexDirection: 'column', color: '#e5e7eb' }}>
      {/* 顶部栏 */}
      <div data-testid="director-header" style={{ height: 48, flex: '0 0 48px', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(17,17,17,0.96)', backdropFilter: 'blur(12px)' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#f7f7f7' }}>3D导演台</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
          {editorMode === 'timeline' ? (
            <button type="button" disabled={exporting} onClick={onExportTimelineToCanvas}
              style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid #383838', background: '#242424', color: exporting ? '#777' : '#ededed', cursor: exporting ? 'wait' : 'pointer', fontSize: 12 }}>
              {exporting ? '导出中…' : '导出到画布'}
            </button>
          ) : null}
          <button type="button" title="帮助" aria-label="帮助" onClick={() => showToast('选择角色或机位后，在右侧编辑属性；使用底部工具条添加对象、截图或切换动画时间轴。')}
            style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><IconHelpCircle size={18} /></button>
          <button type="button" title="关闭" aria-label="关闭" onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><IconX size={20} /></button>
        </div>
      </div>
      {/* 主体三栏 */}
      <div data-testid="director-workspace" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div data-testid="director-scene-sidebar" style={{ width: 240, borderRight: '1px solid #1c1f26', overflowY: 'auto' }}>
          <SceneTreePanel
            scene={displayedScene ?? scene}
            animationTime={editorMode === 'timeline' ? playhead : undefined}
            selectedId={selectedId}
            onSelect={(id) => apply(scene.cameras.some((camera) => camera.id === id) ? setActiveCamera(data, id) : selectObject(data, id))}
            onToggleHidden={(id, hidden) => {
              const isCam = scene.cameras.some((c) => c.id === id)
              apply(isCam ? patchCamera(data, id, { hidden }) : patchCharacter(data, id, { hidden }))
            }}
            onToggleLocked={(id, locked) => {
              const isCam = scene.cameras.some((c) => c.id === id)
              apply(isCam ? patchCamera(data, id, { locked }) : patchCharacter(data, id, { locked }))
            }}
            onToggleCrowdHidden={(crowdId, hidden) => apply(patchCrowdMembers(data, crowdId, { hidden }))}
            onRemoveCrowd={(crowdId) => apply(removeCrowd(data, crowdId))}
          />
        </div>
        <div ref={viewportBoxRef} data-testid="director-main-viewport" style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Viewport
            ref={viewportRef}
            scene={displayedScene ?? scene}
            viewpoint={exporting ? 'camera' : 'director'}
            selectedId={selectedId}
            gizmoMode={gizmoMode}
            pathDraw={trajectoryDraft ? {
              active: true,
              objectKind: trajectoryDraft.objectKind,
              groundY: trajectoryDraft.objectKind === 'camera'
                ? scene.cameras.find((camera) => camera.id === trajectoryDraft.objectId)?.position[1] ?? 0
                : scene.groundHeight ?? 0,
              gaussianGroundSnap: trajectoryDraft.objectKind === 'character' && (scene.gaussianGroundSnap ?? true),
              waypoints: trajectoryDraft.path.waypoints,
              mode: trajectoryDraft.path.mode,
              selectedIndex: trajectoryDraft.selectedIndex,
              onAddWaypoint: (xz) => updateTrajectory((draft) => ({ ...draft, path: { ...draft.path, waypoints: [...draft.path.waypoints, xz] }, selectedIndex: draft.path.waypoints.length })),
              onMoveWaypoint: (index, xz) => updateTrajectory((draft) => ({ ...draft, path: { ...draft.path, waypoints: draft.path.waypoints.map((point, pointIndex) => pointIndex === index ? xz : point) } })),
              onSelectWaypoint: (index) => setTrajectoryDraft((draft) => draft ? { ...draft, selectedIndex: index } : draft),
            } : undefined}
            skyboxUrl={effectiveSkyboxUrl}
            onSelect={(id) => apply(selectObject(data, id))}
            onPatchCharacter={onCharacterPatch}
            onPatchCamera={onCameraPatch}
          />
          {/* 画幅取景框 + 九宫格（框外遮罩；截图=框内所见） */}
          <AspectFrameOverlay frame={frameRect} showThirds={false} />
          {trajectoryDraft ? <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 7, width: 220, padding: 10, border: '1px solid #333', borderRadius: 9, background: 'rgba(20,20,20,.94)', boxShadow: '0 8px 24px rgba(0,0,0,.45)', fontSize: 12 }}>
            <div style={{ color: '#eee', fontWeight: 600, marginBottom: 7 }}>绘制轨迹</div>
            <div style={{ color: '#8b8b8b', lineHeight: 1.5, marginBottom: 8 }}>点击地面创建路径点，拖动控制点调整轨迹。</div>
            {trajectoryDraft.objectKind === 'character' ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px', gap: 6, marginBottom: 6 }}>
              <select
                aria-label="轨迹朝向"
                value={trajectoryDraft.path.facingMode ?? 'follow'}
                onChange={(event) => updateTrajectory((draft) => ({ ...draft, path: { ...draft.path, facingMode: event.target.value as 'follow' | 'reverse' | 'fixed' } }))}
                style={{ height: 28, border: '1px solid #3a3a3a', borderRadius: 6, background: '#242424', color: '#ddd', padding: '0 6px' }}
              >
                <option value="follow">面朝前进</option>
                <option value="reverse">背朝前进</option>
                <option value="fixed">保持朝向</option>
              </select>
              <input
                aria-label="朝向偏移角度"
                title="朝向偏移角度"
                type="number"
                value={Math.round(THREE.MathUtils.radToDeg(trajectoryDraft.path.facingOffset ?? 0) * 10) / 10}
                onChange={(event) => updateTrajectory((draft) => ({ ...draft, path: { ...draft.path, facingOffset: THREE.MathUtils.degToRad(Number(event.target.value) || 0) } }))}
                style={{ width: '100%', height: 28, border: '1px solid #3a3a3a', borderRadius: 6, background: '#242424', color: '#ddd', padding: '0 6px' }}
              />
            </div> : null}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => updateTrajectory((draft) => ({ ...draft, path: { ...draft.path, mode: draft.path.mode === 'linear' ? 'curve' : 'linear' } }))} style={{ flex: 1, height: 28, border: '1px solid #3a3a3a', borderRadius: 6, background: '#242424', color: '#ddd', cursor: 'pointer' }}>{trajectoryDraft.path.mode === 'linear' ? '折线' : '曲线'}</button>
              <button disabled={trajectoryDraft.selectedIndex == null} onClick={() => updateTrajectory((draft) => {
                const selectedIndex = draft.selectedIndex
                if (selectedIndex == null) return draft
                return { ...draft, selectedIndex: undefined, path: { ...draft.path, waypoints: draft.path.waypoints.filter((_, index) => index !== selectedIndex) } }
              })} style={{ flex: 1, height: 28, border: '1px solid #3a3a3a', borderRadius: 6, background: '#242424', color: trajectoryDraft.selectedIndex == null ? '#666' : '#ddd', cursor: trajectoryDraft.selectedIndex == null ? 'default' : 'pointer' }}>删除点</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => updateTrajectory((draft) => ({ ...draft, selectedIndex: undefined, path: { ...draft.path, waypoints: [] } }))} style={{ flex: 1, height: 28, border: '1px solid #3a3a3a', borderRadius: 6, background: '#242424', color: '#d98080', cursor: 'pointer' }}>清空</button>
              <button onClick={() => setTrajectoryDraft(null)} style={{ flex: 1, height: 28, border: 0, borderRadius: 6, background: '#f5f5f5', color: '#111', cursor: 'pointer' }}>完成</button>
            </div>
          </div> : null}
          <button
            onClick={() => viewportRef.current?.resetView()}
            style={{ position: 'absolute', top: 16, right: 16, padding: '6px 12px', borderRadius: 8, background: 'rgba(22,24,29,0.9)', color: '#cdd3dc', border: '1px solid #2a2f3a', cursor: 'pointer', fontSize: 12, zIndex: 6 }}
          >重置视角</button>
        </div>
        <div data-testid="director-inspector-sidebar" style={{ width: 320, borderLeft: '1px solid #1c1f26', overflowY: 'auto', background: '#151515' }}>
          {selectedCamera ? (
            <LibTvCameraPropertiesPanel
              camera={selectedCamera}
              scene={scene}
              tab={cameraTab}
              onTab={setCameraTab}
              shotGroups={shotGroups}
              busy={busy}
              onPatch={(patch) => onCameraPatch(selectedCamera.id, patch)}
              onSwitchCamera={(id) => apply(setActiveCamera(data, id))}
              cameraPreview={<div data-testid="selected-camera-preview" style={{ position: 'absolute', inset: 0 }}>
                <Viewport
                  ref={cameraPreviewRef}
                  scene={{ ...(displayedScene ?? scene), activeCameraId: selectedCamera.id }}
                  viewpoint="camera"
                  skyboxUrl={effectiveSkyboxUrl}
                  onSelect={() => {}}
                  onPatchCharacter={() => {}}
                  onPatchCamera={() => {}}
                  animationTime={editorMode === 'timeline' ? playhead : undefined}
                />
              </div>}
              onClearAll={onClearAll}
              onSendAll={onSendAll}
              onSendShot={onSendShot}
              onDeleteShot={onDeleteShot}
              timelineKeyframes={editorMode === 'timeline' ? {
                isKeyed: (property, component) => inspectorKeyframeTime != null && hasKeyframeAt(propertyTimeline, selectedCamera.id, property, inspectorKeyframeTime, component),
                toggle: (property, component) => toggleInspectorKeyframe('camera', selectedCamera.id, property, component),
              } : undefined}
            />
          ) : selectedCharacter ? (
            <CharacterPropertiesPanel
              character={selectedCharacter}
              onPatch={(patch) => onCharacterPatch(selectedCharacter.id, patch)}
              timelineMode={editorMode === 'timeline'}
              timelineKeyframes={editorMode === 'timeline' ? {
                isKeyed: (property, component) => inspectorKeyframeTime != null && hasKeyframeAt(propertyTimeline, selectedCharacter.id, property, inspectorKeyframeTime, component),
                toggle: (property, component) => toggleInspectorKeyframe('character', selectedCharacter.id, property, component),
              } : undefined}
            />
          ) : (
            <ScenePropertiesPanel
              scene={scene}
              panoramaConnected={!!(connectedPanoUrl || scene.skybox)}
              onPatch={(patch) => apply({ ...data, scene: { ...scene, ...patch } })}
            />
          )}
        </div>
      </div>
      {/* LibTV 属性关键帧时间线。旧 shot/video 时间线不再参与运行。 */}
      {editorMode === 'timeline' ? <TimelinePanel
        cameras={(scene?.cameras ?? []).map((c) => ({ id: c.id, name: c.name }))}
        defaultCameraId={scene?.activeCameraId ?? scene?.cameras?.[0]?.id}
        characters={(scene?.characters ?? []).map((c) => ({ id: c.id, name: c.name }))}
        playhead={playhead}
        playing={playing}
        onPlayToggle={onPlayToggle}
        onSeek={onSeek}
        propertyTimeline={propertyTimeline}
        onSetPropertyKeyframe={(objectKind, objectId, property) => apply({ ...dataRef.current, scene: { ...dataRef.current.scene, propertyTimeline: setPropertyKeyframes(dataRef.current.scene.propertyTimeline, dataRef.current.scene, objectKind, objectId, property, playRefs.current.playhead) } })}
        onRemovePropertyKeyframe={(objectId, property) => apply({ ...dataRef.current, scene: { ...dataRef.current.scene, propertyTimeline: removeKeyframe(dataRef.current.scene.propertyTimeline, objectId, property, playRefs.current.playhead) } })}
        onDurationChange={(duration) => {
          onSeek(Math.min(playRefs.current.playhead, duration))
          apply({ ...dataRef.current, scene: { ...dataRef.current.scene, propertyTimeline: { ...ensurePropertyTimeline(dataRef.current.scene.propertyTimeline), duration } } })
        }}
        autoKeyframe={autoKeyframe}
        onAutoKeyframeChange={(enabled) => {
          setAutoKeyframe(enabled)
          showToast(enabled ? '自动帧已开启：修改属性会在当前播放头打关键帧' : '自动帧已关闭', 'success')
        }}
        loop={timelineLoop}
        onLoopChange={setTimelineLoop}
        canManageSelectedTracks={!!(selectedCharacter || selectedCamera)}
        selectedTracksExist={!!(selectedCharacter || selectedCamera) && propertyTimeline.tracks.some((track) => track.objectId === (selectedCharacter ?? selectedCamera)?.id)}
        onAddSelectedTracks={() => {
          const object = selectedCharacter ?? selectedCamera
          if (!object) return
          const kind = selectedCharacter ? 'character' : 'camera'
          apply({ ...dataRef.current, scene: { ...dataRef.current.scene, propertyTimeline: addObjectTracks(dataRef.current.scene.propertyTimeline, dataRef.current.scene, kind, object.id, playRefs.current.playhead) } })
        }}
        onRemoveSelectedTracks={() => {
          const object = selectedCharacter ?? selectedCamera
          if (!object) return
          apply({ ...dataRef.current, scene: { ...dataRef.current.scene, propertyTimeline: removeObjectTracks(dataRef.current.scene.propertyTimeline, object.id) } })
        }}
        onSelectCharacter={(id) => apply(selectObject(dataRef.current, id))}
        onDrawTrajectory={toggleTrajectory}
        activeTrajectoryId={trajectoryDraft?.objectId}
      /> : null}
      {/* 底部工具条 */}
      <Toolbar
        busy={busy}
        aspect={scene.aspect}
        gizmoMode={gizmoMode}
        onSetGizmoMode={setGizmoMode}
        onAddCharacter={(modelId) => apply(addCharacter(data, { id: uid('char'), modelId }))}
        onAddCrowd={onAddCrowd}
        onUploadModel={onUploadModel}
        onUploadGaussian={onUploadGaussian}
        onSetSkybox={onSetSkybox}
        hasSkybox={!!scene.skybox}
        panoConnected={!!connectedPanoUrl}
        skyboxYaw={scene.skyboxYaw ?? 0}
        onSetSkyboxYaw={(deg) => apply(setSkyboxYaw(data, deg))}
        onGeneratePanorama={onGeneratePanorama}
        onOpenPanoramaHistory={() => requestHistoryImage('director-panorama', (url) => {
          if (!isPersistableImageRef(url)) { showToast('历史图片不是可持久化远程地址', 'error'); return }
          apply(setSkybox(dataRef.current, url))
          showToast('已应用历史全景图', 'success')
        })}
        onAddCamera={() => apply(addCamera(data, { id: uid('cam') }))}
        onSetAspect={(a) => apply(setAspect(data, a))}
        onCapture={onCapture}
        onAiSceneImport={() => setAiImportOpen(true)}
        editorMode={editorMode}
        onEditorModeChange={setEditorMode}
      />
      {aiImportOpen ? <AiSceneImportDialog
        busy={busy}
        sourceUrl={aiImportSourceUrl}
        onClose={() => setAiImportOpen(false)}
        onUpload={onAiImportUpload}
        onOpenHistory={() => requestHistoryImage('director-ai-import', (url) => {
          if (!isPersistableImageRef(url)) { showToast('历史图片不是可持久化远程地址', 'error'); return }
          setAiImportSourceUrl(url)
          showToast('已选择历史图片', 'success')
        })}
        onGenerate={onGeneratePlacementReference}
      /> : null}
      {/* 本节点的 capture 认领器：Modal 打开期间由它负责（离屏渲染机位 POV/样片），全局 runner 让位 */}
      <DirectorCaptureRunner nodes={scopedRunnerNodes} onlyNodeId={nodeId} />
      {/* 导演台内吐司：固定底部居中、在导演台之上（不被画布盖住） */}
      {modalToast ? (
        <div style={{ position: 'fixed', left: '50%', bottom: 88, transform: 'translateX(-50%)', zIndex: 4200,
          padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          background: modalToast.type === 'success' ? '#16a34a' : modalToast.type === 'error' ? '#dc2626' : modalToast.type === 'warning' ? '#b45309' : '#374151',
          maxWidth: '70vw', textAlign: 'center' }}
          onClick={() => setModalToast(null)}>
          {modalToast.msg}
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
