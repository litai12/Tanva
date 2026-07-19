import React from 'react'
import { type PropertyName, type PropertyTimeline } from '../state/propertyTimeline'

type ObjectOption = { id: string; name: string }

export type TimelinePanelProps = {
  cameras: ObjectOption[]
  defaultCameraId?: string
  characters: ObjectOption[]
  playhead: number
  playing: boolean
  onPlayToggle: () => void
  onSeek: (time: number) => void
  onSelectCharacter: (id: string) => void
  propertyTimeline: PropertyTimeline
  onSetPropertyKeyframe: (objectKind: 'character' | 'camera', objectId: string, property: PropertyName) => void
  onRemovePropertyKeyframe: (objectId: string, property: PropertyName) => void
  onDurationChange: (duration: number) => void
  autoKeyframe: boolean
  onAutoKeyframeChange: (enabled: boolean) => void
  loop: boolean
  onLoopChange: (enabled: boolean) => void
  canManageSelectedTracks: boolean
  selectedTracksExist: boolean
  onAddSelectedTracks: () => void
  onRemoveSelectedTracks: () => void
  onDrawTrajectory: (objectKind: 'character' | 'camera', objectId: string) => void
  activeTrajectoryId?: string
}

const button: React.CSSProperties = { height: 26, minWidth: 28, padding: '0 8px', border: '1px solid #333', borderRadius: 5, background: '#242424', color: '#bfbfbf', fontSize: 11, cursor: 'pointer' }
const TRACK_LABEL = 220
const PX_PER_SEC = 72

/** LibTV property-keyframe timeline shell. Legacy shot data is read only as a main-camera track; no shot editor/video composer is exposed. */
export function TimelinePanel(props: TimelinePanelProps) {
  const total = Math.max(0.01, props.propertyTimeline.duration)
  const [milliseconds, setMilliseconds] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [minimized, setMinimized] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [playheadDraft, setPlayheadDraft] = React.useState<string | null>(null)
  const [durationDraft, setDurationDraft] = React.useState<string | null>(null)
  const contentWidth = Math.max(720, total * PX_PER_SEC * zoom)
  const durationLabel = milliseconds ? `${Math.round(total * 1000)}` : total.toFixed(2)
  const playheadLabel = milliseconds ? `${Math.round(props.playhead * 1000)}` : props.playhead.toFixed(2)

  const commitPlayhead = () => {
    if (playheadDraft == null) return
    const value = Number(playheadDraft)
    if (Number.isFinite(value)) props.onSeek(Math.max(0, Math.min(total, value / (milliseconds ? 1000 : 1))))
    setPlayheadDraft(null)
  }
  const commitDuration = () => {
    if (durationDraft == null) return
    const value = Number(durationDraft)
    if (Number.isFinite(value)) props.onDurationChange(Math.max(0.1, value / (milliseconds ? 1000 : 1)))
    setDurationDraft(null)
  }

  const seek = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    props.onSeek(Math.max(0, Math.min(total, ((event.clientX - rect.left) / rect.width) * total)))
  }

  const rows = [
    ...props.characters.filter((character) => props.propertyTimeline.tracks.some((track) => track.objectId === character.id)).map((character) => ({ id: character.id, name: character.name, kind: 'character' as const })),
    { id: props.defaultCameraId ?? props.cameras[0]?.id ?? 'main-camera', name: '主机位', kind: 'camera' as const },
  ]

  return <div data-testid="timeline-panel" data-minimized={minimized ? 'true' : 'false'} style={{ position: 'relative', height: minimized ? 42 : 250, borderTop: '1px solid #262626', background: '#151515', color: '#d4d4d4', userSelect: 'none' }}>
    <div style={{ height: 42, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', borderBottom: '1px solid #262626' }}>
      <button style={button} aria-label={props.playing ? '暂停' : '播放'} onClick={props.onPlayToggle}>{props.playing ? 'Ⅱ' : '▶'}</button>
      <button
        style={{ ...button, background: props.autoKeyframe ? '#7f1d1d' : '#242424', borderColor: props.autoKeyframe ? '#ef4444' : '#333', color: props.autoKeyframe ? '#fff' : '#bfbfbf' }}
        aria-pressed={props.autoKeyframe}
        title={props.autoKeyframe ? '自动帧已开启：修改属性会在当前播放头自动打帧' : '开启后，修改角色或机位属性会在当前播放头自动打帧'}
        onClick={() => props.onAutoKeyframeChange(!props.autoKeyframe)}
      >{props.autoKeyframe ? '● 自动帧' : '自动帧'}</button>
      <button style={{ ...button, background: props.loop ? '#343434' : '#242424', color: props.loop ? '#fff' : '#bfbfbf' }} aria-pressed={props.loop} onClick={() => props.onLoopChange(!props.loop)}>循环播放</button>
      <input aria-label="播放头位置" type="text" inputMode="decimal" value={playheadDraft ?? playheadLabel} onFocus={() => setPlayheadDraft(playheadLabel)} onChange={(event) => setPlayheadDraft(event.target.value)} onBlur={commitPlayhead} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); setPlayheadDraft(null) } }} style={{ width: 72, height: 24, border: '1px solid #333', borderRadius: 4, background: '#202020', color: '#d4d4d4', padding: '0 6px', fontSize: 11 }} />
      <span style={{ fontSize: 11, color: '#737373' }}>/</span>
      <input aria-label="总时长" type="text" inputMode="decimal" value={durationDraft ?? durationLabel} onFocus={() => setDurationDraft(durationLabel)} onChange={(event) => setDurationDraft(event.target.value)} onBlur={commitDuration} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); setDurationDraft(null) } }} style={{ width: 62, height: 24, border: '1px solid #333', borderRadius: 4, background: '#202020', color: '#d4d4d4', padding: '0 6px', fontSize: 11 }} />
      <button style={button} aria-label={`切换时间单位为 ${milliseconds ? 's' : 'ms'}`} onClick={() => { commitPlayhead(); commitDuration(); setMilliseconds((value) => !value) }}>{milliseconds ? 'ms' : 's'}</button>
      <div style={{ flex: 1 }} />
      <button style={{ ...button, opacity: props.canManageSelectedTracks ? 1 : 0.45 }} disabled={!props.canManageSelectedTracks} title={props.selectedTracksExist ? '解除当前选中元素的动画轨道' : '选中角色、道具或分组后建立轨道'} onClick={props.selectedTracksExist ? props.onRemoveSelectedTracks : props.onAddSelectedTracks}>{props.selectedTracksExist ? '移除轨道' : '新建轨道'}</button>
      <input aria-label="时间轴缩放" type="range" min={0.5} max={4} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} style={{ width: 90 }} />
      <button style={button} aria-label={minimized ? '展开时间线' : '时间线最小化'} title={minimized ? '展开时间线' : '时间线最小化'} onClick={() => setMinimized((value) => !value)}>{minimized ? '⌃' : '⌄'}</button>
    </div>
    {!minimized ? <div style={{ height: 208, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: TRACK_LABEL, flex: '0 0 auto', borderRight: '1px solid #2a2a2a', overflowY: 'auto' }}>
        <div style={{ height: 24, borderBottom: '1px solid #262626' }} />
        {rows.map((row) => <React.Fragment key={row.id}>
          <div style={{ width: '100%', height: 32, padding: '0 7px', boxSizing: 'border-box', borderBottom: '1px solid #242424', background: '#191919', color: '#bfbfbf', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <button aria-label="展开属性" onClick={() => { setExpanded((state) => ({ ...state, [row.id]: !state[row.id] })); if (row.kind === 'character') props.onSelectCharacter(row.id) }} style={{ width: 18, padding: 0, border: 0, background: 'transparent', color: '#8a8a8a', cursor: 'pointer' }}>{expanded[row.id] ? '▾' : '▸'}</button>
            <button onClick={() => { if (row.kind === 'character') props.onSelectCharacter(row.id) }} style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', padding: 0, border: 0, background: 'transparent', color: '#bfbfbf', cursor: row.kind === 'character' ? 'pointer' : 'default', fontSize: 11 }}>{row.name}</button>
            <button aria-pressed={props.activeTrajectoryId === row.id} onClick={() => props.onDrawTrajectory(row.kind, row.id)} style={{ ...button, height: 22, minWidth: 58, padding: '0 5px', color: props.activeTrajectoryId === row.id ? '#22d3ee' : button.color, borderColor: props.activeTrajectoryId === row.id ? '#22d3ee' : '#333' }}>{props.activeTrajectoryId === row.id ? '结束绘制' : '绘制轨迹'}</button>
          </div>
          {expanded[row.id] ? <div style={{ padding: '5px 8px 7px 26px', borderBottom: '1px solid #242424', background: '#171717', color: '#737373', fontSize: 10, lineHeight: 1.8 }}>
            {(row.kind === 'character' ? [['位置', 'position'], ['旋转', 'rotation'], ['缩放', 'scale'], ['统一缩放', 'uniformScale'], ['姿势', 'pose']] : [['位置', 'position'], ['旋转', 'rotation'], ['视场角', 'fovDeg'], ['注视点', 'lookAt']]).map(([label, property]) => {
              const prop = property as PropertyName
              const propertyTracks = props.propertyTimeline.tracks.filter((item) => item.objectId === row.id && item.property === prop)
              const keyedNow = propertyTracks.some((track) => track.keyframes.some((item) => Math.abs(item.time - props.playhead) <= 0.02))
              return <div key={prop} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 21 }}><span>{label}</span><button aria-label={`${row.name}-${label}-关键帧`} title={keyedNow ? '删除当前关键帧' : '在当前时间添加关键帧'} onClick={() => keyedNow ? props.onRemovePropertyKeyframe(row.id, prop) : props.onSetPropertyKeyframe(row.kind, row.id, prop)} style={{ width: 20, height: 18, padding: 0, border: 0, background: 'transparent', color: keyedNow ? '#f59e0b' : '#737373', cursor: 'pointer' }}>{keyedNow ? '◆' : '◇'}</button></div>
            })}
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
      {rows.length === 1 ? <div style={{ position: 'absolute', left: TRACK_LABEL + 20, top: 84, color: '#737373', fontSize: 11 }}>请选择一个角色或者摄像机后，可新建轨道</div> : null}
    </div> : null}
  </div>
}
