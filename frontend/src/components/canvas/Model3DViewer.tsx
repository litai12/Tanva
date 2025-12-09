import { logger } from "@/utils/logger";
import React, {
  useRef,
  useEffect,
  useState,
  Suspense,
  useCallback,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type {
  Model3DData,
  Model3DCameraState,
} from "@/services/model3DUploadService";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

interface Model3DViewerProps {
  modelData: Model3DData;
  isSelected?: boolean;
  drawMode?: string; // 当前绘图模式
  onCameraChange?: (camera: Model3DCameraState) => void;
}

const TARGET_MODEL_SIZE = 2.0;
const MAX_MODEL_UPSCALE = 3.0;
const MODEL_SCALE_MULTIPLIER = 1.5; // 控制模型基础体积，值越大初始尺寸越大
const CONTAINER_SCALE_MULTIPLIER = 7; // 控制容器对缩放的影响，值越大越不受框限制
const BASELINE_SCALE_MULTIPLIER = 1.0; // 保障最小放大倍数
const CAMERA_DISTANCE_MULTIPLIER = 0.7;
const MIN_CAMERA_DISTANCE = 1.5;
const EPSILON = 1e-4;

const computeScaleFactor = (maxDimension: number) => {
  const safeDimension = Math.max(maxDimension, Number.EPSILON);
  const rawScale = TARGET_MODEL_SIZE / safeDimension;
  return Math.min(
    rawScale * MODEL_SCALE_MULTIPLIER,
    MAX_MODEL_UPSCALE * MODEL_SCALE_MULTIPLIER
  );
};

const arraysAlmostEqual = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length &&
  a.every((value, index) => Math.abs(value - b[index]) < EPSILON);

const cameraStatesEqual = (a: Model3DCameraState, b: Model3DCameraState) =>
  arraysAlmostEqual(a.position, b.position) &&
  arraysAlmostEqual(a.target, b.target) &&
  arraysAlmostEqual(a.up, b.up);

// 3D模型组件
function Model3D({
  modelPath,
  onLoaded,
}: {
  modelPath: string;
  onLoaded?: (boundingBox: THREE.Box3) => void;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(modelPath);
  const [autoScale, setAutoScale] = useState<[number, number, number]>([
    1, 1, 1,
  ]);
  const [baseScaleFactor, setBaseScaleFactor] = useState<number>(1);
  const clonedSceneRef = useRef<THREE.Object3D | null>(null);

  // 清理Three.js资源的工具函数
  const disposeThreeObject = (object: THREE.Object3D) => {
    object.traverse((child) => {
      if (child.type === "Mesh") {
        const mesh = child as THREE.Mesh;

        // 清理几何体
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }

        // 清理材质
        if (mesh.material) {
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          materials.forEach((material) => {
            if (material && typeof material.dispose === "function") {
              const materialAny = material as any;
              if (
                materialAny.map &&
                typeof materialAny.map.dispose === "function"
              ) {
                materialAny.map.dispose();
              }
              if (
                materialAny.normalMap &&
                typeof materialAny.normalMap.dispose === "function"
              ) {
                materialAny.normalMap.dispose();
              }
              if (
                materialAny.roughnessMap &&
                typeof materialAny.roughnessMap.dispose === "function"
              ) {
                materialAny.roughnessMap.dispose();
              }
              if (
                materialAny.metalnessMap &&
                typeof materialAny.metalnessMap.dispose === "function"
              ) {
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
      const warmTone = new THREE.Color("#fff4d5");

      const boostColor = (color: THREE.Color, factor: number) => {
        color.setRGB(
          Math.min(1, color.r * factor),
          Math.min(1, color.g * factor),
          Math.min(1, color.b * factor)
        );
      };

      const saturateColor = (color: THREE.Color, strength: number) => {
        const hsl = { h: 0, s: 0, l: 0 };
        color.getHSL(hsl);
        hsl.s = THREE.MathUtils.clamp(hsl.s * (1 + strength), 0, 1);
        color.setHSL(hsl.h, hsl.s, hsl.l);
      };

      // 遍历场景中的所有材质，只对过暗/过灰的材质进行轻微调整，保持原始颜色
      clonedScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.material) {
            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            materials.forEach((material) => {
              // 处理所有类型的材质
              if (
                material instanceof THREE.MeshStandardMaterial ||
                material instanceof THREE.MeshPhysicalMaterial ||
                material instanceof THREE.MeshLambertMaterial ||
                material instanceof THREE.MeshPhongMaterial ||
                material instanceof THREE.MeshBasicMaterial
              ) {
                // 检查材质是否过暗（接近黑色）或整体偏灰
                if (material.color) {
                  const avgBrightness =
                    (material.color.r + material.color.g + material.color.b) /
                    3;

                  if (avgBrightness < 0.18) {
                    boostColor(material.color, 1.85);
                    material.color.lerp(warmTone, 0.45);
                    saturateColor(material.color, 0.45);
                  } else if (avgBrightness < 0.45) {
                    boostColor(material.color, 1.35);
                    material.color.lerp(warmTone, 0.25);
                    saturateColor(material.color, 0.3);
                  } else if (avgBrightness < 0.8) {
                    boostColor(material.color, 1.12);
                    material.color.lerp(warmTone, 0.1);
                    saturateColor(material.color, 0.15);
                  } else {
                    // 保持亮色材质原有层次，只微调对比度
                    boostColor(material.color, 1.02);
                    saturateColor(material.color, 0.05);
                  }
                }
                // 只添加非常轻微的自发光，不影响颜色（主要用于避免整块区域死黑）
                if ("emissive" in material) {
                  // 使用材质的原始颜色作为自发光基础，但强度很低
                  if (material.color) {
                    material.emissive = material.color
                      .clone()
                      .multiplyScalar(0.09);
                  } else {
                    material.emissive = new THREE.Color(0x151515);
                  }
                  if ("emissiveIntensity" in material) {
                    (material as any).emissiveIntensity = 0.1;
                  }
                }

                // 对 PBR 材质做一点点「更有光泽」的统一微调
                if (
                  material instanceof THREE.MeshStandardMaterial ||
                  material instanceof THREE.MeshPhysicalMaterial
                ) {
                  if (typeof material.metalness === "number") {
                    const baseMetalness = Number.isFinite(material.metalness)
                      ? material.metalness
                      : 0;
                    material.metalness = THREE.MathUtils.clamp(
                      baseMetalness * 0.45 + 0.04,
                      0,
                      0.35
                    );
                  }
                  if (typeof material.roughness === "number") {
                    const baseRoughness = Number.isFinite(material.roughness)
                      ? material.roughness
                      : 0.5;
                    const nextRoughness = baseRoughness * 1.15 + 0.12;
                    material.roughness = THREE.MathUtils.clamp(
                      nextRoughness,
                      0.4,
                      0.96
                    );
                  }
                  if ("envMapIntensity" in material) {
                    (material as any).envMapIntensity = 0.7;
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

  // 模型缩放：只使用基础缩放因子，不随容器大小变化
  // 容器大小变化只影响可视区域，不影响模型本身的缩放
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    // 基础缩放 = baseScaleFactor * BASELINE_SCALE_MULTIPLIER
    // 模型大小固定，不随容器缩放而变化
    const baselineScale = baseScaleFactor * BASELINE_SCALE_MULTIPLIER;

    // 首次挂载或 baseScaleFactor 变化时设置缩放
    if (isInitialMountRef.current || baseScaleFactor > 0) {
      isInitialMountRef.current = false;
      setAutoScale([baselineScale, baselineScale, baselineScale]);
    }
  }, [baseScaleFactor]);

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
  drawMode = "select",
  onCameraChange,
  isResizing = false,
}) => {
  const devicePixelRatio =
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const maxDpr = Math.min(devicePixelRatio, 1.75);
  const [cameraState, setCameraState] = useState<Model3DCameraState>(
    () =>
      modelData.camera ?? {
        position: [4, 4, 4],
        target: [0, 0, 0],
        up: [0, 1, 0],
      }
  );
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
    if (
      lastCameraStateRef.current &&
      cameraStatesEqual(cameraState, lastCameraStateRef.current)
    ) {
      return;
    }

    lastCameraStateRef.current = cameraState;

    if (!onCameraChangeRef.current) return;
    if (cameraChangeFrameRef.current)
      cancelAnimationFrame(cameraChangeFrameRef.current);
    cameraChangeFrameRef.current = requestAnimationFrame(() => {
      if (onCameraChangeRef.current) {
        const now = performance.now();
        if (now - lastCameraEmitRef.current > 1000 / 15) {
          // 约15fps推送到外部，降低渲染震动
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
    modelData.camera?.position?.join(","),
    modelData.camera?.target?.join(","),
    modelData.camera?.up?.join(","),
  ]);

  const handleModelLoaded = (boundingBox: THREE.Box3) => {
    setIsLoading(false);

    if (!hasCustomCameraRef.current) {
      const size = boundingBox.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);
      const scaleFactor = computeScaleFactor(maxDimension);
      const scaledMaxDimension = maxDimension * scaleFactor;
      const distance = Math.max(
        scaledMaxDimension * CAMERA_DISTANCE_MULTIPLIER,
        MIN_CAMERA_DISTANCE
      );
      const defaultState: Model3DCameraState = {
        position: [distance, distance, distance],
        target: [0, 0, 0],
        up: [0, 1, 0],
      };
      setCameraState(defaultState);
    }
  };

  useEffect(
    () => () => {
      if (import.meta.env.DEV) {
        logger.debug("Model3DViewer组件卸载，清理3D资源");
      }
    },
    []
  );

  const pointerEvents = drawMode === "select" || isSelected ? "auto" : "none";
  const controlsEnabled = drawMode === "select" && isSelected;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        border: "none",
        borderRadius: "0",
        overflow: "visible", // 允许3D模型超出容器显示，不裁剪
        backgroundColor: "transparent",
        padding: 0,
        margin: 0,
        boxSizing: "border-box",
      }}
    >
      {error ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            color: "#ef4444",
            fontSize: "14px",
            textAlign: "center",
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
              far: 1000,
            }}
            dpr={[1, maxDpr]}
            gl={{
              alpha: true,
              antialias: true,
              preserveDrawingBuffer: true,
              powerPreference: "high-performance",
              toneMapping: THREE.ACESFilmicToneMapping,
              // 提高曝光，让环境更明亮通透
              toneMappingExposure: 1.25,
              outputColorSpace: THREE.SRGBColorSpace,
            }}
            style={{
              background: "transparent",
              pointerEvents,
            }}
          >
            <Suspense fallback={null}>
              {/* 更通透的光照组合：微暖环境光 + 半球光 + 多向主辅光 + 前向聚光 */}
              <ambientLight color='#fff9ef' intensity={1.0} />
              {/* 天空偏中性、地面略微冷一点，避免整体发灰 */}
              <hemisphereLight args={["#ffffff", "#a8b9ce", 1.3]} />
              <directionalLight
                position={[6, 8, 6]}
                // 主光略暖，增强体积感
                intensity={1.15}
                color='#fff4d6'
                castShadow
              />
              <directionalLight
                position={[-6, 6, -4]}
                // 辅光略冷，增加对比和边缘轮廓
                intensity={0.55}
                color='#d1e7ff'
              />
              <directionalLight
                position={[0, 5, 10]}
                intensity={0.7}
                color='#ffffff'
              />
              <pointLight
                position={[0, 7, 0]}
                intensity={0.5}
                color='#ffffff'
              />
              <pointLight
                position={[2, 3, -3]}
                intensity={0.35}
                color='#fff6da'
              />
              <pointLight
                position={[-2, 2, 3]}
                intensity={0.32}
                color='#e8f2ff'
              />

              <Model3D
                modelPath={modelData.url || ""}
                onLoaded={handleModelLoaded}
              />

              <CameraController
                cameraState={cameraState}
                enabled={controlsEnabled}
                onStateChange={setCameraState}
              />
            </Suspense>
          </Canvas>

          {isLoading && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                color: "#374151",
                fontSize: "14px",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ marginBottom: "8px" }}>🔄</div>
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

const CameraController: React.FC<CameraControllerProps> = ({
  cameraState,
  onStateChange,
  enabled,
}) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();
  // 使用ref存储最新的cameraState，避免在handleControlChange中依赖它导致无限循环
  const cameraStateRef = useRef<Model3DCameraState>(cameraState);
  const isUpdatingFromPropsRef = useRef(false);
  const lastControlEmitRef = useRef(0);

  useEffect(() => {
    cameraStateRef.current = cameraState;
  }, [cameraState]);

  const applyCameraState = useCallback(
    (state: Model3DCameraState) => {
      isUpdatingFromPropsRef.current = true;
      camera.position.set(
        state.position[0],
        state.position[1],
        state.position[2]
      );
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
    },
    [camera]
  );

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
      if (typeof React.startTransition === "function") {
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
        LEFT: THREE.MOUSE.ROTATE, // 左键旋转
        MIDDLE: THREE.MOUSE.DOLLY, // 中键缩放（鼠标滚轮）
        RIGHT: THREE.MOUSE.PAN, // 右键在3D空间中平移模型
      }}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
      makeDefault
      enabled={enabled}
      onChange={handleControlChange}
    />
  );
};
