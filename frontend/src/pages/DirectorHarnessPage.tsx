import React from 'react'
import { Viewport, type ViewportHandle } from '@/components/flow/nodes/directorConsole/scene/Viewport'
import type { DirectorConsoleData } from '@/components/flow/nodes/directorConsole/types'
import { addCharacter, addCamera, setViewpoint, patchCharacter } from '@/components/flow/nodes/directorConsole/state/scene'
import { POSE_PRESETS } from '@/components/flow/nodes/directorConsole/state/pose'
import { createDefaultDirectorConsoleData } from '@/components/flow/nodes/directorConsole/types'
import { Button } from '@/components/ui/button'

function initial(): DirectorConsoleData {
  let d = createDefaultDirectorConsoleData()
  d = addCharacter(d, { id: 'c1', modelId: 'male' })
  d = addCamera(d, { id: 'k1' })
  return d
}

export default function DirectorHarnessPage() {
  const [data, setData] = React.useState<DirectorConsoleData>(initial)
  const ref = React.useRef<ViewportHandle | null>(null)
  const [shot, setShot] = React.useState<string>('')
  const [log, setLog] = React.useState<string>('ready')
  const selectedCharacterId = React.useMemo(() => {
    const selected = data.scene.characters.find((c) => c.id === data.selectedObjectId)
    return selected?.id ?? data.scene.characters[0]?.id ?? null
  }, [data])

  const applyPoseToSelected = React.useCallback((presetId: string) => {
    const pose = POSE_PRESETS.find((p) => p.id === presetId)?.pose
    if (!pose || !selectedCharacterId) {
      setLog('未选中角色，无法应用姿势')
      return
    }
    setData((d) => patchCharacter(d, selectedCharacterId, { pose: pose as any }))
    setLog(`applied ${presetId} to ${selectedCharacterId}`)
  }, [selectedCharacterId])

  const capture = () => {
    try {
      const dataUrl = ref.current?.captureView()
      if (!dataUrl) {
        setLog('capture returned NULL')
        return
      }
      setShot(dataUrl)
      setLog(`capture ok: ${Math.round(dataUrl.length / 1024)}KB dataURL`)
    } catch (e: any) {
      setLog('capture ERROR: ' + (e?.message || String(e)))
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-white">
      <div className="flex h-screen">
        <div className="flex-1 relative">
          <Viewport
            ref={ref}
            scene={data.scene}
            viewpoint={data.activeViewpoint}
            selectedId={data.selectedObjectId}
            onSelect={(id) => setData((d) => ({ ...d, selectedObjectId: id }))}
            onPatchCharacter={() => {}}
            onPatchCamera={() => {}}
          />
        </div>
        <div className="w-[320px] border-l border-white/10 p-4 flex flex-col gap-3 bg-[#111317] overflow-y-auto">
          <div className="text-lg font-semibold">Director Harness</div>
          <Button onClick={() => setData((d) => setViewpoint(d, d.activeViewpoint === 'director' ? 'camera' : 'director'))}>
            切视角（当前：{data.activeViewpoint}）
          </Button>
          <Button onClick={() => setData((d) => addCamera(d, { id: 'k' + (d.scene.cameras.length + 1) }))}>
            加机位
          </Button>
          <Button onClick={() => setData((d) => addCharacter(d, { id: 'c' + (d.scene.characters.length + 1), modelId: 'female' }))}>
            加女性
          </Button>
          <Button onClick={() => applyPoseToSelected('wave')}>
            姿势: 招手(当前选中)
          </Button>
          <Button onClick={() => applyPoseToSelected('sit')}>
            姿势: 坐姿(当前选中)
          </Button>
          <Button onClick={() => applyPoseToSelected('akimbo')}>
            姿势: 叉腰(当前选中)
          </Button>
          <Button onClick={capture}>截图</Button>
          <div className="text-xs text-slate-400">状态：{log}</div>
          <div className="text-xs text-slate-400">
            机位数 {data.scene.cameras.length} / 角色数 {data.scene.characters.length} / 选中 {data.selectedObjectId || '无'}
          </div>
          <div className="text-xs text-slate-400">
            当前姿势目标：{selectedCharacterId || '无'}
          </div>
          {shot ? <img src={shot} alt="shot" className="w-full border border-white/10 rounded" /> : null}
        </div>
      </div>
    </div>
  )
}
