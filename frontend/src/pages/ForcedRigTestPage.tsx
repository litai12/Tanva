import React from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { directorAssetUrl } from '@/components/flow/nodes/directorConsole/directorAssetUrl'

function ForcedRigModel() {
  const { scene } = useGLTF(directorAssetUrl('xbot.glb'))
  const cloned = React.useMemo(() => skeletonClone(scene), [scene])
  const armRef = React.useRef<THREE.Bone | null>(null)

  React.useEffect(() => {
    let arm: THREE.Bone | null = null
    cloned.traverse((o) => {
      if (o.name === 'mixamorigLeftArm' && o.type === 'Bone') {
        arm = o as THREE.Bone
      }
    })
    armRef.current = arm
  }, [cloned])

  useFrame(() => {
    const arm = armRef.current
    if (!arm) return
    arm.rotation.set(0, 0, -1.2)
    cloned.updateMatrixWorld(true)
    cloned.traverse((o) => {
      const skinnedMesh = o as THREE.SkinnedMesh
      if (skinnedMesh.isSkinnedMesh) skinnedMesh.skeleton?.update()
    })
  })

  return <primitive object={cloned} />
}

export default function ForcedRigTestPage() {
  return (
    <div className="w-screen h-screen bg-[#0a0b0d] relative">
      <Canvas camera={{ position: [2.5, 1.8, 4.5], fov: 45 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={['#0a0b0d']} />
        <ambientLight intensity={1.1} />
        <hemisphereLight args={['#ffffff', '#444a55', 0.8]} />
        <directionalLight position={[5, 10, 7]} intensity={1.4} />
        <directionalLight position={[-6, 4, -4]} intensity={0.5} />
        <gridHelper args={[10, 10, '#1d3a5f', '#626872']} position={[0, 0, 0]} />
        <React.Suspense fallback={null}>
          <ForcedRigModel />
        </React.Suspense>
        <OrbitControls makeDefault enableDamping target={[0, 1, 0]} />
      </Canvas>
      <div className="absolute top-3 left-3 text-white text-sm bg-black/50 px-3 py-2 rounded-lg">
        强制左臂旋转测试：若模型仍不变，则底层 three/skinning 链异常
      </div>
    </div>
  )
}
