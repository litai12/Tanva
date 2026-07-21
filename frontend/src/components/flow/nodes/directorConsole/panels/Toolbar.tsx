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
  onUploadModel: (files: File[]) => void
  onUploadGaussian: (file: File) => void
  onSetSkybox: (file: File | null) => void
  hasSkybox: boolean
  panoConnected: boolean
  skyboxYaw: number
  onSetSkyboxYaw: (deg: number) => void
  onGeneratePanorama: (prompt: string) => Promise<void>
  onOpenPanoramaHistory: () => void
  onAddCamera: () => void
  onSetAspect: (a: AspectKey) => void
  onCapture: () => void
  onAiSceneImport: () => void
  editorMode: 'scene' | 'timeline'
  onEditorModeChange: (mode: 'scene' | 'timeline') => void
}

const ASPECTS: AspectKey[] = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

const btn: React.CSSProperties = { width: 32, height: 30, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, borderRadius: 7, display: 'grid', placeItems: 'center', color: '#cdd3dc' }
const btnOn: React.CSSProperties = { ...btn, background: '#2c313c', color: '#fff' }
const toolWrap: React.CSSProperties = { position: 'relative', width: 64, minWidth: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }
const toolLabel: React.CSSProperties = { maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', color: '#a3a3a3', fontSize: 10, lineHeight: '12px', whiteSpace: 'nowrap', userSelect: 'none' }
const menu: React.CSSProperties = { position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: '#16181d', border: '1px solid #2a2f3a', borderRadius: 10, padding: 6, minWidth: 150, maxHeight: '62vh', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }
const item: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#cdd3dc', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }
const sep: React.CSSProperties = { height: 1, background: '#2a2f3a', margin: '4px 2px' }

function ToolButton({ icon, title, label = title, active, disabled, onClick }: { icon: React.ReactNode; title: string; label?: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <div style={toolWrap}>
    <button style={{ ...(active ? btnOn : btn), opacity: disabled ? 0.5 : 1 }} title={title} disabled={disabled} onClick={onClick}>{icon}</button>
    <span style={toolLabel}>{label}</span>
  </div>
}

function Pop({ icon, title, label = title, children }: { icon: React.ReactNode; title: string; label?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div style={toolWrap}>
      <button style={btn} title={title} onClick={() => setOpen((v) => !v)}>{icon}</button>
      <span style={toolLabel}>{label}</span>
      {open ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1 }} onClick={() => setOpen(false)} />
          <div style={{ ...menu, zIndex: 2 }}>{children(() => setOpen(false))}</div>
        </>
      ) : null}
    </div>
  )
}

function PanoramaAiForm({ busy, onGenerate, close }: { busy: boolean; onGenerate: (prompt: string) => Promise<void>; close: () => void }) {
  const [prompt, setPrompt] = React.useState('')
  return <div style={{ width: 260, padding: 6 }}>
    <div style={{ color: '#e5e5e5', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>AI 生成全景图</div>
    <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述需要的 360° 场景环境" rows={4} style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box', border: '1px solid #3a3a3a', borderRadius: 7, background: '#202020', color: '#eee', padding: 8, fontSize: 12 }} />
    <div style={{ color: '#737373', fontSize: 10.5, lineHeight: 1.5, margin: '7px 0' }}>生成 2:1 等距柱状全景图，完成后自动设为当前导演台背景。</div>
    <button disabled={busy || !prompt.trim()} onClick={() => void onGenerate(prompt.trim()).then(close)} style={{ width: '100%', height: 32, border: 0, borderRadius: 7, background: '#f5f5f5', color: '#111', opacity: busy || !prompt.trim() ? 0.5 : 1, cursor: busy || !prompt.trim() ? 'default' : 'pointer', fontSize: 12 }}>{busy ? '生成中…' : '生成全景图'}</button>
  </div>
}

function CharacterMenu({ close, onLocalUpload, onGaussianUpload, onAddCharacter, onAddCrowd }: {
  close: () => void
  onLocalUpload: () => void
  onGaussianUpload: () => void
  onAddCharacter: (modelId: string) => void
  onAddCrowd: () => void
}) {
  const [page, setPage] = React.useState<'main' | 'geometry'>('main')
  if (page === 'geometry') return <>
    <button style={item} onClick={() => setPage('main')}>← 返回</button>
    <div style={sep} />
    <button style={item} onClick={() => { onLocalUpload(); close() }}>上传文件</button>
    {PROP_TYPES.filter((model) => model.id !== 'prop-plane').map((model) => (
      <button key={model.id} style={item} onClick={() => { onAddCharacter(model.id); close() }}>{model.name}</button>
    ))}
  </>
  return <>
    <button style={item} onClick={() => { onLocalUpload(); close() }}>本地上传</button>
    <button style={item} onClick={() => { onGaussianUpload(); close() }}>高斯泼溅</button>
    <div style={sep} />
    {BODY_TYPES.map((model) => (
      <button key={model.id} style={item} onClick={() => { onAddCharacter(model.id); close() }}>{model.name}</button>
    ))}
    <button style={item} onClick={() => { onAddCharacter('empty-object'); close() }}>添加空对象</button>
    <button style={item} onClick={() => { onAddCrowd(); close() }}>群众 (3x3)</button>
    <button style={item} onClick={() => setPage('geometry')}>几何模型</button>
  </>
}

export function Toolbar({ busy, aspect, gizmoMode, onSetGizmoMode, onAddCharacter, onAddCrowd, onUploadModel, onUploadGaussian, onSetSkybox, hasSkybox, panoConnected, skyboxYaw, onSetSkyboxYaw, onGeneratePanorama, onOpenPanoramaHistory, onAddCamera, onSetAspect, onCapture, onAiSceneImport, editorMode, onEditorModeChange }: Props) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const gaussianRef = React.useRef<HTMLInputElement>(null)
  const skyRef = React.useRef<HTMLInputElement>(null)
  const [panoramaAiOpen, setPanoramaAiOpen] = React.useState(false)
  return (
    <nav aria-label="导演台工具栏" style={{ position: 'absolute', zIndex: 20, left: 240, right: 320, bottom: editorMode === 'timeline' ? 258 : 8, height: 54, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'none' }}>
      <input ref={fileRef} type="file" multiple accept=".glb,.gltf,.bin,image/png,image/jpeg,image/webp,image/ktx2,model/gltf-binary,model/gltf+json,application/octet-stream" style={{ display: 'none' }}
        onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) onUploadModel(files); e.currentTarget.value = '' }} />
      <input ref={gaussianRef} type="file" accept=".splat,application/octet-stream" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadGaussian(f); e.currentTarget.value = '' }} />
      <input ref={skyRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onSetSkybox(f); e.currentTarget.value = '' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'rgba(27,27,27,0.96)', borderRadius: 13, padding: '6px 7px', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 6px 18px rgba(0,0,0,0.42)', backdropFilter: 'blur(12px)', pointerEvents: 'auto' }}>
        <ToolButton icon={<IconArrowsMove size={20} />} title="移动" label="移动 (V)" active={gizmoMode === 'translate'} onClick={() => onSetGizmoMode('translate')} />
        <div style={{ width: 1, height: 24, background: '#2a2f3a', margin: '0 4px' }} />
        <Pop icon={<IconUserPlus size={20} />} title="添加角色">
          {(close) => <CharacterMenu
            close={close}
            onLocalUpload={() => fileRef.current?.click()}
            onGaussianUpload={() => gaussianRef.current?.click()}
            onAddCharacter={onAddCharacter}
            onAddCrowd={() => onAddCrowd({ modelId: 'male', rows: 3, columns: 3, spacing: 1.2 })}
          />}
        </Pop>
        <Pop icon={<IconPhoto size={20} />} title="全景背景" label="全景图">
          {(close) => (
            panoramaAiOpen ? <PanoramaAiForm busy={busy} onGenerate={onGeneratePanorama} close={() => { setPanoramaAiOpen(false); close() }} /> : <div style={{ minWidth: 230 }}>
              <div style={{ fontSize: 12, padding: '6px 10px', color: panoConnected ? '#7fd18b' : '#8b93a1', lineHeight: 1.5 }}>
                {panoConnected ? '✓ 已连接全景图（来自连入的图片节点）' : '把图片节点连到导演台左侧输入口即可作为全景背景'}
              </div>
              <div style={sep} />
              <button style={item} onClick={() => { skyRef.current?.click(); close() }}>本地上传</button>
              <button style={item} onClick={() => { onOpenPanoramaHistory(); close() }}>历史记录</button>
              <button style={item} onClick={() => setPanoramaAiOpen(true)}>AI生成</button>
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
        <ToolButton icon={<IconVideoPlus size={20} />} title="添加机位" onClick={onAddCamera} />
        <Pop icon={<IconAspectRatio size={20} />} title="选择画幅比例">
          {(close) => (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {ASPECTS.map((a) => (
                <button key={a} style={{ ...item, textAlign: 'center', background: a === aspect ? '#2c313c' : 'transparent' }} onClick={() => { onSetAspect(a); close() }}>{a === 'auto' ? 'Auto' : a}</button>
              ))}
            </div>
          )}
        </Pop>
        <ToolButton icon={<IconCamera size={20} />} title="截图" disabled={busy} onClick={onCapture} />
        <ToolButton icon={<IconScan size={20} />} title="AI 图片识别导入" label="AI 识图导入" onClick={onAiSceneImport} />
        <ToolButton icon={<IconMaximize size={20} />} title="全屏" onClick={() => { const root = document.querySelector('[data-testid=director-console-modal]') as HTMLElement | null; if (!document.fullscreenElement) void root?.requestFullscreen?.(); else void document.exitFullscreen?.() }} />
        <div style={{ width: 1, height: 24, background: '#525252', margin: '0 4px' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, padding: 2, borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
          <ToolButton icon={<IconPointer size={17} />} title="场景编辑" active={editorMode === 'scene'} onClick={() => onEditorModeChange('scene')} />
          <ToolButton icon={<IconClock size={17} />} title="动画时间轴" active={editorMode === 'timeline'} onClick={() => onEditorModeChange('timeline')} />
        </div>
      </div>
    </nav>
  )
}
