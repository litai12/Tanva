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
}

// 3D模型组件
function Model3D({ 
  modelPath, 
  onLoaded 
}: { 
  modelPath: string; 
  onLoaded?: (boundingBox: THREE.Box3) => void;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(modelPath);
  const [autoScale, setAutoScale] = useState<[number, number, number]>([1, 1, 1]);

  useEffect(() => {
    if (meshRef.current && scene) {
      // 克隆场景以避免修改原始对象
      const clonedScene = scene.clone();
      
      // 计算模型的包围盒
      const box = new THREE.Box3().setFromObject(clonedScene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // 将克隆的模型居中
      clonedScene.position.sub(center);

      // 计算自动缩放比例，使模型适合显示区域
      const maxSize = 2.5; // 目标最大尺寸
      const maxDimension = Math.max(size.x, size.y, size.z);
      const scaleFactor = Math.min(maxSize / maxDimension, 1);
      
      setAutoScale([scaleFactor, scaleFactor, scaleFactor]);

      if (onLoaded) {
        onLoaded(box);
      }
      
      // 更新场景引用
      if (meshRef.current) {
        meshRef.current.clear();
        meshRef.current.add(clonedScene);
      }
    }
  }, [scene, onLoaded]);

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
  isSelected = false
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


  return (
    <div 
      style={{ 
        width, 
        height, 
        position: 'relative',
        border: 'none',
        borderRadius: '0',
        overflow: 'hidden',
        backgroundColor: isSelected ? '#f8fafc' : 'transparent'
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
            style={{ background: 'transparent' }}
          >
            <Suspense fallback={null}>
              {/* 多重光照系统 */}
              <ambientLight intensity={0.8} />
              <directionalLight 
                position={[10, 10, 10]} 
                intensity={1.2}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <directionalLight 
                position={[-10, 5, 5]} 
                intensity={0.8} 
              />
              <pointLight 
                position={[0, 10, 0]} 
                intensity={0.5} 
              />

              {/* 3D模型 */}
              <Model3D 
                modelPath={modelData.path}
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
                  makeDefault={false}
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
                backgroundColor: isSelected ? 'rgba(248, 250, 252, 0.9)' : 'rgba(0, 0, 0, 0.3)',
                color: isSelected ? '#6b7280' : '#ffffff',
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

      {/* 选中状态的边框 */}
      {isSelected && (
        <div
          className="border-area"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: '2px solid #3b82f6',
            borderRadius: '0',
            pointerEvents: 'all',
            cursor: 'move',
            zIndex: 5,
            backgroundColor: 'transparent'
          }}
        />
      )}
    </div>
  );
};

export default Model3DViewer;