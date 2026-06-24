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
          <Button onClick={() => setData((d) => patchCharacter(d, 'c1', { pose: POSE_PRESETS.find((p) => p.id === 'wave')!.pose as any }))}>
            姿势: 招手(c1)
          </Button>
          <Button onClick={() => setData((d) => patchCharacter(d, 'c1', { pose: POSE_PRESETS.find((p) => p.id === 'sit')!.pose as any }))}>
            姿势: 坐姿(c1)
          </Button>
          <Button onClick={() => setData((d) => patchCharacter(d, 'c1', { pose: POSE_PRESETS.find((p) => p.id === 'akimbo')!.pose as any }))}>
            姿势: 叉腰(c1)
          </Button>
          <Button onClick={capture}>截图</Button>
          <div className="text-xs text-slate-400">状态：{log}</div>
          <div className="text-xs text-slate-400">
            机位数 {data.scene.cameras.length} / 角色数 {data.scene.characters.length} / 选中 {data.selectedObjectId || '无'}
          </div>
          {shot ? <img src={shot} alt="shot" className="w-full border border-white/10 rounded" /> : null}
        </div>
      </div>
    </div>
  )
}
