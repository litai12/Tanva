import React from 'react'
import type { SceneTimeline, Shot } from '../state/timeline'
import { timelineDuration } from '../state/timeline'
import { trackId, type PropertyName, type PropertyTimeline } from '../state/propertyTimeline'

type CamOpt = { id: string; name: string; hasPath?: boolean }
type CharTrack = { id: string; name: string; label: string; durationSeconds: number }

export type TimelinePanelProps = {
  timeline: SceneTimeline
  cameras: CamOpt[]
  defaultCameraId?: string
  characters: CharTrack[]
  playhead: number
  playing: boolean
  speed: number
  selectedShotId?: string
  onPlayToggle: () => void
  onReset: () => void
  onSeek: (time: number) => void
  onSpeed: (speed: number) => void
  onAddShot: () => void
  onSelectShot: (id: string | undefined) => void
  onPatchShot: (id: string, patch: Partial<Shot>) => void
  onRemoveShot: (id: string) => void
  onMoveShot: (id: string, toIndex: number) => void
  onCaptureShot?: () => void
  onPatchCharDuration: (id: string, seconds: number) => void
  onRemoveChar: (id: string) => void
  onSelectCharacter: (id: string) => void
  onComposeVideo?: () => void
  busy?: boolean
  thumbs?: Record<string, string[]>
  propertyTimeline: PropertyTimeline
  onSetPropertyKeyframe: (objectKind: 'character' | 'camera', objectId: string, property: PropertyName) => void
  onRemovePropertyKeyframe: (objectId: string, property: PropertyName) => void
  onDurationChange: (duration: number) => void
  autoKeyframe: boolean
  onAutoKeyframeChange: (enabled: boolean) => void
  loop: boolean
  onLoopChange: (enabled: boolean) => void
  canManageSelectedTracks: boolean
  onAddSelectedTracks: () => void
  onRemoveSelectedTracks: () => void
}

const button: React.CSSProperties = { height: 26, minWidth: 28, padding: '0 8px', border: '1px solid #333', borderRadius: 5, background: '#242424', color: '#bfbfbf', fontSize: 11, cursor: 'pointer' }
const TRACK_LABEL = 138
const PX_PER_SEC = 72

/** LibTV property-keyframe timeline shell. Legacy shot data is read only as a main-camera track; no shot editor/video composer is exposed. */
export function TimelinePanel(props: TimelinePanelProps) {
  const total = Math.max(0.01, props.propertyTimeline.duration, timelineDuration(props.timeline), ...props.characters.map((item) => item.durationSeconds))
  const [milliseconds, setMilliseconds] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const contentWidth = Math.max(720, total * PX_PER_SEC * zoom)
  const durationLabel = milliseconds ? `${Math.round(total * 1000)}` : total.toFixed(2)

  const seek = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    props.onSeek(Math.max(0, Math.min(total, ((event.clientX - rect.left) / rect.width) * total)))
  }

  const rows = [
    ...props.characters.map((character) => ({ id: character.id, name: character.name, kind: 'character' as const })),
    { id: props.defaultCameraId ?? props.cameras[0]?.id ?? 'main-camera', name: '主摄像机', kind: 'camera' as const },
  ]

  return <div data-testid="timeline-panel" style={{ height: 250, borderTop: '1px solid #262626', background: '#151515', color: '#d4d4d4', userSelect: 'none' }}>
    <div style={{ height: 42, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', borderBottom: '1px solid #262626' }}>
      <button style={button} aria-label={props.playing ? '暂停' : '播放'} onClick={props.onPlayToggle}>{props.playing ? 'Ⅱ' : '▶'}</button>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}><input type="checkbox" checked={props.autoKeyframe} onChange={(event) => props.onAutoKeyframeChange(event.target.checked)} />自动关键帧</label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}><input type="checkbox" checked={props.loop} onChange={(event) => props.onLoopChange(event.target.checked)} />循环</label>
      <input aria-label="播放头" type="number" value={milliseconds ? Math.round(props.playhead * 1000) : Number(props.playhead.toFixed(2))} min={0} max={milliseconds ? total * 1000 : total} step={milliseconds ? 1 : 0.01} onChange={(event) => props.onSeek(Number(event.target.value) / (milliseconds ? 1000 : 1))} style={{ width: 72, height: 24, border: '1px solid #333', borderRadius: 4, background: '#202020', color: '#d4d4d4', padding: '0 6px', fontSize: 11 }} />
      <span style={{ fontSize: 11, color: '#737373' }}>/</span>
      <input aria-label="总时长" type="number" value={durationLabel} min={0.1} step={milliseconds ? 100 : 0.1} onChange={(event) => props.onDurationChange(Math.max(0.1, Number(event.target.value) / (milliseconds ? 1000 : 1)))} style={{ width: 62, height: 24, border: '1px solid #333', borderRadius: 4, background: '#202020', color: '#d4d4d4', padding: '0 6px', fontSize: 11 }} />
      <button style={button} onClick={() => setMilliseconds((value) => !value)}>{milliseconds ? '毫秒' : '秒'}</button>
      <div style={{ flex: 1 }} />
      <button style={{ ...button, opacity: props.canManageSelectedTracks ? 1 : 0.45 }} disabled={!props.canManageSelectedTracks} title="为当前对象添加属性轨道" onClick={props.onAddSelectedTracks}>＋轨道</button>
      <button style={{ ...button, opacity: props.canManageSelectedTracks ? 1 : 0.45 }} disabled={!props.canManageSelectedTracks} title="删除当前对象的属性轨道" onClick={props.onRemoveSelectedTracks}>－轨道</button>
      <button style={button} title="缩小时间轴" onClick={() => setZoom((value) => Math.max(0.5, value / 1.25))}>－</button>
      <button style={button} title="放大时间轴" onClick={() => setZoom((value) => Math.min(4, value * 1.25))}>＋</button>
      <button style={button} title="最小化">⌄</button>
    </div>
    <div style={{ height: 208, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: TRACK_LABEL, flex: '0 0 auto', borderRight: '1px solid #2a2a2a', overflowY: 'auto' }}>
        <div style={{ height: 24, borderBottom: '1px solid #262626' }} />
        {rows.map((row) => <React.Fragment key={row.id}>
          <button onClick={() => { setExpanded((state) => ({ ...state, [row.id]: !state[row.id] })); if (row.kind === 'character') props.onSelectCharacter(row.id) }} style={{ width: '100%', height: 32, padding: '0 9px', border: 0, borderBottom: '1px solid #242424', background: '#191919', color: '#bfbfbf', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, textAlign: 'left' }}><span>{expanded[row.id] ? '▾' : '▸'}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span></button>
          {expanded[row.id] ? <div style={{ padding: '5px 8px 7px 26px', borderBottom: '1px solid #242424', background: '#171717', color: '#737373', fontSize: 10, lineHeight: 1.8 }}>
            {(row.kind === 'character' ? [['位置', 'position'], ['旋转', 'rotation'], ['缩放', 'scale'], ['统一缩放', 'uniformScale'], ['姿势', 'pose']] : [['位置', 'position'], ['旋转', 'rotation'], ['视场角', 'fovDeg'], ['注视点', 'lookAt']]).map(([label, property]) => {
              const prop = property as PropertyName
              const track = props.propertyTimeline.tracks.find((item) => item.id === trackId(row.id, prop))
              const keyedNow = !!track?.keyframes.some((item) => Math.abs(item.time - props.playhead) <= 0.02)
              return <div key={prop} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 21 }}><span>{label}</span><button aria-label={`${row.name}-${label}-关键帧`} title={keyedNow ? '删除当前关键帧' : '在当前时间添加关键帧'} onClick={() => keyedNow ? props.onRemovePropertyKeyframe(row.id, prop) : props.onSetPropertyKeyframe(row.kind, row.id, prop)} style={{ width: 20, height: 18, padding: 0, border: 0, background: 'transparent', color: keyedNow ? '#f59e0b' : '#737373', cursor: 'pointer' }}>{keyedNow ? '◆' : '◇'}</button></div>
            })}
            {row.kind === 'character' ? <button style={{ ...button, height: 22, marginTop: 3 }}>绘制轨迹</button> : null}
          </div> : null}
        </React.Fragment>)}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ width: contentWidth, minHeight: '100%', position: 'relative' }}>
          <div style={{ height: 24, display: 'flex', borderBottom: '1px solid #262626', color: '#737373', fontSize: 9 }}>
            {Array.from({ length: Math.floor(total) + 1 }, (_, second) => <div key={second} style={{ position: 'absolute', left: second / total * contentWidth, top: 3, borderLeft: '1px solid #3a3a3a', height: 21, paddingLeft: 3 }}>{second}</div>)}
          </div>
          <div onPointerDown={seek} style={{ position: 'absolute', inset: '24px 0 0', cursor: 'crosshair', backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, #242424 32px)' }} />
          {rows.map((row, index) => <div key={row.id} style={{ position: 'absolute', top: 24 + index * 32, left: 0, width: contentWidth, height: 32, pointerEvents: 'none' }}>
            {props.propertyTimeline.tracks.filter((track) => track.objectId === row.id).flatMap((track) => track.keyframes).map((keyframe, keyIndex) => <span key={`${keyframe.time}-${keyIndex}`} style={{ position: 'absolute', left: keyframe.time / total * contentWidth, top: 11, width: 7, height: 7, transform: 'rotate(45deg)', background: row.kind === 'camera' ? '#60a5fa' : '#f59e0b' }} />)}
          </div>)}
          <div style={{ position: 'absolute', top: 24, bottom: 0, left: props.playhead / total * contentWidth, width: 1, background: '#ef4444', pointerEvents: 'none' }}><div style={{ width: 7, height: 7, marginLeft: -3, background: '#ef4444', transform: 'rotate(45deg)' }} /></div>
        </div>
      </div>
    </div>
  </div>
}
