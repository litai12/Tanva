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
  isResizing?: boolean; // 是否正在调整容器大小
}

const TARGET_MODEL_SIZE = 5.5;
const MAX_MODEL_UPSCALE = 5.0;
const MODEL_SCALE_MULTIPLIER = 12; // 控制模型基础体积，值越大初始尺寸越大
const CONTAINER_SCALE_MULTIPLIER = 7; // 控制容器对缩放的影响，值越大越不受框限制
const BASELINE_SCALE_MULTIPLIER = 6; // 保障最小放大倍数
const CAMERA_DISTANCE_MULTIPLIER = 0.7;
const MIN_CAMERA_DISTANCE = 1.5;
const EPSILON = 1e-4;

const computeScaleFactor = (maxDimension: number) => {
  const safeDimension = Math.max(maxDimension, Number.EPSILON);
  const rawScale = TARGET_MODEL_SIZE / safeDimension;
  return Math.min(rawScale * MODEL_SCALE_MULTIPLIER, MAX_MODEL_UPSCALE * MODEL_SCALE_MULTIPLIER);
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
  onLoaded,
  isResizing = false
}: {
  modelPath: string;
  width: number;
  height: number;
  onLoaded?: (boundingBox: THREE.Box3) => void;
  isResizing?: boolean;
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

      // 遍历场景中的所有材质，只对过暗的材质进行轻微调整，保持原始颜色
      clonedScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => {
              // 处理所有类型的材质
              if (material instanceof THREE.MeshStandardMaterial || 
                  material instanceof THREE.MeshPhysicalMaterial ||
                  material instanceof THREE.MeshLambertMaterial ||
                  material instanceof THREE.MeshPhongMaterial ||
                  material instanceof THREE.MeshBasicMaterial) {
                // 检查材质是否过暗（接近黑色）
                if (material.color) {
                  const brightness = material.color.r + material.color.g + material.color.b;
                  // 只有当材质非常暗时才轻微提亮，保持原始颜色
                  if (brightness < 0.1) {
                    // 对于接近黑色的材质，轻微提亮但保持黑色调
                    material.color.multiplyScalar(1.2);
                  }
                  // 对于其他颜色，保持原样
                }
                // 只添加非常轻微的自发光，不影响颜色
                if ('emissive' in material) {
                  // 使用材质的原始颜色作为自发光基础，但强度很低
                  if (material.color) {
                    material.emissive = material.color.clone().multiplyScalar(0.1);
                  } else {
                    material.emissive = new THREE.Color(0x111111);
                  }
                  if ('emissiveIntensity' in material) {
                    (material as any).emissiveIntensity = 0.1;
                  }
                }
                // 确保材质更新
                material.needsUpdate = true;
              }
            });
          }
        }
      });

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

  // 根据容器大小动态调整缩放（仅在用户主动调整容器大小时更新，避免操作3D模型时抽搐）
  const scaleUpdateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastWidthRef = useRef(width);
  const lastHeightRef = useRef(height);
  const isInitialMountRef = useRef(true);
  
  useEffect(() => {
    // 根据3D框（容器）的实际大小来计算模型缩放
    // 使用容器较小边作为基准，让模型大小与容器大小成正比
    const minContainerSize = Math.min(width, height);
    const referenceSize = 360; // 参考尺寸越小，默认越大
    const containerScale = minContainerSize / referenceSize;
    const dynamicScale = baseScaleFactor * containerScale * CONTAINER_SCALE_MULTIPLIER;
    const baselineScale = baseScaleFactor * BASELINE_SCALE_MULTIPLIER;
    const finalScale = Math.max(dynamicScale, baselineScale);

    // 首次挂载时，直接设置缩放，不延迟
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      setAutoScale([finalScale, finalScale, finalScale]);
      lastWidthRef.current = width;
      lastHeightRef.current = height;
      return;
    }
    
    // 如果正在调整大小，立即更新缩放（用户主动调整容器）
    if (isResizing) {
      setAutoScale([finalScale, finalScale, finalScale]);
      lastWidthRef.current = width;
      lastHeightRef.current = height;
      return;
    }
    
    // 如果不在调整大小，计算尺寸变化量
    const widthDiff = Math.abs(width - lastWidthRef.current);
    const heightDiff = Math.abs(height - lastHeightRef.current);
    
    // 只有当尺寸变化超过很大阈值时才更新（说明是用户主动调整大小，而不是微小波动）
    // 大幅提高阈值，避免操作3D模型时的任何尺寸变化触发更新
    const threshold = 20; // 20像素的阈值，只有明显的大小变化才更新
    
    if (widthDiff < threshold && heightDiff < threshold) {
      return;
    }
    
    // 更新记录的尺寸
    lastWidthRef.current = width;
    lastHeightRef.current = height;
    
    // 清除之前的定时器
    if (scaleUpdateTimerRef.current) {
      clearTimeout(scaleUpdateTimerRef.current);
    }
    
    // 使用较长的防抖延迟，确保只在用户停止调整大小时才更新
    scaleUpdateTimerRef.current = setTimeout(() => {
      // 使用requestAnimationFrame确保平滑更新
      requestAnimationFrame(() => {
    setAutoScale([finalScale, finalScale, finalScale]);
      });
    }, 300); // 300ms防抖延迟，确保用户停止调整后才更新
    
    return () => {
      if (scaleUpdateTimerRef.current) {
        clearTimeout(scaleUpdateTimerRef.current);
      }
    };
  }, [width, height, baseScaleFactor, isResizing]);

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
  isResizing = false,
}) => {
  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const maxDpr = Math.min(devicePixelRatio, 1.75);
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
  const lastCameraEmitRef = useRef(0);

  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  const lastCameraStateRef = useRef<Model3DCameraState | null>(null);

  useEffect(() => {
    cameraStateRef.current = cameraState;

    // 检查值是否真的改变了，避免不必要的更新
    if (lastCameraStateRef.current && cameraStatesEqual(cameraState, lastCameraStateRef.current)) {
      return;
    }

    lastCameraStateRef.current = cameraState;

    if (!onCameraChangeRef.current) return;
    if (cameraChangeFrameRef.current) cancelAnimationFrame(cameraChangeFrameRef.current);
    cameraChangeFrameRef.current = requestAnimationFrame(() => {
      if (onCameraChangeRef.current) {
        const now = performance.now();
        if (now - lastCameraEmitRef.current > 1000 / 15) { // 约15fps推送到外部，降低渲染震动
          lastCameraEmitRef.current = now;
          onCameraChangeRef.current(cameraStateRef.current);
        }
      }
      cameraChangeFrameRef.current = null;
    });

    return () => {
      if (cameraChangeFrameRef.current) {
        cancelAnimationFrame(cameraChangeFrameRef.current);
        cameraChangeFrameRef.current = null;
      }
    };
  }, [cameraState]);

  const isUpdatingFromExternalRef = useRef(false);

  useEffect(() => {
    // 如果正在从外部更新（通过onCameraChange），跳过这个更新，避免循环
    if (isUpdatingFromExternalRef.current) {
      return;
    }

    const nextCamera = modelData.camera;
    hasCustomCameraRef.current = !!nextCamera;
    if (!nextCamera) return;
    
    // 只有当值真正改变时才更新
    if (!cameraStatesEqual(nextCamera, cameraStateRef.current)) {
      hasCustomCameraRef.current = true;
      isUpdatingFromExternalRef.current = true;
      setCameraState(nextCamera);
      // 延迟重置标志
      requestAnimationFrame(() => {
        isUpdatingFromExternalRef.current = false;
      });
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
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        border: 'none',
        borderRadius: '0',
        overflow: 'visible', // 允许3D模型超出容器显示，不裁剪
        backgroundColor: 'transparent',
        padding: 0,
        margin: 0,
        boxSizing: 'border-box'
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
            dpr={[1, maxDpr]}
            gl={{
              alpha: true,
              antialias: true,
              preserveDrawingBuffer: true,
              powerPreference: 'high-performance',
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 1.15,
              outputColorSpace: THREE.SRGBColorSpace
            }}
            style={{
              background: 'transparent',
              pointerEvents
            }}
          >
            
            <Suspense fallback={null}>
              {/* 更自然的光照组合：柔和环境光 + 半球光 + 主/辅方向光 */}
              <ambientLight color="#ffffff" intensity={0.4} />
              <hemisphereLight args={['#f8fafc', '#cbd5e1', 0.85]} />
              <directionalLight position={[6, 8, 6]} intensity={1.2} color="#ffffff" />
              <directionalLight position={[-6, 6, -4]} intensity={0.6} color="#e2e8f0" />
              <pointLight position={[0, 7, 0]} intensity={0.35} color="#ffffff" />
              <pointLight position={[2, 3, -3]} intensity={0.25} color="#f1f5f9" />

              <Model3D
                modelPath={modelData.url || modelData.path || ''}
                width={width}
                height={height}
                onLoaded={handleModelLoaded}
                isResizing={isResizing}
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
  // 使用ref存储最新的cameraState，避免在handleControlChange中依赖它导致无限循环
  const cameraStateRef = useRef<Model3DCameraState>(cameraState);
  const isUpdatingFromPropsRef = useRef(false);
  const lastControlEmitRef = useRef(0);

  useEffect(() => {
    cameraStateRef.current = cameraState;
  }, [cameraState]);

  const applyCameraState = useCallback((state: Model3DCameraState) => {
    isUpdatingFromPropsRef.current = true;
    camera.position.set(state.position[0], state.position[1], state.position[2]);
    camera.up.set(state.up[0], state.up[1], state.up[2]);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(state.target[0], state.target[1], state.target[2]);
      controls.update();
    } else {
      camera.lookAt(state.target[0], state.target[1], state.target[2]);
    }
    // 延迟重置标志，避免立即触发onChange
    requestAnimationFrame(() => {
      isUpdatingFromPropsRef.current = false;
    });
  }, [camera]);

  useEffect(() => {
    applyCameraState(cameraState);
  }, [cameraState, applyCameraState]);

  const controlChangeTimerRef = useRef<number | null>(null);
  
  useEffect(() => {
    return () => {
      if (controlChangeTimerRef.current) {
        cancelAnimationFrame(controlChangeTimerRef.current);
      }
    };
  }, []);

  const handleControlChange = useCallback(() => {
    // 如果正在从props更新，跳过处理，避免循环
    if (isUpdatingFromPropsRef.current) return;
    
    const controls = controlsRef.current;
    if (!controls || !enabled) return;

    // 限制同步频率，降低频繁setState导致的卡顿
    const now = performance.now();
    const minInterval = 1000 / 24; // 约24fps的状态上报，更平滑且减少抖动

    if (controlChangeTimerRef.current) {
      cancelAnimationFrame(controlChangeTimerRef.current);
      controlChangeTimerRef.current = null;
    }

    if (now - lastControlEmitRef.current < minInterval) {
      controlChangeTimerRef.current = requestAnimationFrame(() => {
        controlChangeTimerRef.current = null;
        handleControlChange();
      });
      return;
    }

    lastControlEmitRef.current = now;

    const cam = controls.object as THREE.PerspectiveCamera;
    const next: Model3DCameraState = {
      position: [cam.position.x, cam.position.y, cam.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      up: [cam.up.x, cam.up.y, cam.up.z],
    };

    // 使用ref来避免依赖cameraState导致的无限循环
    const currentState = cameraStateRef.current;
    if (!cameraStatesEqual(next, currentState)) {
      // 使用低优先级更新，避免阻塞主线程
      if (typeof React.startTransition === 'function') {
        React.startTransition(() => onStateChange(next));
      } else {
        onStateChange(next);
      }
    }
  }, [enabled, onStateChange]);

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={true}
      enableZoom={true}
      enableRotate={true}
      enableDamping
      dampingFactor={0.18} // 增加阻尼，使操作更平滑
      minDistance={0.5}
      maxDistance={50}
      autoRotate={false}
      rotateSpeed={0.65} // 降低旋转速度，配合阻尼更顺滑
      zoomSpeed={0.85} // 调低缩放速度，避免突兀
      panSpeed={0.7} // 平移稍慢，减少抖动感
      screenSpacePanning={false} // 在3D空间中平移，而不是屏幕空间
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,    // 左键旋转
        MIDDLE: THREE.MOUSE.DOLLY,    // 中键缩放（鼠标滚轮）
        RIGHT: THREE.MOUSE.PAN        // 右键在3D空间中平移模型
      }}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
      }}
      makeDefault
      enabled={enabled}
      onChange={handleControlChange}
    />
  );
};
