import React from 'react'
import { IconUserPlus, IconVideoPlus, IconAspectRatio, IconCamera, IconArrowsMove, IconPhoto, IconPointer, IconClock, IconScan, IconMaximize } from '@tabler/icons-react'
import type { AspectKey } from '../types'
import { BODY_TYPES, PROP_TYPES } from '../assets'
import type { CrowdInput } from '../state/crowd'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

type Props = {
  busy: boolean
  aspect: AspectKey
  gizmoMode: GizmoMode
  onSetGizmoMode: (m: GizmoMode) => void
  onAddCharacter: (modelId: string) => void
  onAddCrowd: (input: CrowdInput) => void
  onUploadModel: (file: File) => void
  onUploadGaussian: (file: File) => void
  onSetSkybox: (file: File | null) => void
  hasSkybox: boolean
  panoConnected: boolean
  skyboxYaw: number
  onSetSkyboxYaw: (deg: number) => void
  onAddCamera: () => void
  onSetAspect: (a: AspectKey) => void
  showThirds: boolean
  onToggleThirds: () => void
  onCapture: () => void
  onDeleteSelected?: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  editorMode: 'scene' | 'timeline'
  onEditorModeChange: (mode: 'scene' | 'timeline') => void
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

export function Toolbar({ busy, aspect, gizmoMode, onSetGizmoMode, onAddCharacter, onAddCrowd, onUploadModel, onUploadGaussian, onSetSkybox, hasSkybox, panoConnected, skyboxYaw, onSetSkyboxYaw, onAddCamera, onSetAspect, showThirds, onToggleThirds, onCapture, onDeleteSelected, onUndo, onRedo, canUndo, canRedo, editorMode, onEditorModeChange }: Props) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const gaussianRef = React.useRef<HTMLInputElement>(null)
  const skyRef = React.useRef<HTMLInputElement>(null)
  return (
    <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px 12px', pointerEvents: 'none' }}>
      <input ref={fileRef} type="file" accept=".glb,.gltf,model/gltf-binary" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadModel(f); e.currentTarget.value = '' }} />
      <input ref={gaussianRef} type="file" accept=".splat,application/octet-stream" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadGaussian(f); e.currentTarget.value = '' }} />
      <input ref={skyRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onSetSkybox(f); e.currentTarget.value = '' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(30,30,30,0.94)', borderRadius: 16, padding: 8, border: '0.5px solid rgba(255,255,255,0.12)', boxShadow: '0 4px 10px rgba(0,0,0,0.35)', backdropFilter: 'blur(12px)', pointerEvents: 'auto' }}>
        <button style={gizmoMode === 'translate' ? btnOn : btn} title="移动" onClick={() => onSetGizmoMode('translate')}><IconArrowsMove size={20} /></button>
        <div style={{ width: 1, height: 24, background: '#2a2f3a', margin: '0 4px' }} />
        <Pop icon={<IconUserPlus size={20} />} title="添加角色">
          {(close) => (
            <>
              <button style={item} onClick={() => { fileRef.current?.click(); close() }}>本地上传</button>
              <button style={item} onClick={() => { gaussianRef.current?.click(); close() }}>高斯泼溅</button>
              <div style={sep} />
              {BODY_TYPES.map((m) => (
                <button key={m.id} style={item} onClick={() => { onAddCharacter(m.id); close() }}>{m.name}</button>
              ))}
              <button style={item} onClick={() => { onAddCharacter('empty-object'); close() }}>空对象</button>
              <button style={item} onClick={() => { onAddCrowd({ modelId: 'male', rows: 3, columns: 3, spacing: 1.2 }); close() }}>人群 3×3</button>
              <div style={sep} />
              <div style={{ fontSize: 11, color: '#6b7280', padding: '4px 10px' }}>几何模型</div>
              <button style={item} onClick={() => { fileRef.current?.click(); close() }}>上传文件</button>
              {PROP_TYPES.filter((model) => model.id !== 'prop-plane').map((m) => (
                <button key={m.id} style={item} onClick={() => { onAddCharacter(m.id); close() }}>{m.name}</button>
              ))}
            </>
          )}
        </Pop>
        <Pop icon={<IconPhoto size={20} />} title="全景背景">
          {(close) => (
            <div style={{ minWidth: 230 }}>
              <div style={{ fontSize: 12, padding: '6px 10px', color: panoConnected ? '#7fd18b' : '#8b93a1', lineHeight: 1.5 }}>
                {panoConnected ? '✓ 已连接全景图（来自连入的图片节点）' : '把图片节点连到导演台左侧输入口即可作为全景背景'}
              </div>
              <div style={sep} />
              <button style={item} onClick={() => { skyRef.current?.click(); close() }}>本地上传</button>
              <button style={item}>历史</button>
              <button style={item}>AI 生成</button>
              {hasSkybox ? <button style={{ ...item, color: '#d98080' }} onClick={() => { onSetSkybox(null); close() }}>清除上传的全景图</button> : null}
              {(hasSkybox || panoConnected) ? (
                <>
                  <div style={sep} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, color: '#cdd3dc' }}>
                    旋转
                    <input type="range" min={0} max={360} step={5} value={skyboxYaw}
                      onChange={(e) => onSetSkyboxYaw(Number(e.target.value))} style={{ flex: 1 }} />
                    {skyboxYaw}°
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', padding: '0 10px 6px' }}>非 2:1 的图会自动转为环幕穹顶展示</div>
                </>
              ) : null}
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
        <button style={btn} title="AI 图片识别导入"><IconScan size={20} /></button>
        <button style={btn} title="全屏" onClick={() => { const root = document.querySelector('[data-testid=director-console-modal]') as HTMLElement | null; if (!document.fullscreenElement) void root?.requestFullscreen?.(); else void document.exitFullscreen?.() }}><IconMaximize size={20} /></button>
        <div style={{ width: 1, height: 24, background: '#525252', margin: '0 4px' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, padding: 2, borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
          <button
            type="button"
            aria-label="场景编辑"
            aria-pressed={editorMode === 'scene'}
            title="场景编辑"
            onClick={() => onEditorModeChange('scene')}
            style={{ ...btn, width: 32, height: 32, padding: 6, justifyContent: 'center', background: editorMode === 'scene' ? '#141414' : 'transparent', boxShadow: editorMode === 'scene' ? '0 4px 10px rgba(0,0,0,0.2)' : 'none' }}
          ><IconPointer size={17} /></button>
          <button
            type="button"
            aria-label="动画时间轴"
            aria-pressed={editorMode === 'timeline'}
            title="动画时间轴"
            onClick={() => onEditorModeChange('timeline')}
            style={{ ...btn, width: 32, height: 32, padding: 6, justifyContent: 'center', background: editorMode === 'timeline' ? '#141414' : 'transparent', boxShadow: editorMode === 'timeline' ? '0 4px 10px rgba(0,0,0,0.2)' : 'none' }}
          ><IconClock size={17} /></button>
        </div>
      </div>
    </div>
  )
}
