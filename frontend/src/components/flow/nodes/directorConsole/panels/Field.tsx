import React from 'react'
import type { Vec3 } from '../types'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #16181d' }}>
      <div style={{ fontSize: 12, color: '#8b93a1', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 6,
  color: '#e5e7eb', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box',
}

export function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} />
}

export function NumberField({ value, onChange, step = 0.1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      step={step}
      style={{ ...inputStyle, width: 0, minWidth: 0, flex: 1 }}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => { const v = parseFloat(e.target.value); onChange(Number.isFinite(v) ? v : 0) }}
    />
  )
}

const AXIS = ['x', 'y', 'z'] as const

export function Vec3Row({ value, onChange, renderAxisAction }: { value: Vec3; onChange: (v: Vec3) => void; renderAxisAction?: (index: 0 | 1 | 2) => React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {AXIS.map((ax, i) => (
        <div key={ax} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
          <AxisDragButton axis={ax} value={value[i]} onChange={(nextValue) => { const next = [...value] as Vec3; next[i] = nextValue; onChange(next) }} />
          <NumberField value={value[i]} onChange={(v) => { const next = [...value] as Vec3; next[i] = v; onChange(next) }} />
          {renderAxisAction?.(i as 0 | 1 | 2)}
        </div>
      ))}
    </div>
  )
}

function AxisDragButton({ axis, value, onChange }: { axis: typeof AXIS[number]; value: number; onChange: (value: number) => void }) {
  const drag = React.useRef<{ x: number; value: number } | null>(null)
  return <button
    type="button"
    aria-label={`左右拖动调整 ${axis.toUpperCase()} 轴`}
    onPointerDown={(event) => { drag.current = { x: event.clientX, value }; event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={(event) => {
      if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      onChange(Math.round((drag.current.value + (event.clientX - drag.current.x) * 0.02) * 1000) / 1000)
    }}
    onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) }}
    style={{ width: 16, flex: '0 0 16px', border: 0, padding: 0, background: 'transparent', color: '#6b7280', fontSize: 11, textTransform: 'uppercase', cursor: 'ew-resize' }}
  >{axis}</button>
}

function FormattedNumberInput({ value, min, max, step, digits, suffix, inputLabel, onChange }: { value: number; min: number; max: number; step: number; digits?: number; suffix?: string; inputLabel?: string; onChange: (value: number) => void }) {
  const format = React.useCallback((number: number) => `${digits == null ? number : number.toFixed(digits)}${suffix ?? ''}`, [digits, suffix])
  const [draft, setDraft] = React.useState(() => format(value))
  React.useEffect(() => setDraft(format(value)), [format, value])
  const commit = () => {
    const parsed = Number.parseFloat(draft.replace(suffix ?? '', '').trim())
    if (!Number.isFinite(parsed)) { setDraft(format(value)); return }
    const clamped = Math.min(max, Math.max(min, parsed))
    const snapped = Math.round(clamped / step) * step
    onChange(snapped)
    setDraft(format(snapped))
  }
  return <input
    type="text"
    inputMode="decimal"
    aria-label={inputLabel}
    value={draft}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === 'Enter') { commit(); event.currentTarget.blur() } else if (event.key === 'Escape') { setDraft(format(value)); event.currentTarget.blur() } }}
    style={{ ...inputStyle, width: 56, flex: 'none' }}
  />
}

export function SliderField({ value, min, max, step, onChange, displayDigits, suffix, inputLabel, action }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; displayDigits?: number; suffix?: string; inputLabel?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
      <FormattedNumberInput value={value} min={min} max={max} step={step} digits={displayDigits} suffix={suffix} inputLabel={inputLabel} onChange={onChange} />
      {action}
    </div>
  )
}

export function HexColorField({ value, onChange, label = '颜色' }: { value: string; onChange: (value: string) => void; label?: string }) {
  const normalized = value.replace(/^#/, '').toUpperCase().slice(0, 6)
  const [draft, setDraft] = React.useState(normalized)
  React.useEffect(() => setDraft(normalized), [normalized])
  const commit = () => {
    const next = draft.replace(/[^0-9a-f]/gi, '').slice(0, 6)
    if (next.length === 6) onChange(`#${next}`)
    else setDraft(normalized)
  }
  return <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
    <span style={{ color: '#8a8a8a', fontSize: 13 }}>#</span>
    <input type="text" aria-label={label} value={draft} maxLength={6}
      onChange={(event) => setDraft(event.target.value.toUpperCase())} onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') { commit(); event.currentTarget.blur() } }}
      style={{ width: 82, height: 30, boxSizing: 'border-box', border: '1px solid #333', borderRadius: 6, background: '#202020', color: '#ddd', padding: '0 8px', fontSize: 13 }} />
  </div>
}

export function KeyframeButton({ keyed, onClick }: { keyed: boolean; onClick: () => void }) {
  return <button type="button" aria-label={keyed ? '当前帧有关键帧' : '当前帧无关键帧'} title={keyed ? '删除当前关键帧' : '在当前帧添加关键帧'} onClick={onClick}
    style={{ width: 17, height: 20, flex: '0 0 17px', padding: 0, border: 0, background: 'transparent', color: keyed ? '#f59e0b' : '#666', cursor: 'pointer', fontSize: 11 }}>{keyed ? '◆' : '◇'}</button>
}
