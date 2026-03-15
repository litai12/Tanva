// @ts-nocheck
import React from "react";
import {
  Handle,
  Position,
  NodeResizer,
  useStore,
  type ReactFlowState,
  type Node,
} from "reactflow";
import * as THREE from "three";
import { Send as SendIcon, Copy, Check, RotateCcw } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { parseFlowImageAssetRef } from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { toRenderableImageSrc } from "@/utils/imageSource";
import { useLocaleText } from "@/utils/localeText";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    imageData?: string;
    imageUrl?: string;
    thumbnail?: string;
    error?: string;
    generatedPrompt?: string;
    promptSuffix?: string;
    azimuth?: number;
    elevation?: number;
    distance?: number;
    zoom?: number;
    sceneYaw?: number;
    directionId?: string;
    verticalId?: string;
    shotId?: string;
    lensId?: string;
    boxW?: number;
    boxH?: number;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

type Preset = {
  id: string;
  labelZh: string;
  labelEn: string;
  prompt: string;
  value: number;
};

const DIRECTION_PRESETS: Preset[] = [
  {
    id: "frontal",
    labelZh: "正面",
    labelEn: "frontal",
    prompt: "frontal",
    value: 0,
  },
  {
    id: "front-right-quarter",
    labelZh: "右前45°",
    labelEn: "right quarter",
    prompt: "right quarter",
    value: 45,
  },
  {
    id: "rightside",
    labelZh: "右侧",
    labelEn: "rightside",
    prompt: "rightside",
    value: 90,
  },
  {
    id: "back-right-quarter",
    labelZh: "右后45°",
    labelEn: "back-right quarter",
    prompt: "back-right quarter",
    value: 135,
  },
  {
    id: "back",
    labelZh: "背面",
    labelEn: "back",
    prompt: "back",
    value: 180,
  },
  {
    id: "back-left-quarter",
    labelZh: "左后45°",
    labelEn: "left-back quarter",
    prompt: "left-back quarter",
    value: -135,
  },
  {
    id: "leftside",
    labelZh: "左侧",
    labelEn: "leftside",
    prompt: "leftside",
    value: -90,
  },
  {
    id: "front-left-quarter",
    labelZh: "左前45°",
    labelEn: "left quarter",
    prompt: "left quarter",
    value: -45,
  },
];

const VERTICAL_PRESETS: Preset[] = [
  {
    id: "low-angle",
    labelZh: "仰拍",
    labelEn: "low-angle",
    prompt: "low-angle",
    value: -55,
  },
  {
    id: "mid-low-angle",
    labelZh: "轻仰拍",
    labelEn: "mid-low-angle",
    prompt: "mid-low-angle",
    value: -28,
  },
  {
    id: "eye-level",
    labelZh: "平视",
    labelEn: "eye-level",
    prompt: "eye-level",
    value: 0,
  },
  {
    id: "mid-angle",
    labelZh: "微俯",
    labelEn: "mid-angle",
    prompt: "mid-angle",
    value: 22,
  },
  {
    id: "high-angle",
    labelZh: "俯拍",
    labelEn: "high-angle",
    prompt: "high-angle",
    value: 40,
  },
  {
    id: "steep-mid",
    labelZh: "高俯",
    labelEn: "steep-mid",
    prompt: "steep-mid",
    value: 63,
  },
  {
    id: "overhead",
    labelZh: "顶视",
    labelEn: "overhead",
    prompt: "overhead",
    value: 82,
  },
];

const SHOT_PRESETS: Preset[] = [
  {
    id: "close-up",
    labelZh: "特写",
    labelEn: "close-up",
    prompt: "close-up",
    value: 1.5,
  },
  {
    id: "medium-close-up",
    labelZh: "近景",
    labelEn: "medium close-up",
    prompt: "medium close-up",
    value: 2.6,
  },
  {
    id: "cowboy-shot",
    labelZh: "牛仔景",
    labelEn: "cowboy shot",
    prompt: "cowboy shot",
    value: 3.7,
  },
  {
    id: "full-body-shot",
    labelZh: "全身",
    labelEn: "full body shot",
    prompt: "full body shot",
    value: 4.9,
  },
];

const LENS_PRESETS: Preset[] = [
  {
    id: "fisheye",
    labelZh: "鱼眼",
    labelEn: "fisheye",
    prompt: "fisheye",
    value: 0.6,
  },
  {
    id: "wide-angle",
    labelZh: "广角",
    labelEn: "wide angle",
    prompt: "wide angle",
    value: 0.9,
  },
  {
    id: "standard",
    labelZh: "标准",
    labelEn: "standard",
    prompt: "standard",
    value: 1.2,
  },
  {
    id: "telephoto",
    labelZh: "长焦",
    labelEn: "telephoto",
    prompt: "telephoto",
    value: 1.9,
  },
  {
    id: "super-telephoto",
    labelZh: "超长焦",
    labelEn: "super-telephoto",
    prompt: "super-telephoto",
    value: 2.6,
  },
];

const FALLBACK_SIZE = { width: 420, height: 560 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeDeg = (value: number) => {
  let next = value;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
};

const toFixedNumber = (value: number, fractionDigits = 1) =>
  Number(value.toFixed(fractionDigits));

const buildImageSrc = (value?: string): string | undefined => {
  if (!value || typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toRenderableImageSrc(trimmed) || undefined;
};

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (isString(value)) return value.trim();
  }
  return undefined;
};

const pickClosestPreset = (presets: Preset[], value: number): Preset => {
  let best = presets[0];
  let bestDiff = Math.abs(presets[0].value - value);
  for (let i = 1; i < presets.length; i += 1) {
    const diff = Math.abs(presets[i].value - value);
    if (diff < bestDiff) {
      best = presets[i];
      bestDiff = diff;
    }
  }
  return best;
};

const directionFromAzimuth = (azimuth: number): Preset => {
  const normalized = normalizeDeg(azimuth);
  if (normalized >= -22.5 && normalized < 22.5) return DIRECTION_PRESETS[0];
  if (normalized >= 22.5 && normalized < 67.5) return DIRECTION_PRESETS[1];
  if (normalized >= 67.5 && normalized < 112.5) return DIRECTION_PRESETS[2];
  if (normalized >= 112.5 && normalized < 157.5) return DIRECTION_PRESETS[3];
  if (normalized >= 157.5 || normalized < -157.5) return DIRECTION_PRESETS[4];
  if (normalized >= -157.5 && normalized < -112.5) return DIRECTION_PRESETS[5];
  if (normalized >= -112.5 && normalized < -67.5) return DIRECTION_PRESETS[6];
  return DIRECTION_PRESETS[7];
};

const verticalFromElevation = (elevation: number): Preset => {
  const v = clamp(elevation, -90, 90);
  if (v <= -42) return VERTICAL_PRESETS[0];
  if (v <= -14) return VERTICAL_PRESETS[1];
  if (v <= 12) return VERTICAL_PRESETS[2];
  if (v <= 30) return VERTICAL_PRESETS[3];
  if (v <= 52) return VERTICAL_PRESETS[4];
  if (v <= 72) return VERTICAL_PRESETS[5];
  return VERTICAL_PRESETS[6];
};

const shotFromDistance = (distance: number): Preset => {
  if (distance <= 2.0) return SHOT_PRESETS[0];
  if (distance <= 3.1) return SHOT_PRESETS[1];
  if (distance <= 4.3) return SHOT_PRESETS[2];
  return SHOT_PRESETS[3];
};

const lensFromZoom = (zoom: number): Preset => {
  if (zoom < 0.75) return LENS_PRESETS[0];
  if (zoom < 1.05) return LENS_PRESETS[1];
  if (zoom < 1.6) return LENS_PRESETS[2];
  if (zoom < 2.25) return LENS_PRESETS[3];
  return LENS_PRESETS[4];
};

function ViewAngleNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();

  const patchNodeData = React.useCallback(
    (patch: Record<string, unknown>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  const controlsRef = React.useRef({
    azimuth: 45,
    elevation: 0,
    distance: 4,
    zoom: 1,
    sceneYaw: 0,
  });

  const controlValues = React.useMemo(() => {
    const azimuth = normalizeDeg(
      Number.isFinite(Number(data.azimuth)) ? Number(data.azimuth) : 45
    );
    const elevation = clamp(
      Number.isFinite(Number(data.elevation)) ? Number(data.elevation) : 0,
      -90,
      90
    );
    const distance = clamp(
      Number.isFinite(Number(data.distance)) ? Number(data.distance) : 4,
      1,
      8
    );
    const zoom = clamp(
      Number.isFinite(Number(data.zoom)) ? Number(data.zoom) : 1,
      0.5,
      3
    );
    const sceneYaw = normalizeDeg(
      Number.isFinite(Number(data.sceneYaw)) ? Number(data.sceneYaw) : 0
    );
    return { azimuth, elevation, distance, zoom, sceneYaw };
  }, [data.azimuth, data.elevation, data.distance, data.zoom, data.sceneYaw]);

  React.useEffect(() => {
    controlsRef.current = controlValues;
  }, [controlValues]);

  const connectedImageRaw = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edge = state.edges.find(
          (item) => item.target === id && item.targetHandle === "img"
        );
        if (!edge) return undefined;
        const sourceNode = state.getNodes().find((node: Node<any>) => node.id === edge.source);
        if (!sourceNode) return undefined;

        const sourceData = (sourceNode.data || {}) as Record<string, any>;
        const sourceHandle = (edge.sourceHandle || "").trim();

        if (sourceNode.type === "generate4" || sourceNode.type === "generatePro4") {
          const idx = sourceHandle.startsWith("img")
            ? Math.max(0, Math.min(3, Number(sourceHandle.slice(3)) - 1))
            : 0;
          return firstString(
            Array.isArray(sourceData.imageUrls) ? sourceData.imageUrls[idx] : undefined,
            Array.isArray(sourceData.images) ? sourceData.images[idx] : undefined,
            sourceData.imageUrl,
            sourceData.imageData
          );
        }

        if (sourceNode.type === "imageSplit" && /^image\d+$/i.test(sourceHandle)) {
          const idx = Math.max(0, Number(sourceHandle.replace(/[^0-9]/g, "")) - 1);
          const item = Array.isArray(sourceData.splitImages)
            ? sourceData.splitImages[idx]
            : undefined;
          return firstString(item?.imageUrl, item?.imageData);
        }

        if (sourceNode.type === "videoFrameExtract") {
          if (sourceHandle === "image") {
            return firstString(sourceData.imageUrl, sourceData.imageData);
          }
          const firstFrame = Array.isArray(sourceData.frames)
            ? sourceData.frames.find((frame: any) => firstString(frame?.imageUrl, frame?.imageData))
            : undefined;
          return firstString(firstFrame?.imageUrl, firstFrame?.imageData);
        }

        return firstString(
          sourceData.imageUrl,
          sourceData.imageData,
          sourceData.outputImage,
          Array.isArray(sourceData.imageUrls) ? sourceData.imageUrls[0] : undefined,
          Array.isArray(sourceData.images) ? sourceData.images[0] : undefined,
          sourceData.thumbnail
        );
      },
      [id]
    )
  );

  const hasImageConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.some(
          (item) => item.target === id && item.targetHandle === "img"
        ),
      [id]
    )
  );

  const sourceAssetId = React.useMemo(
    () => parseFlowImageAssetRef(connectedImageRaw),
    [connectedImageRaw]
  );
  const sourceAssetUrl = useFlowImageAssetUrl(sourceAssetId);
  const sourcePreviewSrc = React.useMemo(
    () =>
      sourceAssetId
        ? sourceAssetUrl || undefined
        : buildImageSrc(connectedImageRaw),
    [connectedImageRaw, sourceAssetId, sourceAssetUrl]
  );

  const rawResultValue = data.imageData || data.imageUrl;
  const resultAssetId = React.useMemo(
    () => parseFlowImageAssetRef(rawResultValue),
    [rawResultValue]
  );
  const resultAssetUrl = useFlowImageAssetUrl(resultAssetId);
  const resultFullSrc = React.useMemo(
    () =>
      resultAssetId ? resultAssetUrl || undefined : buildImageSrc(rawResultValue),
    [rawResultValue, resultAssetId, resultAssetUrl]
  );

  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(
    () => parseFlowImageAssetRef(rawThumbValue),
    [rawThumbValue]
  );
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const resultDisplaySrc = React.useMemo(
    () =>
      thumbAssetId
        ? thumbAssetUrl || resultFullSrc
        : buildImageSrc(rawThumbValue) || resultFullSrc,
    [thumbAssetId, thumbAssetUrl, rawThumbValue, resultFullSrc]
  );

  const directionPreset = React.useMemo(() => {
    const manual = DIRECTION_PRESETS.find((item) => item.id === data.directionId);
    return manual || directionFromAzimuth(controlValues.azimuth);
  }, [data.directionId, controlValues.azimuth]);

  const verticalPreset = React.useMemo(() => {
    const manual = VERTICAL_PRESETS.find((item) => item.id === data.verticalId);
    return manual || verticalFromElevation(controlValues.elevation);
  }, [data.verticalId, controlValues.elevation]);

  const shotPreset = React.useMemo(() => {
    const manual = SHOT_PRESETS.find((item) => item.id === data.shotId);
    return manual || shotFromDistance(controlValues.distance);
  }, [data.shotId, controlValues.distance]);

  const lensPreset = React.useMemo(() => {
    const manual = LENS_PRESETS.find((item) => item.id === data.lensId);
    return manual || lensFromZoom(controlValues.zoom);
  }, [data.lensId, controlValues.zoom]);

  const promptSuffix = typeof data.promptSuffix === "string" ? data.promptSuffix : "";
  const sksPrompt = React.useMemo(
    () =>
      `<sks>, ${directionPreset.prompt}, ${verticalPreset.prompt}, ${shotPreset.prompt}, ${lensPreset.prompt} lens`,
    [
      directionPreset.prompt,
      verticalPreset.prompt,
      shotPreset.prompt,
      lensPreset.prompt,
    ]
  );
  const builtInPrompt = React.useMemo(
    () => `Redraw this image and change the perspective, ${sksPrompt}`,
    [sksPrompt]
  );
  const displayPrompt = React.useMemo(() => {
    const suffix = promptSuffix.trim();
    return suffix ? `${sksPrompt}, ${suffix}` : sksPrompt;
  }, [sksPrompt, promptSuffix]);

  React.useEffect(() => {
    const patch: Record<string, unknown> = {};

    if (!Number.isFinite(Number(data.azimuth))) patch.azimuth = 45;
    if (!Number.isFinite(Number(data.elevation))) patch.elevation = 0;
    if (!Number.isFinite(Number(data.distance))) patch.distance = 4;
    if (!Number.isFinite(Number(data.zoom))) patch.zoom = 1;
    if (!Number.isFinite(Number(data.sceneYaw))) patch.sceneYaw = 0;

    if ((data.generatedPrompt || "") !== builtInPrompt) {
      patch.generatedPrompt = builtInPrompt;
    }

    if ((data.directionId || "") !== directionPreset.id) {
      patch.directionId = directionPreset.id;
    }

    if ((data.verticalId || "") !== verticalPreset.id) {
      patch.verticalId = verticalPreset.id;
    }

    if ((data.shotId || "") !== shotPreset.id) {
      patch.shotId = shotPreset.id;
    }

    if ((data.lensId || "") !== lensPreset.id) {
      patch.lensId = lensPreset.id;
    }

    if (Object.keys(patch).length > 0) {
      patchNodeData(patch);
    }
  }, [
    data.azimuth,
    data.elevation,
    data.distance,
    data.zoom,
    data.sceneYaw,
    data.generatedPrompt,
    data.directionId,
    data.verticalId,
    data.shotId,
    data.lensId,
    builtInPrompt,
    directionPreset.id,
    verticalPreset.id,
    shotPreset.id,
    lensPreset.id,
    patchNodeData,
  ]);

  const rendererContainerRef = React.useRef<HTMLDivElement | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const previewCameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const rootGroupRef = React.useRef<THREE.Group | null>(null);
  const virtualCameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const virtualCameraHelperRef = React.useRef<THREE.CameraHelper | null>(null);
  const cameraLineRef = React.useRef<THREE.Line | null>(null);
  const subjectMeshRef = React.useRef<THREE.Mesh | null>(null);
  const textureRef = React.useRef<THREE.Texture | null>(null);
  const renderPendingRef = React.useRef<number | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);

  const renderNow = React.useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = previewCameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
  }, []);

  const requestRender = React.useCallback(() => {
    if (renderPendingRef.current !== null) return;
    renderPendingRef.current = requestAnimationFrame(() => {
      renderPendingRef.current = null;
      renderNow();
    });
  }, [renderNow]);

  const syncRendererSize = React.useCallback(() => {
    const container = rendererContainerRef.current;
    const renderer = rendererRef.current;
    const camera = previewCameraRef.current;
    if (!container || !renderer || !camera) return;

    const width = Math.max(1, Math.floor(container.clientWidth));
    const height = Math.max(1, Math.floor(container.clientHeight));

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }, [requestRender]);

  React.useEffect(() => {
    const container = rendererContainerRef.current;
    if (!container || rendererRef.current) return;

    const width = Math.max(1, Math.floor(container.clientWidth || 320));
    const height = Math.max(1, Math.floor(container.clientHeight || 220));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8fafc");

    const previewCamera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    previewCamera.position.set(3.3, 2.2, 4.1);
    previewCamera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    try {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch {}
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight("#ffffff", 0.95);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight("#f8fafc", 0.92);
    keyLight.position.set(3, 4, 2.5);
    scene.add(keyLight);

    const backLight = new THREE.DirectionalLight("#60a5fa", 0.5);
    backLight.position.set(-3, 2, -4);
    scene.add(backLight);

    const grid = new THREE.GridHelper(8, 24, "#93c5fd", "#dbeafe");
    grid.position.y = -1.2;
    scene.add(grid);

    const root = new THREE.Group();
    scene.add(root);

    const subjectMaterial = new THREE.MeshStandardMaterial({
      color: "#d1d5db",
      side: THREE.DoubleSide,
      roughness: 0.35,
      metalness: 0.05,
    });
    const subject = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.85), subjectMaterial);
    subject.position.set(0, 0, 0);
    root.add(subject);

    const verticalRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.32, 0.012, 16, 180),
      new THREE.MeshBasicMaterial({ color: "#34d399", transparent: true, opacity: 0.65 })
    );
    verticalRing.rotation.y = Math.PI / 2;
    root.add(verticalRing);

    const horizontalRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.32, 0.012, 16, 180),
      new THREE.MeshBasicMaterial({ color: "#f472b6", transparent: true, opacity: 0.72 })
    );
    horizontalRing.rotation.x = Math.PI / 2;
    root.add(horizontalRing);

    const virtualCamera = new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 2.3);
    const cameraHelper = new THREE.CameraHelper(virtualCamera);
    try {
      cameraHelper.setColors(
        new THREE.Color("#facc15"),
        new THREE.Color("#facc15"),
        new THREE.Color("#facc15"),
        new THREE.Color("#fde68a"),
        new THREE.Color("#fef08a")
      );
    } catch {}
    root.add(cameraHelper);

    const cameraLineGeometry = new THREE.BufferGeometry();
    cameraLineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)
    );
    const cameraLine = new THREE.Line(
      cameraLineGeometry,
      new THREE.LineBasicMaterial({ color: "#facc15", transparent: true, opacity: 0.9 })
    );
    root.add(cameraLine);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    previewCameraRef.current = previewCamera;
    rootGroupRef.current = root;
    virtualCameraRef.current = virtualCamera;
    virtualCameraHelperRef.current = cameraHelper;
    cameraLineRef.current = cameraLine;
    subjectMeshRef.current = subject;

    try {
      resizeObserverRef.current = new ResizeObserver(() => {
        syncRendererSize();
      });
      resizeObserverRef.current.observe(container);
    } catch {
      resizeObserverRef.current = null;
    }

    requestRender();

    return () => {
      if (renderPendingRef.current !== null) {
        cancelAnimationFrame(renderPendingRef.current);
        renderPendingRef.current = null;
      }

      if (resizeObserverRef.current) {
        try {
          resizeObserverRef.current.disconnect();
        } catch {}
        resizeObserverRef.current = null;
      }

      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }

      if (sceneRef.current) {
        sceneRef.current.traverse((obj: any) => {
          if (obj.isMesh) {
            obj.geometry?.dispose?.();
            if (Array.isArray(obj.material)) {
              obj.material.forEach((material: any) => material?.dispose?.());
            } else {
              obj.material?.dispose?.();
            }
          }
          if (obj.isLine) {
            obj.geometry?.dispose?.();
            obj.material?.dispose?.();
          }
        });
      }

      if (rendererRef.current) {
        try {
          rendererRef.current.dispose();
          if (rendererRef.current.domElement.parentNode) {
            rendererRef.current.domElement.parentNode.removeChild(
              rendererRef.current.domElement
            );
          }
        } catch {}
      }

      sceneRef.current = null;
      rendererRef.current = null;
      previewCameraRef.current = null;
      rootGroupRef.current = null;
      virtualCameraRef.current = null;
      virtualCameraHelperRef.current = null;
      cameraLineRef.current = null;
      subjectMeshRef.current = null;
    };
  }, [requestRender, syncRendererSize]);

  React.useEffect(() => {
    const root = rootGroupRef.current;
    const virtualCamera = virtualCameraRef.current;
    const cameraHelper = virtualCameraHelperRef.current;
    const cameraLine = cameraLineRef.current;
    if (!root || !virtualCamera || !cameraHelper || !cameraLine) return;

    root.rotation.y = THREE.MathUtils.degToRad(controlValues.sceneYaw);

    const azimuthRad = THREE.MathUtils.degToRad(controlValues.azimuth);
    const elevationRad = THREE.MathUtils.degToRad(controlValues.elevation);
    const distance = controlValues.distance;

    const position = new THREE.Vector3(
      Math.sin(azimuthRad) * Math.cos(elevationRad) * distance,
      Math.sin(elevationRad) * distance,
      Math.cos(azimuthRad) * Math.cos(elevationRad) * distance
    );

    const fov = clamp(62 / Math.max(controlValues.zoom, 0.5), 18, 110);

    virtualCamera.position.copy(position);
    virtualCamera.fov = fov;
    virtualCamera.aspect = 16 / 9;
    virtualCamera.near = 0.3;
    virtualCamera.far = 2.3;
    virtualCamera.lookAt(0, 0, 0);
    virtualCamera.updateProjectionMatrix();
    cameraHelper.update();

    const attr = cameraLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(0, position.x, position.y, position.z);
    attr.setXYZ(1, 0, 0, 0);
    attr.needsUpdate = true;
    cameraLine.geometry.computeBoundingSphere();

    requestRender();
  }, [controlValues, requestRender]);

  React.useEffect(() => {
    const subject = subjectMeshRef.current;
    const meshMaterial = subject?.material as THREE.MeshStandardMaterial | undefined;
    if (!subject || !meshMaterial) return;

    if (textureRef.current) {
      textureRef.current.dispose();
      textureRef.current = null;
    }

    if (!sourcePreviewSrc) {
      meshMaterial.map = null;
      meshMaterial.color.set("#cbd5e1");
      meshMaterial.needsUpdate = true;
      subject.scale.set(1, 1, 1);
      requestRender();
      return;
    }

    let canceled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      sourcePreviewSrc,
      (texture) => {
        if (canceled) {
          texture.dispose();
          return;
        }

        try {
          texture.colorSpace = THREE.SRGBColorSpace;
        } catch {}

        textureRef.current = texture;
        meshMaterial.map = texture;
        meshMaterial.color.set("#ffffff");
        meshMaterial.needsUpdate = true;

        const image = texture.image as { width?: number; height?: number };
        const width = image?.width || 1;
        const height = image?.height || 1;
        const aspect = Math.max(0.1, width / Math.max(height, 1));

        if (aspect >= 1) {
          subject.scale.set(1.12, 1.12 / aspect, 1);
        } else {
          subject.scale.set(1.12 * aspect, 1.12, 1);
        }

        requestRender();
      },
      undefined,
      () => {
        if (canceled) return;
        meshMaterial.map = null;
        meshMaterial.color.set("#cbd5e1");
        meshMaterial.needsUpdate = true;
        subject.scale.set(1, 1, 1);
        requestRender();
      }
    );

    return () => {
      canceled = true;
    };
  }, [sourcePreviewSrc, requestRender]);

  const dragRef = React.useRef<
    | {
        mode: "orbit" | "scene";
        x: number;
        y: number;
      }
    | null
  >(null);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        mode: event.button === 2 ? "scene" : "orbit",
        x: event.clientX,
        y: event.clientY,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
    },
    []
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragRef.current;
      if (!dragState) return;
      event.preventDefault();
      event.stopPropagation();

      const dx = event.clientX - dragState.x;
      const dy = event.clientY - dragState.y;
      dragState.x = event.clientX;
      dragState.y = event.clientY;

      const current = controlsRef.current;

      if (dragState.mode === "scene") {
        const nextSceneYaw = normalizeDeg(current.sceneYaw + dx * 0.36);
        controlsRef.current = { ...current, sceneYaw: nextSceneYaw };
        patchNodeData({ sceneYaw: toFixedNumber(nextSceneYaw) });
        return;
      }

      const nextAzimuth = normalizeDeg(current.azimuth + dx * 0.38);
      const nextElevation = clamp(current.elevation - dy * 0.28, -90, 90);
      controlsRef.current = {
        ...current,
        azimuth: nextAzimuth,
        elevation: nextElevation,
      };
      patchNodeData({
        azimuth: toFixedNumber(nextAzimuth),
        elevation: toFixedNumber(nextElevation),
        directionId: directionFromAzimuth(nextAzimuth).id,
        verticalId: verticalFromElevation(nextElevation).id,
      });
    },
    [patchNodeData]
  );

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  }, []);

  const handleWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const current = controlsRef.current;
      const step = event.deltaY > 0 ? 0.18 : -0.18;
      const nextDistance = clamp(current.distance + step, 1, 8);
      controlsRef.current = { ...current, distance: nextDistance };
      patchNodeData({
        distance: toFixedNumber(nextDistance),
        shotId: shotFromDistance(nextDistance).id,
      });
    },
    [patchNodeData]
  );

  const updateDirection = React.useCallback(
    (value: string) => {
      const preset = DIRECTION_PRESETS.find((item) => item.id === value);
      if (!preset) return;
      controlsRef.current = { ...controlsRef.current, azimuth: preset.value };
      patchNodeData({ azimuth: preset.value, directionId: preset.id });
    },
    [patchNodeData]
  );

  const updateVertical = React.useCallback(
    (value: string) => {
      const preset = VERTICAL_PRESETS.find((item) => item.id === value);
      if (!preset) return;
      controlsRef.current = { ...controlsRef.current, elevation: preset.value };
      patchNodeData({ elevation: preset.value, verticalId: preset.id });
    },
    [patchNodeData]
  );

  const updateShot = React.useCallback(
    (value: string) => {
      const preset = SHOT_PRESETS.find((item) => item.id === value);
      if (!preset) return;
      controlsRef.current = { ...controlsRef.current, distance: preset.value };
      patchNodeData({ distance: preset.value, shotId: preset.id });
    },
    [patchNodeData]
  );

  const updateLens = React.useCallback(
    (value: string) => {
      const preset = LENS_PRESETS.find((item) => item.id === value);
      if (!preset) return;
      controlsRef.current = { ...controlsRef.current, zoom: preset.value };
      patchNodeData({ zoom: preset.value, lensId: preset.id });
    },
    [patchNodeData]
  );

  const onPromptSuffixChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      patchNodeData({ promptSuffix: event.target.value || "" });
    },
    [patchNodeData]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  const resetCamera = React.useCallback(() => {
    controlsRef.current = {
      azimuth: 45,
      elevation: 0,
      distance: 4,
      zoom: 1,
      sceneYaw: 0,
    };
    patchNodeData({
      azimuth: 45,
      elevation: 0,
      distance: 4,
      zoom: 1,
      sceneYaw: 0,
      directionId: pickClosestPreset(DIRECTION_PRESETS, 45).id,
      verticalId: pickClosestPreset(VERTICAL_PRESETS, 0).id,
      shotId: pickClosestPreset(SHOT_PRESETS, 4).id,
      lensId: pickClosestPreset(LENS_PRESETS, 1).id,
    });
  }, [patchNodeData]);

  const [copied, setCopied] = React.useState(false);
  const copyPrompt = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [displayPrompt]);

  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  const boxW = data.boxW || FALLBACK_SIZE.width;
  const boxH = data.boxH || FALLBACK_SIZE.height;
  const status = data.status || "idle";

  return (
    <div
      style={{
        width: boxW,
        height: boxH,
        padding: 10,
        background: "#ffffff",
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        color: "#111827",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
      }}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={360}
        minHeight={460}
        color='transparent'
        lineStyle={{ display: "none" }}
        handleStyle={{
          background: "transparent",
          border: "none",
          width: 12,
          height: 12,
          opacity: 0,
        }}
        onResize={(_, params) =>
          patchNodeData({ boxW: params.width, boxH: params.height })
        }
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>
            {lt("视角变换", "View Angle")}
          </div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>
            {lt("3D 控制生成新机位", "3D camera driven re-view")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={resetCamera}
            className='nodrag nopan nowheel'
            title={lt("重置机位", "Reset camera")}
            style={{
              width: 28,
              height: 26,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              color: "#374151",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={onRun}
            disabled={!hasImageConnection || status === "running"}
            className='nodrag nopan nowheel'
            style={{
              height: 26,
              padding: "0 10px",
              borderRadius: 6,
              border: "none",
              background:
                !hasImageConnection || status === "running"
                  ? "#e5e7eb"
                  : "#111827",
              color: "#ffffff",
              fontSize: 12,
              cursor:
                !hasImageConnection || status === "running"
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {status === "running"
              ? lt("生成中...", "Running...")
              : lt("渲染", "Render")}
          </button>
          <button
            onClick={onSend}
            disabled={!resultFullSrc}
            className='nodrag nopan nowheel'
            title={lt("发送到画布", "Send to canvas")}
            style={{
              width: 30,
              height: 26,
              borderRadius: 6,
              border: "none",
              background: resultFullSrc ? "#111827" : "#e5e7eb",
              color: resultFullSrc ? "#ffffff" : "#9ca3af",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: resultFullSrc ? "pointer" : "not-allowed",
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            overflow: "hidden",
            background: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "#6b7280",
              padding: "6px 8px",
              borderBottom: "1px solid #e5e7eb",
              background: "#f9fafb",
            }}
          >
            {lt("源图", "Source")}
          </div>
          <div
            style={{
              height: 82,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#ffffff",
            }}
          >
            {sourcePreviewSrc ? (
              <SmartImage
                src={sourcePreviewSrc}
                alt='source'
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 11, color: "#6b7280" }}>
                {lt("连接图片输入", "Connect image input")}
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            overflow: "hidden",
            background: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "#6b7280",
              padding: "6px 8px",
              borderBottom: "1px solid #e5e7eb",
              background: "#f9fafb",
            }}
          >
            {lt("结果", "Result")}
          </div>
          <div
            style={{
              height: 82,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#ffffff",
            }}
          >
            {resultDisplaySrc ? (
              <SmartImage
                src={resultDisplaySrc}
                alt='result'
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 11, color: "#6b7280" }}>
                {lt("尚未生成", "No result")}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className='nodrag nopan nowheel'
        style={{
          position: "relative",
          height: 198,
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          overflow: "hidden",
          background: "#f8fafc",
          cursor: dragRef.current
            ? dragRef.current.mode === "scene"
              ? "grabbing"
              : "grabbing"
            : "grab",
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          ref={rendererContainerRef}
          style={{ width: "100%", height: "100%" }}
          className='nodrag nopan nowheel'
        />
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: 10,
            color: "#1e40af",
            background: "rgba(239,246,255,0.94)",
            border: "1px solid rgba(147,197,253,0.9)",
            borderRadius: 999,
            padding: "3px 8px",
          }}
        >
          {lt("左拖方位/俯仰 · 滚轮距离 · 右拖场景", "L-drag orbit · wheel distance · R-drag scene")}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10, color: "#6b7280" }}>H</span>
          <select
            value={directionPreset.id}
            onChange={(event) => updateDirection(event.target.value)}
            className='nodrag nopan nowheel'
            style={{
              height: 28,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              color: "#111827",
              fontSize: 12,
              padding: "0 8px",
            }}
          >
            {DIRECTION_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {lt(item.labelZh, item.labelEn)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10, color: "#6b7280" }}>V</span>
          <select
            value={verticalPreset.id}
            onChange={(event) => updateVertical(event.target.value)}
            className='nodrag nopan nowheel'
            style={{
              height: 28,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              color: "#111827",
              fontSize: 12,
              padding: "0 8px",
            }}
          >
            {VERTICAL_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {lt(item.labelZh, item.labelEn)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10, color: "#6b7280" }}>Z</span>
          <select
            value={shotPreset.id}
            onChange={(event) => updateShot(event.target.value)}
            className='nodrag nopan nowheel'
            style={{
              height: 28,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              color: "#111827",
              fontSize: 12,
              padding: "0 8px",
            }}
          >
            {SHOT_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {lt(item.labelZh, item.labelEn)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10, color: "#6b7280" }}>
            {lt("镜头", "Lens")}
          </span>
          <select
            value={lensPreset.id}
            onChange={(event) => updateLens(event.target.value)}
            className='nodrag nopan nowheel'
            style={{
              height: 28,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              color: "#111827",
              fontSize: 12,
              padding: "0 8px",
            }}
          >
            {LENS_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {lt(item.labelZh, item.labelEn)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 6,
        }}
      >
        <div
          style={{
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            padding: "5px 6px",
          }}
        >
          <div style={{ fontSize: 10, color: "#6b7280" }}>AZ</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{toFixedNumber(controlValues.azimuth)}°</div>
        </div>
        <div
          style={{
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            padding: "5px 6px",
          }}
        >
          <div style={{ fontSize: 10, color: "#6b7280" }}>EL</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{toFixedNumber(controlValues.elevation)}°</div>
        </div>
        <div
          style={{
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            padding: "5px 6px",
          }}
        >
          <div style={{ fontSize: 10, color: "#6b7280" }}>{lt("距离", "Dist")}</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{toFixedNumber(controlValues.distance)}</div>
        </div>
        <div
          style={{
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            padding: "5px 6px",
          }}
        >
          <div style={{ fontSize: 10, color: "#6b7280" }}>{lt("缩放", "Zoom")}</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{toFixedNumber(controlValues.zoom)}</div>
        </div>
      </div>

      <div
        style={{
          border: "1px solid rgba(16,185,129,0.28)",
          background: "#ecfdf5",
          borderRadius: 7,
          padding: 7,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "#047857",
            lineHeight: 1.35,
            flex: 1,
            minWidth: 0,
            wordBreak: "break-word",
          }}
        >
          {displayPrompt}
        </div>
        <button
          onClick={copyPrompt}
          className='nodrag nopan nowheel'
          title={lt("复制提示词", "Copy prompt")}
          style={{
            width: 28,
            height: 26,
            borderRadius: 6,
            border: "1px solid #a7f3d0",
            background: "#ffffff",
            color: copied ? "#059669" : "#047857",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      <input
        value={promptSuffix}
        onChange={onPromptSuffixChange}
        placeholder={lt("补充提示词（可选）", "Additional prompt (optional)")}
        className='nodrag nopan nowheel'
        style={{
          height: 30,
          borderRadius: 6,
          border: "1px solid #d1d5db",
          background: "#ffffff",
          color: "#111827",
          fontSize: 12,
          padding: "0 8px",
        }}
      />

      <GenerationProgressBar status={status} />
      {status === "failed" && data.error ? (
        <div style={{ fontSize: 12, color: "#f87171", whiteSpace: "pre-wrap" }}>
          {data.error}
        </div>
      ) : null}

      <Handle
        type='target'
        position={Position.Left}
        id='img'
        style={{ top: "44%" }}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='img'
        style={{ top: "44%" }}
      />
    </div>
  );
}

const ViewAngleNode = React.memo(ViewAngleNodeInner);
export default ViewAngleNode;
