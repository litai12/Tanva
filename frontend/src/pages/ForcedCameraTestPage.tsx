import React from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { Button } from '@/components/ui/button'

type CamDef = {
  id: string
  position: [number, number, number]
  lookAt: [number, number, number]
  fov: number
}

const CAMERAS: CamDef[] = [
  { id: 'cam1', position: [6, 4.5, 13], lookAt: [0, 1, 0], fov: 45 },
  { id: 'cam2', position: [-8, 2.5, 3], lookAt: [0, 1, 0], fov: 35 },
]

function CameraSwitcher({ active }: { active: CamDef }) {
  const { set, invalidate } = useThree()
  const ref = React.useRef<THREE.PerspectiveCamera>(null)

  React.useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    c.position.set(active.position[0], active.position[1], active.position[2])
    c.fov = active.fov
    c.updateProjectionMatrix()
    c.lookAt(active.lookAt[0], active.lookAt[1], active.lookAt[2])
    c.updateMatrixWorld(true)
    set({ camera: c })
    invalidate()
  }, [active, set, invalidate])

  return (
    <perspectiveCamera
      key={active.id}
      ref={ref}
      position={active.position}
      fov={active.fov}
      near={0.1}
      far={1000}
    />
  )
}

function Scene({ active }: { active: CamDef }) {
  return (
    <>
      <CameraSwitcher active={active} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#ffffff', '#444a55', 0.8]} />
      <directionalLight position={[5, 10, 7]} intensity={1.4} />
      <directionalLight position={[-6, 4, -4]} intensity={0.5} />
      <gridHelper args={[20, 20, '#1d3a5f', '#626872']} position={[0, 0, 0]} />
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[1, 2, 1]} />
        <meshStandardMaterial color="#4B8BFF" />
      </mesh>
      <mesh position={[2, 0.5, -2]}>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshStandardMaterial color="#FFD166" />
      </mesh>
      <OrbitControls makeDefault enableDamping target={[0, 1, 0]} />
    </>
  )
}

export default function ForcedCameraTestPage() {
  const [activeId, setActiveId] = React.useState('cam1')
  const active = React.useMemo(() => CAMERAS.find((c) => c.id === activeId) ?? CAMERAS[0], [activeId])

  return (
    <div className="w-screen h-screen bg-[#0a0b0d] text-white flex">
      <div className="flex-1 relative">
        <Canvas camera={{ position: [6, 4.5, 13], fov: 45 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
          <color attach="background" args={['#0a0b0d']} />
          <Scene active={active} />
        </Canvas>
      </div>
      <div className="w-[320px] border-l border-white/10 p-4 flex flex-col gap-3 bg-[#111317]">
        <div className="text-lg font-semibold">Forced Camera Test</div>
        <Button onClick={() => setActiveId('cam1')}>切到机位1</Button>
        <Button onClick={() => setActiveId('cam2')}>切到机位2</Button>
        <div className="text-xs text-slate-400">当前机位：{active.id}</div>
        <div className="text-xs text-slate-400">若按钮切换但画面不变，则是更底层 R3F camera handoff 问题</div>
      </div>
    </div>
  )
}
