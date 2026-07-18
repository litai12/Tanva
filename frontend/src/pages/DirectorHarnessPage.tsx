import React from 'react'
import { Viewport, type ViewportHandle } from '@/components/flow/nodes/directorConsole/scene/Viewport'
import type { DirectorConsoleData } from '@/components/flow/nodes/directorConsole/types'
import { addCharacter, addCamera, setViewpoint, patchCharacter } from '@/components/flow/nodes/directorConsole/state/scene'
import { POSE_PRESETS } from '@/components/flow/nodes/directorConsole/state/pose'
import { createDefaultDirectorConsoleData } from '@/components/flow/nodes/directorConsole/types'
import { Button } from '@/components/ui/button'
import { samplePropertyTimeline, setKeyframe } from '@/components/flow/nodes/directorConsole/state/propertyTimeline'
import { dataUrlToBlob, uploadCanvasImageBlob } from '@/components/flow/nodes/directorConsole/uploadCanvasImageBlob'
import { AiSceneImportDialog } from '@/components/flow/nodes/directorConsole/panels/AiSceneImportDialog'

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
  const [hostedShot, setHostedShot] = React.useState<string>('')
  const [aiImportOpen, setAiImportOpen] = React.useState(false)
  const [log, setLog] = React.useState<string>('ready')
  const [timelineTime, setTimelineTime] = React.useState(0)
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
  const uploadShot = async () => {
    if (!shot) { setLog('请先截图'); return }
    try {
      const blob = await dataUrlToBlob(shot)
      const hosted = await uploadCanvasImageBlob({ blob, label: 'Director Harness screenshot', filePrefix: 'director-harness', ownerNodeId: 'director-harness' })
      setHostedShot(hosted.url)
      setLog(`upload ok: ${hosted.url}`)
    } catch (error: any) {
      setLog(`upload ERROR: ${error?.message || String(error)}`)
    }
  }
  const displayedScene = React.useMemo(() => samplePropertyTimeline(data.scene, timelineTime), [data.scene, timelineTime])
  const keyPosition = (time: number, x: number) => {
    if (!selectedCharacterId) return
    setData((current) => {
      const moved = patchCharacter(current, selectedCharacterId, { position: [x, 0, 0] })
      return { ...moved, scene: { ...moved.scene, propertyTimeline: setKeyframe(moved.scene.propertyTimeline, moved.scene, 'character', selectedCharacterId, 'position', time) } }
    })
    setTimelineTime(time)
    setLog(`position key ${time.toFixed(1)}s = ${x}`)
  }

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-white">
      <div className="flex h-screen">
        <div className="flex-1 relative">
          <Viewport
            ref={ref}
            scene={displayedScene}
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
          <Button onClick={() => setData((d) => addCharacter(d, { id: 'empty-' + d.scene.characters.length, modelId: 'empty-object' }))}>加空对象</Button>
          <Button onClick={() => setData((d) => addCharacter(d, { id: 'torus-' + d.scene.characters.length, modelId: 'prop-torus' }))}>加圆环</Button>
          <Button onClick={() => setData((d) => addCharacter(d, { id: 'pyramid-' + d.scene.characters.length, modelId: 'prop-pyramid' }))}>加棱锥</Button>
          <Button onClick={() => applyPoseToSelected('wave')}>
            姿势: 招手(当前选中)
          </Button>
          <Button onClick={() => applyPoseToSelected('sit')}>
            姿势: 坐姿(当前选中)
          </Button>
          <Button onClick={() => applyPoseToSelected('akimbo')}>
            姿势: 叉腰(当前选中)
          </Button>
          <Button onClick={() => keyPosition(0, -2)}>位置关键帧：0s / X=-2</Button>
          <Button onClick={() => keyPosition(10, 2)}>位置关键帧：10s / X=2</Button>
          <label className="text-xs text-slate-300">属性时间线 {timelineTime.toFixed(2)}s
            <input aria-label="属性时间线播放头" className="w-full" type="range" min={0} max={10} step={0.01} value={timelineTime} onChange={(event) => setTimelineTime(Number(event.target.value))} />
          </label>
          <Button onClick={capture}>截图</Button>
          <Button onClick={() => void uploadShot()} disabled={!shot}>上传截图为远程图片</Button>
          <Button onClick={() => setAiImportOpen(true)}>打开 AI 识图导入</Button>
          <div className="text-xs text-slate-400">状态：{log}</div>
          <div className="text-xs text-slate-400">
            机位数 {data.scene.cameras.length} / 角色数 {data.scene.characters.length} / 选中 {data.selectedObjectId || '无'}
          </div>
          <div className="text-xs text-slate-400">
            当前姿势目标：{selectedCharacterId || '无'}
          </div>
          {shot ? <img src={shot} alt="shot" className="w-full border border-white/10 rounded" /> : null}
          {hostedShot ? <a href={hostedShot} target="_blank" rel="noreferrer" className="text-xs text-blue-300 break-all">远程截图：{hostedShot}</a> : null}
        </div>
      </div>
      {aiImportOpen ? <AiSceneImportDialog busy={false} sourceUrl={hostedShot || undefined} onClose={() => setAiImportOpen(false)} onUpload={async () => setLog('harness upload selected')} onOpenHistory={() => setLog('harness history opened')} onGenerate={async (mode) => setLog(`harness generate ${mode}`)} /> : null}
    </div>
  )
}
