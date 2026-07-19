import React from 'react'
import type { CameraObj, CameraShot, DirectorScene } from '../types'
import { KeyframeButton, Section, SliderField, TextField, Vec3Row } from './Field'
import type { PropertyName } from '../state/propertyTimeline'

export type LibTvShotGroup = { cameraId: string; cameraName: string; shots: CameraShot[] }

type Props = {
  camera: CameraObj
  scene: DirectorScene
  tab: 'props' | 'shots'
  shotGroups: LibTvShotGroup[]
  busy: boolean
  onTab: (tab: 'props' | 'shots') => void
  onPatch: (patch: Partial<CameraObj>) => void
  onSwitchCamera: (id: string) => void
  onUseCameraView: () => void
  onClearAll: () => void
  onSendAll: () => void
  onSendShot: (cameraId: string, shotId: string) => void
  onDeleteShot: (cameraId: string, shotId: string) => void
  timelineKeyframes?: {
    isKeyed: (property: PropertyName, component?: 0 | 1 | 2) => boolean
    toggle: (property: PropertyName, component?: 0 | 1 | 2) => void
  }
}

const selectStyle: React.CSSProperties = {
  width: '100%', background: '#202020', border: '1px solid #343434', borderRadius: 7,
  color: '#ededed', padding: '7px 8px', fontSize: 13, boxSizing: 'border-box',
}

export function LibTvCameraPropertiesPanel(props: Props) {
  const { camera, scene, tab, shotGroups, busy } = props
  const [fullscreenShot, setFullscreenShot] = React.useState<CameraShot | null>(null)
  const total = shotGroups.reduce((count, group) => count + group.shots.length, 0)
  const rotation = camera.rotation ?? [5.71, 180, 0]
  React.useEffect(() => {
    if (!fullscreenShot) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreenShot(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [fullscreenShot])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600 }}>摄像机</div>
      <div style={{ display: 'flex', gap: 18, padding: '0 16px 8px', borderBottom: '1px solid #242424' }}>
        <button onClick={() => props.onTab('props')} style={tabButton(tab === 'props')}>属性</button>
        <button onClick={() => props.onTab('shots')} style={tabButton(tab === 'shots')}>摄像机截图</button>
      </div>
      {tab === 'props' ? (
        <div style={{ overflowY: 'auto' }}>
          <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#a3a3a3' }}>FOV <b style={{ color: '#f5f5f5' }}>{Math.round(camera.fovDeg)}°</b></span>
            <button onClick={props.onUseCameraView} style={{ border: '1px solid #363636', borderRadius: 7, background: '#232323', color: '#ddd', padding: '5px 9px', fontSize: 11, cursor: 'pointer' }}>切换到机位视角</button>
          </div>
          <Section title="名称"><TextField value={camera.name} onChange={(name) => props.onPatch({ name })} /></Section>
          <Section title="切换机位">
            <select value={scene.activeCameraId ?? camera.id} onChange={(event) => props.onSwitchCamera(event.target.value)} style={selectStyle}>
              {scene.cameras.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Section>
          <Section title="位置"><Vec3Row value={camera.position} renderAxisAction={props.timelineKeyframes ? (component) => <KeyframeButton keyed={props.timelineKeyframes!.isKeyed('position', component)} onClick={() => props.timelineKeyframes!.toggle('position', component)} /> : undefined} onChange={(position) => {
            const target = scene.characters.find((item) => item.id === camera.followTargetId)
            props.onPatch({
              position,
              followOffset: target ? [position[0] - target.position[0], position[1] - target.position[1], position[2] - target.position[2]] : camera.followOffset,
            })
          }} /></Section>
          <Section title="跟随目标">
            <select value={camera.followTargetId ?? ''} onChange={(event) => {
              const followTargetId = event.target.value || undefined
              const target = scene.characters.find((item) => item.id === followTargetId)
              props.onPatch({
                followTargetId,
                followOffset: target ? [camera.position[0] - target.position[0], camera.position[1] - target.position[1], camera.position[2] - target.position[2]] : undefined,
              })
            }} style={selectStyle}>
              <option value="">不跟随</option>
              {scene.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Section>
          <Section title="旋转"><Vec3Row value={rotation} onChange={(value) => props.onPatch({ rotation: value })} renderAxisAction={props.timelineKeyframes ? (component) => <KeyframeButton keyed={props.timelineKeyframes!.isKeyed('rotation', component)} onClick={() => props.timelineKeyframes!.toggle('rotation', component)} /> : undefined} /></Section>
          <Section title="注视目标">
            <select value={camera.lookAtMode} onChange={(event) => props.onPatch({ lookAtMode: event.target.value })} style={selectStyle}>
              <option value="manual">手动坐标</option>
              <option value="rotation">手动旋转</option>
              {scene.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Section>
          {camera.lookAtMode === 'manual' ? <Section title="注视坐标"><Vec3Row value={camera.lookAt} onChange={(lookAt) => props.onPatch({ lookAt })} renderAxisAction={props.timelineKeyframes ? (component) => <KeyframeButton keyed={props.timelineKeyframes!.isKeyed('lookAt', component)} onClick={() => props.timelineKeyframes!.toggle('lookAt', component)} /> : undefined} /></Section> : null}
          <Section title="视野角度 (FOV)">
            <span title="视野角度说明" aria-label="视野角度说明" style={{ float: 'right', marginTop: -25, color: '#777', cursor: 'help' }}>?</span>
            <div style={{ color: '#858585', fontSize: 11, lineHeight: 1.5, marginBottom: 6 }}>控制镜头视野范围。数值越小，画面越近、越聚焦；数值越大，画面越广、能看到更多环境。</div>
            <SliderField value={camera.fovDeg} min={10} max={120} step={0.1} displayDigits={1} onChange={(fovDeg) => props.onPatch({ fovDeg })} action={props.timelineKeyframes ? <KeyframeButton keyed={props.timelineKeyframes.isKeyed('fovDeg')} onClick={() => props.timelineKeyframes!.toggle('fovDeg')} /> : undefined} />
          </Section>
          <div style={{ padding: '0 16px 16px', color: '#8a8a8a', fontSize: 12 }}>相机截图</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {total === 0 ? <div style={{ color: '#737373', fontSize: 13, textAlign: 'center', marginTop: 36 }}>暂无摄像机截图</div> : shotGroups.map((group) => (
              <div key={group.cameraId} style={{ marginBottom: 16 }}>
                <div style={{ color: '#a3a3a3', fontSize: 12, marginBottom: 7 }}>{group.cameraName}截图</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {group.shots.map((shot) => (
                    <div key={shot.id}>
                      <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden', borderRadius: 7, background: '#000' }}>
                        <img src={shot.imageUrl} alt={shot.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 4, padding: 4 }}>
                          <button aria-label={`删除${shot.name}`} onClick={() => props.onDeleteShot(group.cameraId, shot.id)} style={shotAction}>×</button>
                          <button aria-label={`发送${shot.name}到画布`} onClick={() => props.onSendShot(group.cameraId, shot.id)} style={shotAction}>↗</button>
                          <button aria-label={`全屏查看${shot.name}`} onClick={() => setFullscreenShot(shot)} style={shotAction}>⛶</button>
                        </div>
                      </div>
                      <div style={{ color: '#a3a3a3', fontSize: 11, marginTop: 4 }}>{shot.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, padding: 16, borderTop: '1px solid #242424' }}>
            <button disabled={busy || total === 0} onClick={props.onClearAll} style={footerButton(false)}>全部清空</button>
            <button disabled={busy || total === 0} onClick={props.onSendAll} style={footerButton(true)}>{busy ? '发送中…' : '发送到画布'}</button>
          </div>
        </div>
      )}
      {fullscreenShot ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`全屏查看${fullscreenShot.name}`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setFullscreenShot(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 4300, display: 'grid', placeItems: 'center', padding: 40, background: 'rgba(0,0,0,.88)', backdropFilter: 'blur(8px)' }}
        >
          <button type="button" aria-label="关闭全屏截图" onClick={() => setFullscreenShot(null)} style={{ position: 'absolute', top: 18, right: 22, width: 36, height: 36, border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, background: 'rgba(18,18,18,.76)', color: '#fff', fontSize: 24, cursor: 'pointer' }}>×</button>
          <figure style={{ margin: 0, maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <img src={fullscreenShot.imageUrl} alt={fullscreenShot.name} style={{ display: 'block', maxWidth: 'calc(100vw - 80px)', maxHeight: 'calc(100vh - 110px)', objectFit: 'contain', boxShadow: '0 16px 60px rgba(0,0,0,.55)' }} />
            <figcaption style={{ color: '#d4d4d4', fontSize: 13 }}>{fullscreenShot.name}</figcaption>
          </figure>
        </div>
      ) : null}
    </div>
  )
}

const tabButton = (active: boolean): React.CSSProperties => ({
  border: 'none', borderBottom: active ? '2px solid #f5f5f5' : '2px solid transparent',
  background: 'transparent', color: active ? '#f5f5f5' : '#737373', cursor: 'pointer', padding: '0 0 8px', fontSize: 13,
})
const shotAction: React.CSSProperties = { width: 22, height: 22, padding: 0, border: '1px solid rgba(255,255,255,.16)', borderRadius: 5, background: 'rgba(20,20,20,.72)', color: '#fff', cursor: 'pointer' }
const footerButton = (primary: boolean): React.CSSProperties => ({ flex: 1, height: 34, borderRadius: 8, border: primary ? 'none' : '1px solid #383838', background: primary ? '#f5f5f5' : '#242424', color: primary ? '#111' : '#ddd', cursor: 'pointer', fontSize: 13 })
