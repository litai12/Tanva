import { logger } from '@/utils/logger';
import React, { useRef, useEffect, useState, Suspense, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Model3DData, Model3DCameraState } from '@/services/model3DUploadService';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

interface Model3DViewerProps {
  modelData: Model3DData;
  width: number;
  height: number;
  isSelected?: boolean;
  drawMode?: string; // 当前绘图模式
  onCameraChange?: (camera: Model3DCameraState) => void;
}

const TARGET_MODEL_SIZE = 3.2;
const MAX_MODEL_UPSCALE = 2.4;
const CAMERA_DISTANCE_MULTIPLIER = 1.7;
const MIN_CAMERA_DISTANCE = 3.2;
const EPSILON = 1e-4;

const computeScaleFactor = (maxDimension: number) => {
  const safeDimension = Math.max(maxDimension, Number.EPSILON);
  const rawScale = TARGET_MODEL_SIZE / safeDimension;
  return Math.min(rawScale, MAX_MODEL_UPSCALE);
};

const arraysAlmostEqual = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < EPSILON);

const cameraStatesEqual = (a: Model3DCameraState, b: Model3DCameraState) =>
  arraysAlmostEqual(a.position, b.position) &&
  arraysAlmostEqual(a.target, b.target) &&
  arraysAlmostEqual(a.up, b.up);

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
            if (material && typeof material.dispose === 'function') {
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
      if (clonedSceneRef.current) {
        disposeThreeObject(clonedSceneRef.current);
        if (meshRef.current) {
          meshRef.current.clear();
        }
      }

      const clonedScene = scene.clone();
      clonedSceneRef.current = clonedScene;

      const box = new THREE.Box3().setFromObject(clonedScene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      clonedScene.position.sub(center);

      const maxDimension = Math.max(size.x, size.y, size.z);
      const scaleFactor = computeScaleFactor(maxDimension);

      setBaseScaleFactor(scaleFactor);

      if (onLoaded) {
        onLoaded(box);
      }

      if (meshRef.current) {
        meshRef.current.add(clonedScene);
      }
    }

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
    const baseSize = 360;
    const containerScale = Math.min(width / baseSize, height / baseSize);
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
  drawMode = 'select',
  onCameraChange,
}) => {
  const [cameraState, setCameraState] = useState<Model3DCameraState>(() => modelData.camera ?? ({
    position: [4, 4, 4],
    target: [0, 0, 0],
    up: [0, 1, 0],
  }));
  const cameraStateRef = useRef<Model3DCameraState>(cameraState);
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const hasCustomCameraRef = useRef<boolean>(!!modelData.camera);
  const cameraChangeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    cameraStateRef.current = cameraState;

    if (!onCameraChange) return;
    if (cameraChangeFrameRef.current) cancelAnimationFrame(cameraChangeFrameRef.current);
    cameraChangeFrameRef.current = requestAnimationFrame(() => {
      onCameraChange(cameraStateRef.current);
      cameraChangeFrameRef.current = null;
    });

    return () => {
      if (cameraChangeFrameRef.current) {
        cancelAnimationFrame(cameraChangeFrameRef.current);
        cameraChangeFrameRef.current = null;
      }
    };
  }, [cameraState, onCameraChange]);

  useEffect(() => {
    const nextCamera = modelData.camera;
    hasCustomCameraRef.current = !!nextCamera;
    if (!nextCamera) return;
    if (!cameraStatesEqual(nextCamera, cameraStateRef.current)) {
      hasCustomCameraRef.current = true;
      setCameraState(nextCamera);
    }
  }, [
    modelData.camera?.position?.join(','),
    modelData.camera?.target?.join(','),
    modelData.camera?.up?.join(',')
  ]);

  const handleModelLoaded = (boundingBox: THREE.Box3) => {
    setIsLoading(false);

    if (!hasCustomCameraRef.current) {
      const size = boundingBox.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);
      const scaleFactor = computeScaleFactor(maxDimension);
      const scaledMaxDimension = maxDimension * scaleFactor;
      const distance = Math.max(scaledMaxDimension * CAMERA_DISTANCE_MULTIPLIER, MIN_CAMERA_DISTANCE);
      const defaultState: Model3DCameraState = {
        position: [distance, distance, distance],
        target: [0, 0, 0],
        up: [0, 1, 0],
      };
      setCameraState(defaultState);
    }
  };

  useEffect(() => () => {
    if (import.meta.env.DEV) {
      logger.debug('Model3DViewer组件卸载，清理3D资源');
    }
  }, []);

  const pointerEvents = drawMode === 'select' || isSelected ? 'auto' : 'none';
  const controlsEnabled = drawMode === 'select' && isSelected;

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
              position: cameraState.position,
              fov: 50,
              near: 0.1,
              far: 1000
            }}
            gl={{
              alpha: true,
              antialias: true,
              preserveDrawingBuffer: true,
              powerPreference: 'high-performance'
            }}
            style={{
              background: 'transparent',
              pointerEvents
            }}
          >
            <Suspense fallback={null}>
              <ambientLight intensity={1.0} />
              <directionalLight
                position={[10, 10, 10]}
                intensity={1.5}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <directionalLight position={[-10, 5, 5]} intensity={1.0} />
              <pointLight position={[0, 10, 0]} intensity={0.8} />
              <pointLight position={[0, -5, 0]} intensity={0.3} />

              <Model3D
                modelPath={modelData.url || modelData.path || ''}
                width={width}
                height={height}
                onLoaded={handleModelLoaded}
              />

              <CameraController cameraState={cameraState} enabled={controlsEnabled} onStateChange={setCameraState} />
            </Suspense>
          </Canvas>

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
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
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

type CameraControllerProps = {
  cameraState: Model3DCameraState;
  onStateChange: (next: Model3DCameraState) => void;
  enabled: boolean;
};

const CameraController: React.FC<CameraControllerProps> = ({ cameraState, onStateChange, enabled }) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();

  const applyCameraState = useCallback((state: Model3DCameraState) => {
    camera.position.set(state.position[0], state.position[1], state.position[2]);
    camera.up.set(state.up[0], state.up[1], state.up[2]);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(state.target[0], state.target[1], state.target[2]);
      controls.update();
    } else {
      camera.lookAt(state.target[0], state.target[1], state.target[2]);
    }
  }, [camera]);

  useEffect(() => {
    applyCameraState(cameraState);
  }, [cameraState, applyCameraState]);

  const handleControlChange = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const cam = controls.object as THREE.PerspectiveCamera;
    const next: Model3DCameraState = {
      position: [cam.position.x, cam.position.y, cam.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      up: [cam.up.x, cam.up.y, cam.up.z],
    };

    if (!cameraStatesEqual(next, cameraState)) {
      onStateChange(next);
    }
  }, [cameraState, onStateChange]);

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      enableZoom
      enableRotate
      enableDamping
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
      makeDefault
      enabled={enabled}
      onChange={handleControlChange}
    />
  );
};
