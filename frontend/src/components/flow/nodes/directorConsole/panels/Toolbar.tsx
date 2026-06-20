import React from 'react'
import {
  UserPlus as IconUserPlus,
  Video as IconVideoPlus,
  Ratio as IconAspectRatio,
  Camera as IconCamera,
  Trash2 as IconTrash,
  Move as IconArrowsMove,
  RotateCw as IconRotate,
  Maximize2 as IconResize,
  Image as IconPhoto,
} from 'lucide-react'
import type { AspectKey } from '../types'
import { BODY_TYPES, FURNITURE_TYPES, PROP_TYPES } from '../assets'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

type Props = {
  busy: boolean
  aspect: AspectKey
  gizmoMode: GizmoMode
  onSetGizmoMode: (m: GizmoMode) => void
  onAddCharacter: (modelId: string) => void
  onAddCrowd: () => void
  onUploadModel: (file: File) => void
  onSetSkybox: (file: File | null) => void
  hasSkybox: boolean
  panoConnected: boolean
  onAddCamera: () => void
  onSetAspect: (a: AspectKey) => void
  onCapture: () => void
  onDeleteSelected?: () => void
}

const ASPECTS: AspectKey[] = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

const btn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 8, borderRadius: 8, display: 'flex', color: '#cdd3dc' }
const btnOn: React.CSSProperties = { ...btn, background: '#2c313c', color: '#fff' }
const menu: React.CSSProperties = { position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: '#16181d', border: '1px solid #2a2f3a', borderRadius: 10, padding: 6, minWidth: 150, maxHeight: '62vh', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }
const item: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#cdd3dc', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }
const sep: React.CSSProperties = { height: 1, background: '#2a2f3a', margin: '4px 2px' }

function Pop({ icon, title, children }: { icon: React.ReactNode; title: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button style={btn} title={title} onClick={() => setOpen((v) => !v)}>{icon}</button>
      {open ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1 }} onClick={() => setOpen(false)} />
          <div style={{ ...menu, zIndex: 2 }}>{children(() => setOpen(false))}</div>
        </>
      ) : null}
    </div>
  )
}

export function Toolbar({ busy, aspect, gizmoMode, onSetGizmoMode, onAddCharacter, onAddCrowd, onUploadModel, onSetSkybox, hasSkybox, panoConnected, onAddCamera, onSetAspect, onCapture, onDeleteSelected }: Props) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const skyRef = React.useRef<HTMLInputElement>(null)
  return (
    <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid #1c1f26' }}>
      <input ref={fileRef} type="file" accept=".glb,.gltf,model/gltf-binary" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadModel(f); e.currentTarget.value = '' }} />
      <input ref={skyRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onSetSkybox(f); e.currentTarget.value = '' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#101216', borderRadius: 14, padding: 6, border: '1px solid #1c1f26' }}>
        {/* 变换模式：移动/旋转/缩放 */}
        <button style={gizmoMode === 'translate' ? btnOn : btn} title="移动 (V)" onClick={() => onSetGizmoMode('translate')}><IconArrowsMove size={20} /></button>
        <button style={gizmoMode === 'rotate' ? btnOn : btn} title="旋转 (R)" onClick={() => onSetGizmoMode('rotate')}><IconRotate size={20} /></button>
        <button style={gizmoMode === 'scale' ? btnOn : btn} title="缩放 (S)" onClick={() => onSetGizmoMode('scale')}><IconResize size={20} /></button>
        <div style={{ width: 1, height: 24, background: '#2a2f3a', margin: '0 4px' }} />
        <Pop icon={<IconUserPlus size={20} />} title="添加角色">
          {(close) => (
            <>
              <button style={item} onClick={() => { fileRef.current?.click(); close() }}>本地上传…</button>
              <div style={sep} />
              {BODY_TYPES.map((m) => (
                <button key={m.id} style={item} onClick={() => { onAddCharacter(m.id); close() }}>{m.name}</button>
              ))}
              <button style={item} onClick={() => { onAddCrowd(); close() }}>群众 (3×3)</button>
              <div style={sep} />
              <div style={{ fontSize: 11, color: '#6b7280', padding: '4px 10px' }}>家具道具</div>
              {FURNITURE_TYPES.map((m) => (
                <button key={m.id} style={item} onClick={() => { onAddCharacter(m.id); close() }}>{m.name}</button>
              ))}
              <div style={sep} />
              <div style={{ fontSize: 11, color: '#6b7280', padding: '4px 10px' }}>几何模型</div>
              {PROP_TYPES.map((m) => (
                <button key={m.id} style={item} onClick={() => { onAddCharacter(m.id); close() }}>{m.name}</button>
              ))}
            </>
          )}
        </Pop>
        <Pop icon={<IconPhoto size={20} />} title="全景背景">
          {(close) => (
            <div style={{ minWidth: 220 }}>
              <div style={{ fontSize: 12, padding: '6px 10px', color: panoConnected ? '#7fd18b' : '#8b93a1', lineHeight: 1.5 }}>
                {panoConnected ? '✓ 已连接全景图（来自连入的图片节点）' : '把图片节点连到导演台左侧输入口即可作为全景背景'}
              </div>
              <div style={sep} />
              <button style={item} onClick={() => { skyRef.current?.click(); close() }}>或本地上传全景图…</button>
              {hasSkybox ? <button style={{ ...item, color: '#d98080' }} onClick={() => { onSetSkybox(null); close() }}>清除上传的全景图</button> : null}
            </div>
          )}
        </Pop>
        <button style={btn} title="添加机位" onClick={onAddCamera}><IconVideoPlus size={20} /></button>
        <Pop icon={<IconAspectRatio size={20} />} title="选择画幅比例">
          {(close) => (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {ASPECTS.map((a) => (
                <button key={a} style={{ ...item, textAlign: 'center', background: a === aspect ? '#2c313c' : 'transparent' }} onClick={() => { onSetAspect(a); close() }}>{a === 'auto' ? 'Auto' : a}</button>
              ))}
            </div>
          )}
        </Pop>
        <button style={{ ...btn, opacity: busy ? 0.5 : 1 }} title="截图" disabled={busy} onClick={onCapture}><IconCamera size={20} /></button>
        {onDeleteSelected ? (
          <button style={{ ...btn, color: '#d98080' }} title="删除选中" onClick={onDeleteSelected}><IconTrash size={20} /></button>
        ) : null}
      </div>
    </div>
  )
}
