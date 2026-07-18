import React from 'react'
import type { DirectorScene, Vec3 } from '../types'
import { Section, SliderField, Vec3Row } from './Field'

type Props = {
  scene: DirectorScene
  panoramaConnected: boolean
  onPatch: (patch: Partial<DirectorScene>) => void
}

const toggleRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '8px 16px', color: '#d4d4d4', fontSize: 13,
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label style={toggleRow}>
      <span>{label}</span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function ScenePropertiesPanel({ scene, panoramaConnected, onPatch }: Props) {
  const position = scene.scenePosition ?? [0, 0, 0]
  const rotation = scene.sceneRotation ?? [0, 0, 0]
  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: '#f5f5f5' }}>3D场景</div>
      <Section title="场景缩放">
        <SliderField value={(scene.sceneScale ?? 3) * 100} min={10} max={500} step={1} onChange={(value) => onPatch({ sceneScale: value / 100 })} />
      </Section>
      <Section title="场景平移"><Vec3Row value={position as Vec3} onChange={(value) => onPatch({ scenePosition: value })} /></Section>
      <Section title="场景旋转"><Vec3Row value={rotation as Vec3} onChange={(value) => onPatch({ sceneRotation: value })} /></Section>
      <Section title="全景背景">
        <div style={{ color: panoramaConnected ? '#d4d4d4' : '#737373', fontSize: 13 }}>{panoramaConnected ? '已连接全景图' : '未连接全景图'}</div>
        <div style={{ marginTop: 5, color: '#737373', fontSize: 11 }}>请将图片节点连接到导演台左侧输入口</div>
      </Section>
      <Section title="天空颜色">
        <input type="color" value={scene.skyColor ?? '#060608'} onChange={(event) => onPatch({ skyColor: event.target.value })}
          style={{ width: 52, height: 30, border: '1px solid #333', borderRadius: 6, background: 'transparent' }} />
      </Section>
      <Section title="全景球">
        <div style={{ color: '#a3a3a3', fontSize: 11, marginBottom: 4 }}>水平旋转</div>
        <SliderField value={scene.skyboxYaw ?? 0} min={0} max={360} step={1} onChange={(value) => onPatch({ skyboxYaw: value })} />
        <div style={{ color: '#a3a3a3', fontSize: 11, margin: '12px 0 4px' }}>球形半径</div>
        <SliderField value={scene.skyRadius ?? 60} min={10} max={200} step={1} onChange={(value) => onPatch({ skyRadius: value })} />
      </Section>
      <Toggle label="角色标签" checked={scene.showCharacterLabels ?? true} onChange={(value) => onPatch({ showCharacterLabels: value })} />
      <Toggle label="网格吸附" checked={scene.gridSnap ?? false} onChange={(value) => onPatch({ gridSnap: value })} />
      <Toggle label="高斯地面吸附" checked={scene.gaussianGroundSnap ?? true} onChange={(value) => onPatch({ gaussianGroundSnap: value })} />
      <Toggle label="地面" checked={scene.groundVisible ?? true} onChange={(value) => onPatch({ groundVisible: value })} />
      <Section title="透明度"><SliderField value={scene.groundOpacity ?? 0.4} min={0} max={1} step={0.01} onChange={(value) => onPatch({ groundOpacity: value })} /></Section>
      <Section title="高度"><SliderField value={scene.groundHeight ?? 0} min={-10} max={10} step={0.1} onChange={(value) => onPatch({ groundHeight: value })} /></Section>
    </div>
  )
}
