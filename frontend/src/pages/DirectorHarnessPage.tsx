import React from 'react'
import { ReactFlowProvider, useReactFlow, type Node } from '@xyflow/react'
import { Viewport, type ViewportHandle } from '@/components/flow/nodes/directorConsole/scene/Viewport'
import type { DirectorConsoleData } from '@/components/flow/nodes/directorConsole/types'
import { addCharacter, addCamera, setViewpoint, patchCharacter } from '@/components/flow/nodes/directorConsole/state/scene'
import { POSE_PRESETS } from '@/components/flow/nodes/directorConsole/state/pose'
import { createDefaultDirectorConsoleData } from '@/components/flow/nodes/directorConsole/types'
import { Button } from '@/components/ui/button'
import { samplePropertyTimeline, setKeyframe } from '@/components/flow/nodes/directorConsole/state/propertyTimeline'
import { dataUrlToBlob, uploadCanvasImageBlob } from '@/components/flow/nodes/directorConsole/uploadCanvasImageBlob'
import { AiSceneImportDialog } from '@/components/flow/nodes/directorConsole/panels/AiSceneImportDialog'
import { BODY_TYPES } from '@/components/flow/nodes/directorConsole/assets'
import { registerGaussianGroundBuffer, sampleGaussianGroundHeight } from '@/components/flow/nodes/directorConsole/state/gaussianGround'
import { LIBTV_POSES } from '@/components/flow/nodes/directorConsole/panels/CharacterPropertiesPanel'

const DirectorConsoleModal = React.lazy(() => import('@/components/flow/nodes/directorConsole/DirectorConsoleModal'))
const FULL_HARNESS_NODE_ID = 'director-full-harness'
const FULL_HARNESS_STORAGE = 'tanva:director-full-harness:v1'

function readFullHarnessData(): DirectorConsoleData {
  try {
    const stored = localStorage.getItem(FULL_HARNESS_STORAGE)
    if (stored) return JSON.parse(stored) as DirectorConsoleData
  } catch { /* use deterministic default */ }
  return createDefaultDirectorConsoleData()
}

function FullDirectorHarnessHost() {
  const rf = useReactFlow()
  const [open, setOpen] = React.useState(true)
  const [writes, setWrites] = React.useState(0)
  React.useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; patch?: Partial<DirectorConsoleData> }>).detail
      if (detail?.id !== FULL_HARNESS_NODE_ID || !detail.patch) return
      rf.setNodes((nodes) => nodes.map((node) => {
        if (node.id !== FULL_HARNESS_NODE_ID) return node
        const data = { ...(node.data as DirectorConsoleData), ...detail.patch }
        localStorage.setItem(FULL_HARNESS_STORAGE, JSON.stringify(data))
        return { ...node, data }
      }))
      setWrites((value) => value + 1)
    }
    window.addEventListener('flow:updateNodeData', onUpdate)
    return () => window.removeEventListener('flow:updateNodeData', onUpdate)
  }, [rf])
  return (
    <div className="min-h-screen bg-[#0a0b0d] text-white p-6">
      <h1 className="text-lg font-semibold mb-3">Full Director Harness</h1>
      <div className="flex gap-3 items-center">
        <Button onClick={() => setOpen(true)}>打开完整导演台</Button>
        <Button onClick={() => { localStorage.removeItem(FULL_HARNESS_STORAGE); location.reload() }}>清空持久化测试数据</Button>
        <span data-testid="director-harness-writes" className="text-xs text-slate-400">scene writes: {writes}</span>
      </div>
      {open ? <React.Suspense fallback={null}><DirectorConsoleModal nodeId={FULL_HARNESS_NODE_ID} onClose={() => setOpen(false)} /></React.Suspense> : null}
    </div>
  )
}

function FullDirectorHarness() {
  const initialNode: Node = { id: FULL_HARNESS_NODE_ID, type: 'directorConsole', position: { x: 0, y: 0 }, data: readFullHarnessData() }
  return <ReactFlowProvider initialNodes={[initialNode]} initialEdges={[]}><FullDirectorHarnessHost /></ReactFlowProvider>
}

function initial(): DirectorConsoleData {
  let d = createDefaultDirectorConsoleData()
  d = addCharacter(d, { id: 'c1', modelId: 'male' })
  d = addCamera(d, { id: 'k1' })
  return d
}

function ViewportDirectorHarnessPage() {
  const [data, setData] = React.useState<DirectorConsoleData>(initial)
  const ref = React.useRef<ViewportHandle | null>(null)
  const [shot, setShot] = React.useState<string>('')
  const [hostedShot, setHostedShot] = React.useState<string>('')
  const [aiImportOpen, setAiImportOpen] = React.useState(false)
  const [log, setLog] = React.useState<string>('ready')
  const [timelineTime, setTimelineTime] = React.useState(0)
  const [poseAuditIndex, setPoseAuditIndex] = React.useState(-1)
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
  const showAllBodies = () => {
    setData((current) => ({
      ...current,
      selectedObjectId: undefined,
      scene: {
        ...current.scene,
        sceneScale: 1,
        characters: BODY_TYPES.map((body, index) => ({
          id: `body-${body.id}`,
          name: body.name,
          modelId: body.id,
          position: [((index % 4) - 1.5) * 1.35, 0, Math.floor(index / 4) * 1.45 - .7],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          uniformScale: 1,
          colorHex: ['#7fa6d9', '#d9a7b8', '#b08a70', '#a97862', '#8ca7a0', '#d0b17d', '#e3bd92', '#d4a5c7'][index],
        })),
      },
    }))
    setLog('showing eight independent body rigs')
  }
  const applyNextLibTvPoseToAll = () => {
    const nextIndex = (poseAuditIndex + 1) % LIBTV_POSES.length
    const entry = LIBTV_POSES[nextIndex]
    const pose = POSE_PRESETS.find((preset) => preset.id === entry.sourceId)?.pose
    if (!pose) { setLog(`missing pose ${entry.sourceId}`); return }
    setData((current) => ({
      ...current,
      scene: {
        ...current.scene,
        characters: current.scene.characters.map((character) => ({ ...character, pose: { ...pose }, posePresetId: entry.sourceId })),
      },
    }))
    setPoseAuditIndex(nextIndex)
    setLog(`pose audit ${nextIndex + 1}/${LIBTV_POSES.length}: ${entry.label}`)
  }
  const testGaussianGround = () => {
    const gaussian = {
      id: 'gaussian-fixture', name: '坡面点云', modelId: 'fixture.splat', position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], uniformScale: 1, colorHex: '#fff',
    }
    const points: Array<[number, number, number]> = []
    for (let x = -2; x <= 2; x += .2) for (let z = -2; z <= 2; z += .2) points.push([x, 1 + x * .5, z])
    const buffer = new ArrayBuffer(points.length * 32)
    const view = new DataView(buffer)
    points.forEach(([x, y, z], index) => {
      view.setFloat32(index * 32, x, true); view.setFloat32(index * 32 + 4, y, true); view.setFloat32(index * 32 + 8, z, true)
    })
    registerGaussianGroundBuffer(gaussian, buffer, 'slope-fixture')
    const left = sampleGaussianGroundHeight(-1, 0, 1)
    const center = sampleGaussianGroundHeight(0, 0, 1)
    const right = sampleGaussianGroundHeight(1, 0, 1)
    setLog(`gaussian slope heights: ${left?.toFixed(2)} / ${center?.toFixed(2)} / ${right?.toFixed(2)}`)
  }
  const loadCc0SplatGround = () => {
    const modelId = '/director/open-source/cc0-terrain/rolling-ground.splat'
    setData((current) => {
      if (current.scene.characters.some((character) => character.modelId === modelId)) return current
      return addCharacter(current, { id: 'cc0-splat-ground', modelId, name: 'CC0 起伏地面', position: [0, 0, 0] })
    })
    setLog('loading real CC0 .splat terrain; wait for ground index')
  }
  const sampleCc0SplatGround = () => {
    const left = sampleGaussianGroundHeight(-2, 0, 1)
    const center = sampleGaussianGroundHeight(0, 0, 1)
    const right = sampleGaussianGroundHeight(2, 0, 1)
    setLog(`CC0 .splat heights: ${left?.toFixed(3) ?? 'null'} / ${center?.toFixed(3) ?? 'null'} / ${right?.toFixed(3) ?? 'null'}`)
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
          <Button onClick={showAllBodies}>显示八套独立素体</Button>
          <Button onClick={applyNextLibTvPoseToAll}>八体下一姿势（{poseAuditIndex < 0 ? '未开始' : `${poseAuditIndex + 1}/20 ${LIBTV_POSES[poseAuditIndex].label}`}）</Button>
          <Button onClick={testGaussianGround}>验证高斯坡面高度索引</Button>
          <Button onClick={loadCc0SplatGround}>加载真实 CC0 .splat 地面</Button>
          <Button onClick={sampleCc0SplatGround}>读取真实 .splat 地面高度</Button>
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

export default function DirectorHarnessPage() {
  return new URLSearchParams(location.search).get('full') === '1'
    ? <FullDirectorHarness />
    : <ViewportDirectorHarnessPage />
}
