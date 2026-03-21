import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Send as SendIcon } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { toRenderableImageSrc } from '@/utils/imageSource';
import { canvasToDataUrl } from '@/utils/imageConcurrency';
import { useLocaleText } from '@/utils/localeText';

type Props = {
  id: string;
  data: {
    imageData?: string;
    imageUrl?: string;
    modelUrl?: string;
    modelName?: string;
    pathTracingEnabled?: boolean;
    forcePathTracing?: boolean;
    nodeTitle?: string;
    boxW?: number; boxH?: number;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

type WebGLPathTracerLike = {
  setScene?: (scene: THREE.Scene, camera: THREE.Camera) => void;
  updateCamera?: () => void;
  reset?: () => void;
  renderSample?: () => void;
  dispose?: () => void;
};

type PresetModel = {
  key: string;
  labelZh: string;
  labelEn: string;
  url: string;
  modelName: string;
};

const DEFAULT_BG_COLOR = '#ffffff';
const DEFAULT_AMBIENT_INTENSITY = 0.26;
const DEFAULT_HEMI_INTENSITY = 0.52;
const DEFAULT_DIRECTIONAL_INTENSITY = 0.78;
const DEFAULT_HEMI_SKY_COLOR = 0xf8f7f2;
const DEFAULT_HEMI_GROUND_COLOR = 0xd7c7b0;
const DEFAULT_DIRECTIONAL_COLOR = 0xfff3d8;

const PRESET_MODELS: PresetModel[] = [
  {
    key: 'duck',
    labelZh: 'Duck',
    labelEn: 'Duck',
    url: '/models/duck.glb',
    modelName: 'duck.glb',
  },
];

function ThreeNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isPathTracingForced = Boolean(data.forcePathTracing);
  const minNodeWidth = 520;
  const minNodeHeight = 280;
  const defaultNodeWidth = 560;
  const defaultNodeHeight = 320;
  const rf = useReactFlow();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const modelRef = React.useRef<THREE.Object3D | null>(null);
  const gridRef = React.useRef<THREE.GridHelper | null>(null);
  const axesRef = React.useRef<THREE.AxesHelper | null>(null);
  const isInteractingRef = React.useRef(false);
  const interactionEndTimerRef = React.useRef<number | null>(null);
  const daylightEnvironmentTextureRef = React.useRef<THREE.Texture | null>(null);
  const daylightEnvironmentTargetRef = React.useRef<THREE.WebGLRenderTarget | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const isNodeResizingRef = React.useRef(false);
  const resizeCommitRafRef = React.useRef<number | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const renderPendingRef = React.useRef<number | null>(null);
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const lastModelUrlRef = React.useRef<string | undefined>(undefined);
  const [isModelUploading, setIsModelUploading] = React.useState(false);
  const pathTracerRef = React.useRef<WebGLPathTracerLike | null>(null);
  const pathTracerModuleRef = React.useRef<any>(null);
  const pathTracerLoopRef = React.useRef<number | null>(null);
  const pathTracingEnabledRef = React.useRef<boolean>(
    isPathTracingForced || Boolean(data.pathTracingEnabled)
  );
  const [pathTracingEnabled, setPathTracingEnabled] = React.useState<boolean>(
    isPathTracingForced || Boolean(data.pathTracingEnabled)
  );
  const [pathTracerStatus, setPathTracerStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>(
    isPathTracingForced || Boolean(data.pathTracingEnabled) ? 'loading' : 'idle'
  );
  const [pathTracerError, setPathTracerError] = React.useState<string | null>(null);
  const boxSizeRef = React.useRef<{ boxW?: number; boxH?: number }>({
    boxW: data.boxW,
    boxH: data.boxH,
  });
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  React.useEffect(() => {
    boxSizeRef.current = { boxW: data.boxW, boxH: data.boxH };
  }, [data.boxW, data.boxH]);

  const updateNodeData = React.useCallback((patch: Record<string, any>) => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch },
      })
    );
  }, [id]);

  React.useEffect(() => {
    const patch: Record<string, number> = {};
    if (typeof data.boxW === 'number' && data.boxW < minNodeWidth) {
      patch.boxW = minNodeWidth;
    }
    if (typeof data.boxH === 'number' && data.boxH < minNodeHeight) {
      patch.boxH = minNodeHeight;
    }
    if (Object.keys(patch).length > 0) {
      updateNodeData(patch);
    }
  }, [data.boxH, data.boxW, minNodeHeight, minNodeWidth, updateNodeData]);

  React.useEffect(() => {
    const nextEnabled = Boolean(data.forcePathTracing) || Boolean(data.pathTracingEnabled);
    pathTracingEnabledRef.current = nextEnabled;
    setPathTracingEnabled((prev) => (prev === nextEnabled ? prev : nextEnabled));
    if (!nextEnabled) {
      setPathTracerStatus('idle');
      setPathTracerError(null);
    } else if (pathTracerRef.current) {
      setPathTracerStatus('ready');
    } else {
      setPathTracerStatus('loading');
    }
  }, [data.forcePathTracing, data.pathTracingEnabled]);

  React.useEffect(() => {
    pathTracingEnabledRef.current = pathTracingEnabled;
  }, [pathTracingEnabled]);

  const stopPathTracerLoop = React.useCallback(() => {
    if (pathTracerLoopRef.current !== null) {
      cancelAnimationFrame(pathTracerLoopRef.current);
      pathTracerLoopRef.current = null;
    }
  }, []);

  const disposePathTracer = React.useCallback(() => {
    stopPathTracerLoop();
    const tracer = pathTracerRef.current as any;
    if (tracer) {
      try {
        tracer.dispose?.();
      } catch (error) {
        console.warn('Dispose path tracer error:', error);
      }
    }
    pathTracerRef.current = null;
  }, [stopPathTracerLoop]);

  const ensureDaylightEnvironment = React.useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!renderer || !scene) return false;

    let environmentTexture = daylightEnvironmentTextureRef.current;
    if (!environmentTexture) {
      const width = 256;
      const height = 128;
      const pixels = new Float32Array(width * height * 4);
      const topColor = new THREE.Color('#faf9f4');
      const midColor = new THREE.Color('#f1eadf');
      const bottomColor = new THREE.Color('#e3d2bd');
      const rowColor = new THREE.Color();
      for (let y = 0; y < height; y += 1) {
        const t = y / (height - 1);
        if (t < 0.62) {
          rowColor.copy(topColor).lerp(midColor, t / 0.62);
        } else {
          rowColor.copy(midColor).lerp(bottomColor, (t - 0.62) / 0.38);
        }
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          pixels[i + 0] = rowColor.r;
          pixels[i + 1] = rowColor.g;
          pixels[i + 2] = rowColor.b;
          pixels[i + 3] = 1;
        }
      }

      const texture = new THREE.DataTexture(
        pixels,
        width,
        height,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      daylightEnvironmentTextureRef.current = texture;
      environmentTexture = texture;
    }

    let target = daylightEnvironmentTargetRef.current;
    if (!target) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      target = pmrem.fromEquirectangular(environmentTexture);
      daylightEnvironmentTargetRef.current = target;
      pmrem.dispose();
    }

    const nextEnvironment = pathTracingEnabled
      ? environmentTexture
      : target.texture;

    if (scene.environment !== nextEnvironment) {
      scene.environment = nextEnvironment;
      return true;
    }

    return false;
  }, [pathTracingEnabled]);

  const ensurePathTracer = React.useCallback(async () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera || !modelRef.current) return null;

    setPathTracerStatus('loading');
    setPathTracerError(null);

    if (!pathTracerModuleRef.current) {
      pathTracerModuleRef.current = await import('three-gpu-pathtracer');
    }

    const WebGLPathTracerCtor = pathTracerModuleRef.current?.WebGLPathTracer;
    if (typeof WebGLPathTracerCtor !== 'function') {
      throw new Error('WebGLPathTracer ctor missing');
    }

    let tracer = pathTracerRef.current as any;
    if (!tracer) {
      tracer = new WebGLPathTracerCtor(renderer);
      pathTracerRef.current = tracer as WebGLPathTracerLike;
      try { tracer.minSamples = 1; } catch {}
      try { tracer.filterGlossyFactor = 0.5; } catch {}
      try { tracer.tiles?.set?.(2, 2); } catch {}
    }

    tracer.setScene?.(scene, camera);
    tracer.updateCamera?.();
    tracer.reset?.();
    setPathTracerStatus('ready');
    return tracer as WebGLPathTracerLike;
  }, []);

  const enablePathTracingWithFallback = React.useCallback(async () => {
    try {
      ensureDaylightEnvironment();
      const tracer = await ensurePathTracer();
      if (!tracer) return;
      stopPathTracerLoop();
      const renderTick = () => {
        if (!pathTracingEnabledRef.current) {
          pathTracerLoopRef.current = null;
          return;
        }
        const isCanvasDragging =
          typeof document !== 'undefined' &&
          (document.body?.classList.contains('tanva-canvas-dragging') ||
            document.body?.classList.contains('tanva-image-dragging'));
        if (isCanvasDragging) {
          pathTracerLoopRef.current = requestAnimationFrame(renderTick);
          return;
        }
        if (isInteractingRef.current) {
          pathTracerLoopRef.current = requestAnimationFrame(renderTick);
          return;
        }
        const activeTracer = pathTracerRef.current as any;
        if (!activeTracer) {
          pathTracerLoopRef.current = null;
          return;
        }
        try {
          activeTracer.renderSample?.();
        } catch (error) {
          console.error('Path tracing sample failed:', error);
          setPathTracerStatus('error');
          setPathTracerError(
            lt('PathTracer 渲染失败，已回退到普通渲染。', 'Path tracer render failed. Fallback to raster rendering.')
          );
          stopPathTracerLoop();
          if (!isPathTracingForced) {
            setPathTracingEnabled(false);
            updateNodeData({ pathTracingEnabled: false });
          }
          return;
        }
        pathTracerLoopRef.current = requestAnimationFrame(renderTick);
      };
      pathTracerLoopRef.current = requestAnimationFrame(renderTick);
    } catch (error) {
      console.error('Failed to enable path tracing:', error);
      setPathTracerStatus('error');
      setPathTracerError(
        lt('PathTracer 初始化失败，请检查依赖或浏览器 WebGL2 支持。', 'Path tracer init failed. Check dependencies or WebGL2 support.')
      );
      if (!isPathTracingForced) {
        setPathTracingEnabled(false);
        updateNodeData({ pathTracingEnabled: false });
      }
    }
  }, [
    ensureDaylightEnvironment,
    ensurePathTracer,
    isPathTracingForced,
    lt,
    stopPathTracerLoop,
    updateNodeData,
  ]);

  const normalizeModelUrl = React.useCallback((input: string): string => {
    const raw = (input || '').trim();
    if (!raw) return input;
    if (raw.startsWith('/api/assets/proxy') || raw.startsWith('/assets/proxy')) {
      return proxifyRemoteAssetUrl(raw);
    }
    if (raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) {
      return raw;
    }
    if (/^(templates|projects|uploads|videos)\//i.test(raw)) {
      return proxifyRemoteAssetUrl(
        `/api/assets/proxy?key=${encodeURIComponent(raw.replace(/^\/+/, ''))}`
      );
    }
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return proxifyRemoteAssetUrl(raw);
    }
    return raw;
  }, []);

  // 资源释放函数 (High Priority Cleanup)
  const disposeResources = React.useCallback(() => {
    disposePathTracer();

    if (interactionEndTimerRef.current !== null) {
      clearTimeout(interactionEndTimerRef.current);
      interactionEndTimerRef.current = null;
    }
    isInteractingRef.current = false;

    if (resizeCommitRafRef.current !== null) {
      cancelAnimationFrame(resizeCommitRafRef.current);
      resizeCommitRafRef.current = null;
    }

    // 停止渲染调度
    if (renderPendingRef.current !== null) {
      cancelAnimationFrame(renderPendingRef.current);
      renderPendingRef.current = null;
    }

    // 断开 ResizeObserver
    if (resizeObserverRef.current) {
      try {
        resizeObserverRef.current.disconnect();
      } catch (e) {
        console.warn('Disconnect ResizeObserver error:', e);
      }
      resizeObserverRef.current = null;
    }

    // 释放 OrbitControls
    if (controlsRef.current) {
      try {
        controlsRef.current.dispose();
      } catch (e) {
        console.warn('Dispose OrbitControls error:', e);
      }
      controlsRef.current = null;
    }

    // 深度释放场景中的资源 (geometries, materials, textures)
    if (sceneRef.current) {
      const scene = sceneRef.current;
      scene.environment = null;
      scene.traverse((object: any) => {
        if (object.isMesh) {
          if (object.geometry) {
            object.geometry.dispose();
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((mat: any) => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        }
      });
      sceneRef.current = null;
    }

    if (daylightEnvironmentTextureRef.current) {
      daylightEnvironmentTextureRef.current.dispose();
      daylightEnvironmentTextureRef.current = null;
    }

    if (daylightEnvironmentTargetRef.current) {
      daylightEnvironmentTargetRef.current.dispose();
      daylightEnvironmentTargetRef.current = null;
    }

    // 释放渲染器资源
    if (rendererRef.current) {
      const renderer = rendererRef.current;
      try {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      } catch (e) {
        console.warn('Dispose renderer error:', e);
      }
      rendererRef.current = null;
    }

    cameraRef.current = null;
    modelRef.current = null;
    gridRef.current = null;
    axesRef.current = null;
    lastModelUrlRef.current = undefined;
  }, [disposePathTracer]);
  
  // 使用全局图片历史记录
  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const projectHistory = React.useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);
  const allImages = React.useMemo(
    () =>
      projectHistory.map(
        (item) =>
          ({
            id: item.id,
            src: item.src,
            title: item.title,
            timestamp: item.timestamp,
          }) as ImageItem,
      ),
    [projectHistory],
  );

  // 单帧渲染调度，避免持续 RAF 占用
  const requestRender = React.useCallback((syncControls = true) => {
    if (renderPendingRef.current !== null) return;
    renderPendingRef.current = requestAnimationFrame(() => {
      renderPendingRef.current = null;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!renderer || !scene || !camera) return;
      const isCanvasDragging =
        typeof document !== 'undefined' &&
        (document.body?.classList.contains('tanva-canvas-dragging') ||
          document.body?.classList.contains('tanva-image-dragging'));
      if (isCanvasDragging && !isInteractingRef.current) {
        return;
      }
      if (syncControls) {
        controls?.update();
      }
      if (pathTracingEnabledRef.current && pathTracerRef.current && !isInteractingRef.current) {
        const tracer = pathTracerRef.current as any;
        try {
          tracer.updateCamera?.();
          tracer.renderSample?.();
          return;
        } catch (error) {
          console.error('Path tracer render fallback:', error);
        }
      }
      renderer.render(scene, camera);
    });
  }, []);

  const applySceneVisuals = React.useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    try {
      scene.background = new THREE.Color(DEFAULT_BG_COLOR);
    } catch {}

    // PT 和普通 PBR 渲染共用同一套日光环境。
    let envChanged = false;
    try {
      envChanged = ensureDaylightEnvironment();
    } catch (error) {
      console.warn('Init daylight environment failed:', error);
    }

    if (pathTracingEnabledRef.current && pathTracerRef.current) {
      if (envChanged) {
        const tracer = pathTracerRef.current as any;
        try {
          tracer.setScene?.(scene, cameraRef.current);
          tracer.updateEnvironment?.();
          tracer.reset?.();
        } catch {}
      }
      return;
    }
    if (pathTracingEnabledRef.current && !pathTracerRef.current) {
      return;
    }
    // Avoid consuming one damping step exactly when switching PT on/off,
    // otherwise camera can appear to "jump" once after toggle.
    requestRender(false);
  }, [ensureDaylightEnvironment, requestRender]);

  React.useEffect(() => {
    applySceneVisuals();
  }, [applySceneVisuals]);

  const syncRendererSizeToContainer = React.useCallback(() => {
    const container = containerRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!container || !renderer || !camera) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (scene) {
      controlsRef.current?.update();
      if (pathTracingEnabledRef.current && pathTracerRef.current && !isInteractingRef.current) {
        const tracer = pathTracerRef.current as any;
        try {
          tracer.updateCamera?.();
          tracer.reset?.();
          return;
        } catch {}
      }
      renderer.render(scene, camera);
    }
  }, []);

  const scheduleRendererSizeSync = React.useCallback(() => {
    if (resizeCommitRafRef.current !== null) return;
    resizeCommitRafRef.current = requestAnimationFrame(() => {
      resizeCommitRafRef.current = null;
      if (isNodeResizingRef.current) return;
      syncRendererSizeToContainer();
    });
  }, [syncRendererSizeToContainer]);

  const initIfNeeded = React.useCallback(() => {
    if (!containerRef.current) return;
    if (rendererRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const fallbackW = (boxSizeRef.current.boxW || 260) - 16;
    const fallbackH = (boxSizeRef.current.boxH || 220) - 64;
    const w = Math.max(220, Math.floor(containerRef.current.clientWidth || rect.width || fallbackW));
    const h = Math.max(140, Math.floor(containerRef.current.clientHeight || rect.height || fallbackH));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(DEFAULT_BG_COLOR);
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.set(2.5, 2, 3);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h, false);
    // 更自然的色彩与曝光
    try {
      (renderer as any).outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      (renderer as any).physicallyCorrectLights = true;
    } catch {}
    renderer.setClearColor(DEFAULT_BG_COLOR, 1);
    (renderer.domElement.style as any).width = '100%';
    (renderer.domElement.style as any).height = '100%';
    (renderer.domElement.style as any).display = 'block';
    (renderer.domElement.style as any).touchAction = 'none';
    renderer.domElement.classList.add('tanva-three-node-canvas');
    renderer.domElement.setAttribute('data-flow-three-node-canvas', 'true');
    renderer.setPixelRatio(1); // 降低像素比提升交互流畅度
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false; // 只允许旋转/缩放，不平移
    const beginInteraction = () => {
      if (interactionEndTimerRef.current !== null) {
        clearTimeout(interactionEndTimerRef.current);
        interactionEndTimerRef.current = null;
      }
      isInteractingRef.current = true;
    };
    const endInteraction = () => {
      if (interactionEndTimerRef.current !== null) {
        clearTimeout(interactionEndTimerRef.current);
      }
      interactionEndTimerRef.current = window.setTimeout(() => {
        isInteractingRef.current = false;
        interactionEndTimerRef.current = null;
        if (pathTracingEnabledRef.current) {
          void enablePathTracingWithFallback();
        } else {
          requestRender();
        }
      }, 120);
    };
    controls.addEventListener('start', beginInteraction);
    controls.addEventListener('change', () => {
      if (isInteractingRef.current) {
        // controls.change 本身已由 OrbitControls.update 触发，避免在回调中再次 update 导致额外开销
        requestRender(false);
        return;
      }
      if (pathTracingEnabledRef.current && pathTracerRef.current) {
        const tracer = pathTracerRef.current as any;
        try {
          tracer.updateCamera?.();
          tracer.reset?.();
        } catch {}
        return;
      }
      requestRender(false);
    });
    controls.addEventListener('end', endInteraction);
    controlsRef.current = controls;
    // 日光场景：天空填充 + 暖色太阳主光，配合 environment 解决 PT 黑底问题。
    const ambient = new THREE.AmbientLight(0xfaf8f2, DEFAULT_AMBIENT_INTENSITY);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(
      DEFAULT_HEMI_SKY_COLOR,
      DEFAULT_HEMI_GROUND_COLOR,
      DEFAULT_HEMI_INTENSITY
    );
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(DEFAULT_DIRECTIONAL_COLOR, DEFAULT_DIRECTIONAL_INTENSITY);
    dir.position.set(-3.8, 6.4, 4.8);
    dir.castShadow = false;
    scene.add(dir);
    // base helpers to ensure something visible
    try {
      const grid = new THREE.GridHelper(10, 10, 0xcccccc, 0xeeeeee);
      (grid.material as any).opacity = 0.6; (grid.material as any).transparent = true;
      scene.add(grid); gridRef.current = grid;
      const axes = new THREE.AxesHelper(1.5);
      scene.add(axes); axesRef.current = axes;
    } catch {}
    camera.lookAt(0,0,0);
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    applySceneVisuals();
    syncRendererSizeToContainer();
    requestRender();

    // Resize observer to keep renderer matching container size
    if (resizeObserverRef.current) {
      try {
        resizeObserverRef.current.disconnect();
      } catch {}
      resizeObserverRef.current = null;
    }
    const ro = new ResizeObserver(() => {
      if (isNodeResizingRef.current) return;
      scheduleRendererSizeSync();
    });
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;
  }, [applySceneVisuals, enablePathTracingWithFallback, requestRender, scheduleRendererSizeSync, syncRendererSizeToContainer]);

  React.useEffect(() => {
    const t = setTimeout(() => initIfNeeded(), 0); // 等布局稳定再初始化
    return () => {
      clearTimeout(t);
      disposeResources();
    };
  }, [initIfNeeded, disposeResources]);

  React.useEffect(() => {
    const handleGlobalMouseUp = () => {
      requestRender(false);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp, true);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp, true);
  }, [requestRender]);

  React.useEffect(() => {
    if (!pathTracingEnabled) {
      disposePathTracer();
      return;
    }
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !modelRef.current) {
      return;
    }
    void enablePathTracingWithFallback();
    return () => {
      stopPathTracerLoop();
    };
    // Intentionally keep dependencies narrow to avoid restarting PT loop on every local state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathTracingEnabled, data.modelUrl]);

  const onResize = (w: number, h: number) => {
    boxSizeRef.current = { boxW: w, boxH: h };
    // Resize 拖拽过程中不频繁 setSize，避免 WebGL 画布被清空造成闪烁；
    // canvas CSS 已是 100% 铺满，拖拽时由浏览器做缩放，结束后再一次性同步 renderer。
    isNodeResizingRef.current = true;
  };

  const onResizeEnd = (w: number, h: number) => {
    boxSizeRef.current = { boxW: w, boxH: h };
    isNodeResizingRef.current = false;
    scheduleRendererSizeSync();
    if (pathTracingEnabledRef.current) {
      void enablePathTracingWithFallback();
    }
  };

  const fitToObject = (obj: THREE.Object3D) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return;

    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, Number.EPSILON);

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = Math.max(camera.aspect, Number.EPSILON);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const minFov = Math.max(Math.min(vFov, hFov), Number.EPSILON);

    let dist = radius / Math.sin(minFov / 2);
    dist *= 1.25; // padding
    dist = Math.max(dist, 0.5);

    const direction = new THREE.Vector3(1, 0.8, 1).normalize();
    camera.position.copy(center.clone().add(direction.multiplyScalar(dist)));
    camera.near = Math.max(dist / 100, 0.01);
    camera.far = Math.max(dist + radius * 4, 50);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();
    // 清理上一轮 OrbitControls 的惯性/增量，保证落点稳定
    try {
      controls.saveState();
      controls.reset();
    } catch {}
  };

  const mountModel = React.useCallback((object: THREE.Object3D) => {
    initIfNeeded();
    const scene = sceneRef.current;
    if (!scene) return;
    if (modelRef.current) {
      scene.remove(modelRef.current);
    }
    modelRef.current = object;
    scene.add(object);
    try {
      fitToObject(object);
    } catch {}
    setErr(null);
    if (gridRef.current) gridRef.current.visible = false;
    if (axesRef.current) axesRef.current.visible = false;
    requestRender();
    if (pathTracingEnabledRef.current) {
      void enablePathTracingWithFallback();
    }
  }, [enablePathTracingWithFallback, initIfNeeded, requestRender]);

  const createLoader = React.useCallback(() => {
    const loader = new GLTFLoader();
    loader.setCrossOrigin('anonymous');
    try {
      const draco = new DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
      loader.setDRACOLoader(draco);
    } catch {}
    return loader;
  }, []);

  const handleLoadError = React.useCallback((error: unknown) => {
    console.error('Failed to load 3D model:', error);
    setErr(lt('加载模型失败，可能需要开启 Draco/KTX2 解码或检查链接是否可访问', 'Failed to load model. Enable Draco/KTX2 decoding or check whether the URL is reachable.'));
  }, [lt]);

  const uploadModelAndPersist = React.useCallback(async (file: File) => {
    setIsModelUploading(true);
    try {
      const { model3DUploadService } = await import('@/services/model3DUploadService');
      const result = await model3DUploadService.uploadModelFile(file, {
        projectId: projectId ?? undefined,
      });
      if (!result.success || !result.asset?.url) {
        throw new Error(result.error || lt('3D模型上传失败', '3D model upload failed'));
      }
      updateNodeData({
        modelUrl: result.asset.url,
        modelName: result.asset.fileName,
      });
    } catch (e: any) {
      console.error('❌ 3D model upload failed:', e);
      setErr(e?.message || lt('3D模型上传失败，请重试', '3D model upload failed, please retry.'));
    } finally {
      setIsModelUploading(false);
    }
  }, [lt, projectId, updateNodeData]);

  const loadModelFromFile = React.useCallback((file: File) => {
    initIfNeeded();
    const url = URL.createObjectURL(file);
    const loader = createLoader();
    loader.load(
      url,
      (gltf) => {
        mountModel(gltf.scene);
        URL.revokeObjectURL(url);
      },
      undefined,
      (e) => {
        URL.revokeObjectURL(url);
        handleLoadError(e);
      }
    );
  }, [createLoader, handleLoadError, initIfNeeded, mountModel]);

  const loadModelFromUrl = React.useCallback((url: string) => {
    if (!url) return;
    initIfNeeded();
    const loader = createLoader();
    const resolved = normalizeModelUrl(url);
    loader.load(
      resolved,
      (gltf) => {
        mountModel(gltf.scene);
      },
      undefined,
      (e) => {
        handleLoadError(e);
      }
    );
  }, [createLoader, handleLoadError, initIfNeeded, mountModel]);

  const applyPresetModel = React.useCallback((preset: PresetModel) => {
    updateNodeData({
      modelUrl: preset.url,
      modelName: preset.modelName,
    });
    lastModelUrlRef.current = normalizeModelUrl(preset.url);
    setErr(null);
    loadModelFromUrl(preset.url);
  }, [loadModelFromUrl, normalizeModelUrl, updateNodeData]);

  // Keep effect below loadModelFromUrl so dependency array doesn't hit TDZ
  React.useEffect(() => {
    if (!data.modelUrl) return;
    const resolved = normalizeModelUrl(data.modelUrl);
    if (lastModelUrlRef.current === resolved && modelRef.current) return;
    lastModelUrlRef.current = resolved;
    loadModelFromUrl(data.modelUrl);
  }, [data.modelUrl, loadModelFromUrl, normalizeModelUrl]);

  const capture = async () => {
    initIfNeeded();
    const renderer = rendererRef.current!;
    const scene = sceneRef.current!;
    const camera = cameraRef.current!;
    // 确保一次即时渲染并开启保留绘制缓冲，避免抓到空帧
    const oldPDB = (renderer as any).preserveDrawingBuffer;
    (renderer as any).preserveDrawingBuffer = true;
    try {
      if (pathTracingEnabledRef.current && pathTracerRef.current) {
        const tracer = pathTracerRef.current as any;
        try {
          tracer.renderSample?.();
        } catch {
          renderer.render(scene, camera);
        }
      } else {
        renderer.render(scene, camera);
      }
      const canvas = renderer.domElement;
      const dataUrl = await canvasToDataUrl(canvas, 'image/png');
      const base64 = dataUrl.split(',')[1];
      // 更新自身
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch: { imageData: base64 } } }));
      
      // 添加到全局历史记录
      const newImageId = `${id}-${Date.now()}`;
      void recordImageHistoryEntry({
        id: newImageId,
        base64,
        title: `${lt('3D节点截图', '3D node screenshot')} ${new Date().toLocaleTimeString()}`,
        nodeId: id,
        nodeType: '3d',
        fileName: `three_capture_${newImageId}.png`,
        projectId,
      })
        .then(({ remoteUrl }) => {
          if (!remoteUrl) return;
          try {
            const current = rf.getNode(id);
            if ((current?.data as any)?.imageData !== base64) return;
          } catch {}
          // 用远程 URL 替换节点内的 base64，避免写入项目 JSON/DB
          window.dispatchEvent(
            new CustomEvent('flow:updateNodeData', {
              detail: { id, patch: { imageUrl: remoteUrl, imageData: undefined, thumbnail: undefined } },
            })
          );
  
          // 同步更新下游 Image 节点（避免 base64 传播并落库）
          try {
            const outs = rf.getEdges().filter((e) => e.source === id);
            for (const ed of outs) {
              const tgt = rf.getNode(ed.target);
              if (tgt?.type === 'image') {
                if ((tgt?.data as any)?.imageData !== base64) continue;
                window.dispatchEvent(
                  new CustomEvent('flow:updateNodeData', {
                    detail: {
                      id: ed.target,
                      patch: { imageUrl: remoteUrl, imageData: undefined, thumbnail: undefined },
                    },
                  })
                );
              }
            }
          } catch {}
        })
        .catch(() => {});
      setCurrentImageId(newImageId);
      
      // 向下游 Image 节点传播
      try {
        const outs = rf.getEdges().filter(e => e.source === id);
        for (const ed of outs) {
          const tgt = rf.getNode(ed.target);
          if (tgt?.type === 'image') {
            window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id: ed.target, patch: { imageData: base64 } } }));
          }
        }
      } catch {}
    } finally {
      (renderer as any).preserveDrawingBuffer = oldPDB;
    }
  };

  const addTestCube = () => {
    initIfNeeded();
    const scene = sceneRef.current!;
    if (modelRef.current) scene.remove(modelRef.current);
    const geo = new THREE.BoxGeometry(1,1,1);
    const mat = new THREE.MeshStandardMaterial({ color: '#4f46e5' });
    const mesh = new THREE.Mesh(geo, mat);
    // basic helpers
    modelRef.current = mesh;
    scene.add(mesh);
    if (gridRef.current) gridRef.current.visible = false;
    if (axesRef.current) axesRef.current.visible = false;
    try { (fitToObject as any)?.(mesh); } catch {}
    setErr(null);
    requestRender();
    if (pathTracingEnabledRef.current) {
      void enablePathTracingWithFallback();
    }
  };

  const sendToCanvas = (event?: React.MouseEvent<HTMLButtonElement>) => {
    const img = data.imageData || data.imageUrl;
    if (!img) return;
    const trimmed = img.trim();
    const dataUrl = toRenderableImageSrc(trimmed) || trimmed;
    const fileName = `three_${Date.now()}.png`;
    const triggerEl =
      event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const nodeEl = triggerEl?.closest('.react-flow__node') as HTMLElement | null;
    const rect = (nodeEl || triggerEl)?.getBoundingClientRect();
    const anchorClient = rect
      ? {
          x: rect.right + 16,
          y: rect.top + rect.height / 2,
        }
      : undefined;
    window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
      detail: {
        imageData: dataUrl,
        fileName,
        operationType: 'generate',
        anchorClient,
      }
    }));
  };

  React.useEffect(() => {
    if (!preview) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [preview]);

  const src = (() => {
    const raw = (data.imageData || data.imageUrl)?.trim();
    if (!raw) return undefined;
    return toRenderableImageSrc(raw) || undefined;
  })();

  const togglePathTracing = React.useCallback(() => {
    if (isPathTracingForced) return;
    const next = !pathTracingEnabledRef.current;
    if (!next) {
      stopPathTracerLoop();
      setPathTracerStatus('idle');
      setPathTracerError(null);
    }
    pathTracingEnabledRef.current = next;
    setPathTracingEnabled(next);
    updateNodeData({ pathTracingEnabled: next });
  }, [isPathTracingForced, stopPathTracerLoop, updateNodeData]);

  const stopTouchPropagation = React.useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.touches.length >= 2) {
      e.preventDefault();
    }
  }, []);

  const headerTitle = data.nodeTitle || '3D';
  const pathTracerBadgeText = pathTracerStatus === 'ready'
    ? 'PT Ready'
    : pathTracerStatus === 'loading'
    ? 'PT Loading'
    : pathTracerStatus === 'error'
    ? 'PT Error'
    : 'Raster';
  const runtimeErr = err || pathTracerError;

  return (
    <div style={{ width: Math.max(data.boxW || defaultNodeWidth, minNodeWidth), height: Math.max(data.boxH || defaultNodeHeight, minNodeHeight), padding: 8, background: '#fff', border: `1px solid ${borderColor}`, borderRadius: 8, boxShadow, transition: 'border-color 0.15s ease, box-shadow 0.15s ease', display: 'flex', flexDirection: 'column', position: 'relative', contain: 'layout paint' }}>
      <NodeResizer isVisible={!!selected} minWidth={minNodeWidth} minHeight={minNodeHeight} color="transparent" lineStyle={{ display: 'none' }} handleStyle={{ background: 'transparent', border: 'none', width: 12, height: 12, opacity: 0 }}
        onResize={(e, p) => { onResize(p.width, p.height); rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: p.width, boxH: p.height } } : n)); }}
        onResizeEnd={(e, p) => { onResizeEnd(p.width, p.height); rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: p.width, boxH: p.height } } : n)); }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>{headerTitle}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            onClick={togglePathTracing}
            title={isPathTracingForced ? lt('该节点固定启用 PathTracer', 'Path tracer is forced for this node') : lt('切换 PathTracer', 'Toggle path tracer')}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: pathTracingEnabled ? '#0f172a' : '#fff',
              color: pathTracingEnabled ? '#fff' : '#111827',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              opacity: isPathTracingForced ? 0.9 : 1,
              cursor: isPathTracingForced ? 'default' : 'pointer',
            }}
          >
            {pathTracingEnabled ? 'PT On' : 'PT Off'}
          </button>
          <button disabled={isModelUploading} onClick={() => fileInput.current?.click()} style={{ fontSize: 12, padding: '4px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, opacity: isModelUploading ? 0.6 : 1, cursor: isModelUploading ? 'not-allowed' : 'pointer' }}>
            {isModelUploading ? 'Uploading...' : 'Upload'}
          </button>
          {PRESET_MODELS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => applyPresetModel(preset)}
              style={{ fontSize: 12, padding: '4px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}
            >
              {lt(preset.labelZh, preset.labelEn)}
            </button>
          ))}
          <button onClick={addTestCube} style={{ fontSize: 12, padding: '4px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>Cube</button>
          <button onClick={capture} style={{ fontSize: 12, padding: '4px 8px', background: '#111827', color: '#fff', borderRadius: 6 }}>Capture</button>
          <button onClick={sendToCanvas} disabled={!data.imageData && !data.imageUrl} title={!data.imageData && !data.imageUrl ? lt('无可发送的图像', 'No image to send') : lt('发送到画布', 'Send to canvas')} style={{ fontSize: 12, padding: '4px 8px', background: !data.imageData && !data.imageUrl ? '#e5e7eb' : '#111827', color: '#fff', borderRadius: 6 }}>
            <SendIcon size={14} />
          </button>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          loadModelFromFile(f);
          void uploadModelAndPersist(f);
        }}
      />
      <div
        onDoubleClick={() => src && setPreview(true)}
        className="nodrag nowheel nopan tanva-three-node-viewport"
        data-flow-three-node-viewport="true"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchStart={stopTouchPropagation}
        onTouchMove={stopTouchPropagation}
        onTouchEnd={(e) => e.stopPropagation()}
        style={{ flex: 1, minHeight: 120, background: '#fff', borderRadius: 6, border: '1px solid #e5e7eb', display: 'flex', overflow: 'hidden', position: 'relative' }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%', touchAction: 'none' }} />
        <div style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(15,23,42,0.78)', color: '#fff', fontSize: 10, padding: '3px 6px', borderRadius: 999 }}>
          {pathTracerBadgeText}
        </div>
        {runtimeErr && (<div style={{ position: 'absolute', left: 8, bottom: 8, right: 8, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 10, padding: '4px 6px', borderRadius: 4 }}>{runtimeErr}</div>)}
      </div>
      <Handle type="source" position={Position.Right} id="img" onMouseEnter={() => setHover('img-out')} onMouseLeave={() => setHover(null)} />
      {hover === 'img-out' && (<div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>image</div>)}
      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find(item => item.id === currentImageId)?.src || src || ''
            : src || ''
        }
        imageTitle={lt("全局图片预览", "Global image preview")}
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={(imageId: string) => {
          const selectedImage = allImages.find(item => item.id === imageId);
          if (selectedImage) {
            setCurrentImageId(imageId);
          }
        }}
      />
    </div>
  );
}

export default React.memo(ThreeNodeInner);
