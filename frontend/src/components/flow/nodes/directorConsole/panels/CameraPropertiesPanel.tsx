import React from 'react'
import type { CameraObj, DirectorScene, CameraShot } from '../types'
import { Section, TextField, Vec3Row, SliderField } from './Field'

export type ShotGroup = { cameraId: string; cameraName: string; shots: CameraShot[] }

type Props = {
  camera: CameraObj
  scene: DirectorScene
  tab: 'props' | 'shots'
  onTab: (t: 'props' | 'shots') => void
  shotGroups: ShotGroup[]
  busy: boolean
  onPatch: (patch: Partial<CameraObj>) => void
  onSwitchCamera: (id: string) => void
  onClearAll: () => void
  onSendAll: () => void
  onSendShot: (cameraId: string, shotId: string) => void
  onDeleteShot: (cameraId: string, shotId: string) => void
}

const selectStyle: React.CSSProperties = {
  width: '100%', background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 6,
  color: '#e5e7eb', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box',
}

export function CameraPropertiesPanel({ camera, scene, tab, onTab, shotGroups, busy, onPatch, onSwitchCamera, onClearAll, onSendAll, onSendShot, onDeleteShot }: Props) {
  const total = shotGroups.reduce((n, g) => n + g.shots.length, 0)
  const activeCameraId = scene.activeCameraId ?? camera.id
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600 }}>摄像机</div>
      <div style={{ display: 'flex', gap: 16, padding: '0 16px 8px', borderBottom: '1px solid #16181d' }}>
        {(['props', 'shots'] as const).map((t) => (
          <button key={t} onClick={() => onTab(t)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, paddingBottom: 8, color: tab === t ? '#fff' : '#6b7280', borderBottom: tab === t ? '2px solid #fff' : '2px solid transparent' }}>
            {t === 'props' ? '属性' : `摄像机截图${total ? ` (${total})` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'props' ? (
        <div style={{ overflowY: 'auto' }}>
          <Section title="名称"><TextField value={camera.name} onChange={(v) => onPatch({ name: v })} /></Section>
          <Section title="切换机位">
            <select style={selectStyle} value={activeCameraId} onChange={(e) => onSwitchCamera(e.target.value)}>
              {scene.cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Section>
          {activeCameraId !== camera.id ? (
            <div style={{ padding: '0 16px 8px', fontSize: 12, color: '#fbbf24' }}>
              当前编辑的是 {camera.name}，预览显示的是 {scene.cameras.find((c) => c.id === activeCameraId)?.name ?? '当前机位'}。
            </div>
          ) : null}
          <Section title="位置"><Vec3Row value={camera.position} onChange={(v) => onPatch({ position: v })} /></Section>
          <Section title="注视目标">
            <select style={selectStyle} value={camera.lookAtMode} onChange={(e) => onPatch({ lookAtMode: e.target.value })}>
              <option value="manual">手动坐标</option>
              {scene.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Section>
          {camera.lookAtMode === 'manual' ? (
            <Section title="注视坐标"><Vec3Row value={camera.lookAt} onChange={(v) => onPatch({ lookAt: v })} /></Section>
          ) : null}
          <Section title="视野角度 (FOV)">
            <SliderField value={camera.fovDeg} min={10} max={120} step={1} onChange={(v) => onPatch({ fovDeg: v })} />
          </Section>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            {total === 0 ? (
              <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 40 }}>暂无摄像机截图</div>
            ) : (
              shotGroups.map((g) => (
                <div key={g.cameraId} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: '#8b93a1', marginBottom: 6 }}>{g.cameraName}截图</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {g.shots.map((s) => (
                      <div key={s.id}>
                        <div style={{ position: 'relative', aspectRatio: '16/9', borderRadius: 6, overflow: 'hidden', background: '#000' }}>
                          <img src={s.imageUrl} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4 }}>
                            <button title="发送到画布" disabled={busy} onClick={() => onSendShot(g.cameraId, s.id)}
                              style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'rgba(255,255,255,0.92)', color: '#111', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>↗</button>
                            <button title="删除" disabled={busy} onClick={() => onDeleteShot(g.cameraId, s.id)}
                              style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#f1a1a1', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>✕</button>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#8b93a1', marginTop: 4 }}>{s.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, padding: 16, borderTop: '1px solid #16181d' }}>
            <button onClick={onClearAll} disabled={busy || total === 0}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: '#1c1f26', color: '#9ca3af', border: '1px solid #2a2f3a', cursor: 'pointer' }}>全部清空</button>
            <button onClick={onSendAll} disabled={busy || total === 0}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: '#fff', color: '#111', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{busy ? '发送中…' : '发送到画布'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
