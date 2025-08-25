import React, { useRef, useEffect, useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Model3DData } from '@/services/model3DUploadService';

interface Model3DViewerProps {
  modelData: Model3DData;
  width: number;
  height: number;
  isSelected?: boolean;
  drawMode?: string; // 当前绘图模式
}

// 3D模型组件
function Model3D({
  modelPath,
  width,
  height,
  onLoaded
}: {
  modelPath: string;
  width: number;
  height: number;
  onLoaded?: (boundingBox: THREE.Box3) => void;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(modelPath);
  const [autoScale, setAutoScale] = useState<[number, number, number]>([1, 1, 1]);
  const [baseScaleFactor, setBaseScaleFactor] = useState<number>(1);
  const clonedSceneRef = useRef<THREE.Object3D | null>(null);

  // 清理Three.js资源的工具函数
  const disposeThreeObject = (object: THREE.Object3D) => {
    object.traverse((child) => {
      if (child.type === 'Mesh') {
        const mesh = child as THREE.Mesh;

        // 清理几何体
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }

        // 清理材质
        if (mesh.material) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach(material => {
            // 检查material是否有dispose方法
            if (material && typeof material.dispose === 'function') {
              // 清理纹理
              const materialAny = material as any;
              if (materialAny.map && typeof materialAny.map.dispose === 'function') {
                materialAny.map.dispose();
              }
              if (materialAny.normalMap && typeof materialAny.normalMap.dispose === 'function') {
                materialAny.normalMap.dispose();
              }
              if (materialAny.roughnessMap && typeof materialAny.roughnessMap.dispose === 'function') {
                materialAny.roughnessMap.dispose();
              }
              if (materialAny.metalnessMap && typeof materialAny.metalnessMap.dispose === 'function') {
                materialAny.metalnessMap.dispose();
              }
              // 最后清理材质
              material.dispose();
            }
          });
        }
      }
    });
  };

  // 基础缩放计算（仅在模型加载时执行一次）
  useEffect(() => {
    if (meshRef.current && scene) {
      // 清理之前的克隆场景
      if (clonedSceneRef.current) {
        disposeThreeObject(clonedSceneRef.current);
        if (meshRef.current) {
          meshRef.current.clear();
        }
      }

      // 克隆场景以避免修改原始对象
      const clonedScene = scene.clone();
      clonedSceneRef.current = clonedScene;

      // 计算模型的包围盒
      const box = new THREE.Box3().setFromObject(clonedScene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // 将克隆的模型居中
      clonedScene.position.sub(center);

      // 计算基础缩放比例，使模型适合显示区域
      const maxSize = 2.5; // 目标最大尺寸
      const maxDimension = Math.max(size.x, size.y, size.z);
      const scaleFactor = Math.min(maxSize / maxDimension, 1);

      setBaseScaleFactor(scaleFactor);

      if (onLoaded) {
        onLoaded(box);
      }

      // 更新场景引用
      if (meshRef.current) {
        meshRef.current.add(clonedScene);
      }
    }

    // 组件卸载或scene变化时的清理函数
    return () => {
      if (clonedSceneRef.current) {
        disposeThreeObject(clonedSceneRef.current);
        if (meshRef.current) {
          meshRef.current.clear();
        }
        clonedSceneRef.current = null;
      }
    };
  }, [scene, onLoaded]);

  // 根据容器大小动态调整缩放（响应容器尺寸变化）
  useEffect(() => {
    // 计算容器大小比例，相对于基础大小（400x400）
    const baseSize = 400;
    const containerScale = Math.min(width / baseSize, height / baseSize);

    // 最终缩放 = 基础缩放 × 容器缩放
    const finalScale = baseScaleFactor * containerScale;
    setAutoScale([finalScale, finalScale, finalScale]);
  }, [width, height, baseScaleFactor]);

  return (
    <group ref={meshRef} scale={autoScale}>
      {/* 场景对象在useEffect中动态添加 */}
    </group>
  );
}

const Model3DViewer: React.FC<Model3DViewerProps> = ({
  modelData,
  width,
  height,
  isSelected = false,
  drawMode = 'select'
}) => {
  const [cameraPosition, setCameraPosition] = useState<[number, number, number]>([4, 4, 4]);
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<string | null>(null);

  const handleModelLoaded = (boundingBox: THREE.Box3) => {
    setIsLoading(false);

    // 根据模型大小调整摄像机位置
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const distance = maxDimension * 2;
    setCameraPosition([distance, distance, distance]);
  };

  // 组件卸载时的清理
  useEffect(() => {
    return () => {
      // @react-three/fiber的Canvas组件会自动处理大部分WebGL资源清理
      // useGLTF有内置的缓存和清理机制
      if (import.meta.env.DEV) {
        console.log('Model3DViewer组件卸载，清理3D资源');
      }
    };
  }, []);


  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        border: 'none',
        borderRadius: '0',
        overflow: 'hidden',
        backgroundColor: 'transparent'
      }}
    >
      {error ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            color: '#ef4444',
            fontSize: '14px',
            textAlign: 'center'
          }}
        >
          <div>
            <div>⚠️</div>
            <div>{error}</div>
          </div>
        </div>
      ) : (
        <>
          <Canvas
            camera={{
              position: cameraPosition,
              fov: 50,
              near: 0.1,
              far: 1000
            }}
            gl={{
              alpha: true,
              antialias: true,
              preserveDrawingBuffer: true,
              powerPreference: "high-performance"
            }}
            style={{
              background: 'transparent',
              pointerEvents: drawMode === 'select' || isSelected ? 'auto' : 'none'
            }}
          >
            <Suspense fallback={null}>
              {/* 多重光照系统 - 优化亮度 */}
              <ambientLight intensity={1.0} />
              <directionalLight
                position={[10, 10, 10]}
                intensity={1.5}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <directionalLight
                position={[-10, 5, 5]}
                intensity={1.0}
              />
              <pointLight
                position={[0, 10, 0]}
                intensity={0.8}
              />
              <pointLight
                position={[0, -5, 0]}
                intensity={0.3}
              />

              {/* 3D模型 */}
              <Model3D
                modelPath={modelData.path}
                width={width}
                height={height}
                onLoaded={handleModelLoaded}
              />

              {/* 交互控制器 */}
              {isSelected && (
                <OrbitControls
                  enablePan={false}
                  enableZoom={true}
                  enableRotate={true}
                  enableDamping={true}
                  dampingFactor={0.05}
                  minDistance={1}
                  maxDistance={20}
                  autoRotate={false}
                  rotateSpeed={1}
                  zoomSpeed={1.2}
                  mouseButtons={{
                    LEFT: THREE.MOUSE.ROTATE,
                    MIDDLE: THREE.MOUSE.DOLLY,
                    RIGHT: THREE.MOUSE.ROTATE
                  }}
                  makeDefault={true}
                />
              )}
            </Suspense>
          </Canvas>

          {/* 加载状态 */}
          {isLoading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.1)', // 很淡的半透明白色
                color: '#374151',
                fontSize: '14px'
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ marginBottom: '8px' }}>🔄</div>
                <div>加载3D模型中...</div>
              </div>
            </div>
          )}

        </>
      )}

      {/* 边框已移动到Model3DContainer中，与控制点使用统一坐标系 */}
    </div>
  );
};

export default Model3DViewer;