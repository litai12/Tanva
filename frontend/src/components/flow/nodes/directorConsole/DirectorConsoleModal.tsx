// @ts-nocheck
import React from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, useStore } from 'reactflow'
import { HelpCircle as IconHelpCircle, X as IconX } from 'lucide-react'
import { toast } from './toast'
import type { DirectorConsoleData, CameraShot, Vec3 } from './types'
import {
  addCharacter, addCamera, selectObject, removeObject,
  patchCharacter, patchCamera, setAspect, setViewpoint, setActiveCamera, setSkybox,
} from './state/scene'
import { Viewport, type ViewportHandle, type GizmoMode } from './scene/Viewport'
import { SceneTreePanel } from './panels/SceneTreePanel'
import { CharacterPropertiesPanel } from './panels/CharacterPropertiesPanel'
import { CameraPropertiesPanel } from './panels/CameraPropertiesPanel'
import { Toolbar } from './panels/Toolbar'
import { sendShotsToCanvas } from './sendToCanvas'

let uidCounter = 0
const uid = (p: string) => `${p}-${Date.now()}-${uidCounter++}`

function getNodesFromState(state: any): any[] {
  if (Array.isArray(state?.nodes)) return state.nodes
  if (state?.nodeInternals && typeof state.nodeInternals.values === 'function') return Array.from(state.nodeInternals.values())
  if (state?.nodeLookup && typeof state.nodeLookup.values === 'function') return Array.from(state.nodeLookup.values())
  return []
}

type Props = { nodeId: string; onClose: () => void }

export default function DirectorConsoleModal({ nodeId, onClose }: Props) {
  const rf = useReactFlow()
  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id: nodeId, patch } }))
  }, [nodeId])

  const [data, setData] = React.useState<DirectorConsoleData>(() => {
    const seed = rf.getNode(nodeId)?.data as DirectorConsoleData | undefined
    return seed && seed.scene ? seed : ({ kind: 'directorConsole', label: '导演台', scene: { characters: [], cameras: [], aspect: 'auto' }, activeViewpoint: 'director' } as DirectorConsoleData)
  })
  const viewportRef = React.useRef<ViewportHandle | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [gizmoMode, setGizmoMode] = React.useState<GizmoMode>('translate')
  const [shots, setShots] = React.useState<Record<string, CameraShot[]>>({})
  const [cameraTab, setCameraTab] = React.useState<'props' | 'shots'>('props')

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

  const apply = React.useCallback((next: DirectorConsoleData) => {
    setData(next)
    updateNodeData({ scene: next.scene, activeViewpoint: next.activeViewpoint, selectedObjectId: next.selectedObjectId })
  }, [updateNodeData])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        const rx = -fz, rz = fx
        if (e.key === 'ArrowUp') { dx = fx * step; dz = fz * step }
        else if (e.key === 'ArrowDown') { dx = -fx * step; dz = -fz * step }
        else if (e.key === 'ArrowRight') { dx = rx * step; dz = rz * step }
        else if (e.key === 'ArrowLeft') { dx = -rx * step; dz = -rz * step }
      }
      const r3 = (v: number) => Math.round(v * 1000) / 1000
      const pos: Vec3 = [r3(obj.position[0] + dx), r3(obj.position[1] + dy), r3(obj.position[2] + dz)]
      apply(ch ? patchCharacter(data, id, { position: pos }) : patchCamera(data, id, { position: pos }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, apply])

  const connectedPanoUrl = useStore((state: any) => {
    const edges = Array.isArray(state?.edges) ? state.edges : []
    const nodes = getNodesFromState(state)
    const inc = edges.find((e) => e.target === nodeId)
    if (!inc) return undefined
    const src = nodes.find((n) => n.id === inc.source)
    const d = src?.data as any
    if (!d) return undefined
    if (typeof d.imageUrl === 'string' && d.imageUrl.trim()) return d.imageUrl.trim()
    if (Array.isArray(d.imageResults) && typeof d.imageResults[0]?.url === 'string') return d.imageResults[0].url
    if (Array.isArray(d.results) && typeof d.results[0]?.url === 'string') return d.results[0].url
    if (typeof d.url === 'string' && d.url.trim()) return d.url.trim()
    return undefined
  }) as string | undefined

  const scene = data.scene
  const selectedId = data.selectedObjectId
  const selectedCamera = scene?.cameras.find((c) => c.id === selectedId)
  const selectedCharacter = scene?.characters.find((c) => c.id === selectedId)

  const onCapture = React.useCallback(() => {
    const view = viewportRef.current?.getCurrentCamera()
    const dataUrl = viewportRef.current?.captureView()
    if (!view || !dataUrl) { toast('截图失败，请重试', 'error'); return }
    const newCamId = uid('cam')
    const next = addCamera(data, { id: newCamId, position: view.position, lookAt: view.lookAt, fovDeg: view.fovDeg })
    apply(next)
    const camName = next.scene.cameras.find((c) => c.id === newCamId)?.name ?? '机位'
    setShots((prev) => ({
      ...prev,
      [newCamId]: [{ id: uid('shot'), name: `${camName}-截图01`, imageUrl: dataUrl, aspect: scene.aspect, createdAt: Date.now() }],
    }))
    setCameraTab('shots')
  }, [scene, data, apply])

  const onClearAll = React.useCallback(() => setShots({}), [])

  const onDeleteShot = React.useCallback((cameraId: string, shotId: string) => {
    setShots((prev) => ({ ...prev, [cameraId]: (prev[cameraId] ?? []).filter((s) => s.id !== shotId) }))
  }, [])

  const sendList = React.useCallback((list: CameraShot[]) => {
    if (!list.length) { toast('该机位还没有截图', 'warning'); return }
    setBusy(true)
    try {
      sendShotsToCanvas(nodeId, list)
      toast(`已发送 ${list.length} 张截图到画布`, 'success')
    } catch (e: any) {
      toast(e?.message || '发送失败，请重试', 'error')
    } finally {
      setBusy(false)
    }
  }, [nodeId])

  const onSendAll = React.useCallback(() => sendList(Object.values(shots).flat()), [shots, sendList])
  const onSendShot = React.useCallback((cameraId: string, shotId: string) => {
    const s = (shots[cameraId] ?? []).find((x) => x.id === shotId)
    if (s) sendList([s])
  }, [shots, sendList])

  const shotGroups = (scene?.cameras ?? [])
    .map((c) => ({ cameraId: c.id, cameraName: c.name, shots: shots[c.id] ?? [] }))
    .filter((g) => g.shots.length > 0)

  const onAddCrowd = React.useCallback(() => {
    let next = data
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        next = addCharacter(next, { id: uid('char'), modelId: 'male', position: [(c - 1) * 1.2, 0, (r - 1) * 1.2] })
      }
    }
    apply(next)
  }, [data, apply])

  const onUploadModel = React.useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    apply(addCharacter(data, { id: uid('char'), modelId: url }))
    toast('已加载本地模型', 'success')
  }, [data, apply])

  const onSetSkybox = React.useCallback((file: File | null) => {
    apply(setSkybox(data, file ? URL.createObjectURL(file) : undefined))
  }, [data, apply])

  if (!scene) return null

  return createPortal(
    <div className="nodrag nopan nowheel"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 8200, background: '#0a0b0d', display: 'flex', flexDirection: 'column', color: '#e5e7eb' }}>
      <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', borderBottom: '1px solid #1c1f26' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>3D导演台</div>
        <div style={{ display: 'flex', gap: 2, background: '#16181d', borderRadius: 10, padding: 3 }}>
          {(['director', 'camera'] as const).map((vp) => (
            <button key={vp} onClick={() => apply(setViewpoint(data, vp))}
              style={{ padding: '6px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, background: data.activeViewpoint === vp ? '#2c313c' : 'transparent', color: data.activeViewpoint === vp ? '#fff' : '#8b93a1' }}>
              {vp === 'director' ? '导演视角' : '机位视角'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#5b6470' }} title="3D 素体模型许可证">模型 © Cesium · CC-BY 4.0</span>
          <span title={'快捷键：\nV/R/S 切换 移动/旋转/缩放\n方向键 微调选中对象（0.1m）\nShift+方向键 粗调（0.5m）\nAlt+↑↓ 调整高度\nDelete/退格 删除选中'} style={{ display: 'flex' }}>
            <IconHelpCircle size={20} color="#6b7280" style={{ cursor: 'pointer' }} />
          </span>
          <IconX size={20} color="#9ca3af" style={{ cursor: 'pointer' }} onClick={onClose} />
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 240, borderRight: '1px solid #1c1f26', overflowY: 'auto' }}>
          <SceneTreePanel
            scene={scene}
            selectedId={selectedId}
            onSelect={(id) => apply(selectObject(data, id))}
            onToggleHidden={(id, hidden) => {
              const isCam = scene.cameras.some((c) => c.id === id)
              apply(isCam ? patchCamera(data, id, { hidden }) : patchCharacter(data, id, { hidden }))
            }}
            onToggleLocked={(id, locked) => {
              const isCam = scene.cameras.some((c) => c.id === id)
              apply(isCam ? patchCamera(data, id, { locked }) : patchCharacter(data, id, { locked }))
            }}
          />
        </div>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Viewport
            ref={viewportRef}
            scene={scene}
            viewpoint={data.activeViewpoint}
            selectedId={selectedId}
            gizmoMode={gizmoMode}
            skyboxUrl={connectedPanoUrl ?? scene.skybox}
            onSelect={(id) => apply(selectObject(data, id))}
            onPatchCharacter={(id, patch) => apply(patchCharacter(data, id, patch))}
            onPatchCamera={(id, patch) => apply(patchCamera(data, id, patch))}
          />
          {data.activeViewpoint === 'director' ? (
            <button
              onClick={() => viewportRef.current?.resetView()}
              style={{ position: 'absolute', top: 16, right: 16, padding: '6px 12px', borderRadius: 8, background: 'rgba(22,24,29,0.9)', color: '#cdd3dc', border: '1px solid #2a2f3a', cursor: 'pointer', fontSize: 12 }}
            >重置视角</button>
          ) : null}
        </div>
        <div style={{ width: 320, borderLeft: '1px solid #1c1f26', overflowY: 'auto' }}>
          {selectedCamera ? (
            <CameraPropertiesPanel
              camera={selectedCamera}
              scene={scene}
              tab={cameraTab}
              onTab={setCameraTab}
              shotGroups={shotGroups}
              busy={busy}
              onPatch={(patch) => apply(patchCamera(data, selectedCamera.id, patch))}
              onSwitchCamera={(id) => apply(selectObject(setActiveCamera(data, id), id))}
              onClearAll={onClearAll}
              onSendAll={onSendAll}
              onSendShot={onSendShot}
              onDeleteShot={onDeleteShot}
            />
          ) : selectedCharacter ? (
            <CharacterPropertiesPanel
              character={selectedCharacter}
              onPatch={(patch) => apply(patchCharacter(data, selectedCharacter.id, patch))}
            />
          ) : (
            <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>选中机位或角色以编辑属性</div>
          )}
        </div>
      </div>
      <Toolbar
        busy={busy}
        aspect={scene.aspect}
        gizmoMode={gizmoMode}
        onSetGizmoMode={setGizmoMode}
        onAddCharacter={(modelId) => apply(addCharacter(data, { id: uid('char'), modelId }))}
        onAddCrowd={onAddCrowd}
        onUploadModel={onUploadModel}
        onSetSkybox={onSetSkybox}
        hasSkybox={!!scene.skybox}
        panoConnected={!!connectedPanoUrl}
        onAddCamera={() => apply(addCamera(data, { id: uid('cam') }))}
        onSetAspect={(a) => apply(setAspect(data, a))}
        onCapture={onCapture}
        onDeleteSelected={selectedId ? () => apply(removeObject(data, selectedId)) : undefined}
      />
    </div>,
    document.body,
  )
}
