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

type Props = {
  id: string;
  data: {
    imageData?: string;
    imageUrl?: string;
    modelUrl?: string;
    modelName?: string;
    boxW?: number; boxH?: number;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

function ThreeNodeInner({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const modelRef = React.useRef<THREE.Object3D | null>(null);
  const gridRef = React.useRef<THREE.GridHelper | null>(null);
  const axesRef = React.useRef<THREE.AxesHelper | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const renderPendingRef = React.useRef<number | null>(null);
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const lastModelUrlRef = React.useRef<string | undefined>(undefined);
  const [isModelUploading, setIsModelUploading] = React.useState(false);
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
  }, []);
  
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
  const requestRender = React.useCallback(() => {
    if (renderPendingRef.current !== null) return;
    renderPendingRef.current = requestAnimationFrame(() => {
      renderPendingRef.current = null;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!renderer || !scene || !camera) return;
      controls?.update();
      renderer.render(scene, camera);
    });
  }, []);

  const syncRendererSizeToContainer = React.useCallback(() => {
    const container = containerRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!container || !renderer || !camera) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }, [requestRender]);

  const initIfNeeded = React.useCallback(() => {
    if (!containerRef.current) return;
    if (rendererRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const fallbackW = (boxSizeRef.current.boxW || 260) - 16;
    const fallbackH = (boxSizeRef.current.boxH || 220) - 64;
    const w = Math.max(220, Math.floor(containerRef.current.clientWidth || rect.width || fallbackW));
    const h = Math.max(140, Math.floor(containerRef.current.clientHeight || rect.height || fallbackH));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#ffffff');
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.set(2.5, 2, 3);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h, false);
    // 更自然的色彩与曝光
    try {
      (renderer as any).outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25; // overall a bit brighter
      (renderer as any).physicallyCorrectLights = true;
    } catch {}
    renderer.setClearColor('#ffffff', 1);
    (renderer.domElement.style as any).width = '100%';
    (renderer.domElement.style as any).height = '100%';
    (renderer.domElement.style as any).display = 'block';
    renderer.setPixelRatio(1); // 降低像素比提升交互流畅度
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false; // 只允许旋转/缩放，不平移
    controls.addEventListener('change', requestRender);
    controlsRef.current = controls;
    // 更自然的光照组合：环境+半球+主光
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7);
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
      syncRendererSizeToContainer();
    });
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;
  }, [requestRender, syncRendererSizeToContainer]);

  React.useEffect(() => {
    const t = setTimeout(() => initIfNeeded(), 0); // 等布局稳定再初始化
    return () => {
      clearTimeout(t);
      disposeResources();
    };
  }, [initIfNeeded, disposeResources]);

  const onResize = (w: number, h: number) => {
    boxSizeRef.current = { boxW: w, boxH: h };
    requestAnimationFrame(() => syncRendererSizeToContainer());
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
  }, [initIfNeeded, requestRender]);

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
    console.error('加载 3D 模型失败:', error);
    setErr('加载模型失败，可能需要开启 Draco/KTX2 解码或检查链接是否可访问');
  }, []);

  const uploadModelAndPersist = React.useCallback(async (file: File) => {
    setIsModelUploading(true);
    try {
      const { model3DUploadService } = await import('@/services/model3DUploadService');
      const result = await model3DUploadService.uploadModelFile(file, {
        projectId: projectId ?? undefined,
      });
      if (!result.success || !result.asset?.url) {
        throw new Error(result.error || '3D模型上传失败');
      }
      updateNodeData({
        modelUrl: result.asset.url,
        modelName: result.asset.fileName,
      });
    } catch (e: any) {
      console.error('❌ 3D model upload failed:', e);
      setErr(e?.message || '3D模型上传失败，请重试');
    } finally {
      setIsModelUploading(false);
    }
  }, [projectId, updateNodeData]);

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

  // Keep effect below loadModelFromUrl so dependency array doesn't hit TDZ
  React.useEffect(() => {
    if (!data.modelUrl) return;
    const resolved = normalizeModelUrl(data.modelUrl);
    if (lastModelUrlRef.current === resolved && modelRef.current) return;
    lastModelUrlRef.current = resolved;
    loadModelFromUrl(data.modelUrl);
  }, [data.modelUrl, loadModelFromUrl, normalizeModelUrl]);

  const capture = () => {
    initIfNeeded();
    const renderer = rendererRef.current!;
    const scene = sceneRef.current!;
    const camera = cameraRef.current!;
    // 确保一次即时渲染并开启保留绘制缓冲，避免抓到空帧
    const oldPDB = (renderer as any).preserveDrawingBuffer;
    (renderer as any).preserveDrawingBuffer = true;
    renderer.render(scene, camera);
    const canvas = renderer.domElement;
    const dataUrl = canvas.toDataURL('image/png');
    (renderer as any).preserveDrawingBuffer = oldPDB;
    const base64 = dataUrl.split(',')[1];
    // 更新自身
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch: { imageData: base64 } } }));
    
    // 添加到全局历史记录
    const newImageId = `${id}-${Date.now()}`;
    void recordImageHistoryEntry({
      id: newImageId,
      base64,
      title: `3D节点截图 ${new Date().toLocaleTimeString()}`,
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
  };

  const sendToCanvas = () => {
    const img = data.imageData || data.imageUrl;
    if (!img) return;
    const trimmed = img.trim();
    const dataUrl =
      trimmed.startsWith('data:image')
        ? trimmed
        : trimmed.startsWith('blob:')
          ? trimmed
          : trimmed.startsWith('/api/assets/proxy') || trimmed.startsWith('/assets/proxy')
            ? proxifyRemoteAssetUrl(trimmed)
            : /^(templates|projects|uploads|videos)\//i.test(trimmed)
              ? proxifyRemoteAssetUrl(
                  `/api/assets/proxy?key=${encodeURIComponent(
                    trimmed.replace(/^\/+/, '')
                  )}`
                )
              : trimmed.startsWith('http://') || trimmed.startsWith('https://')
                ? trimmed
                : trimmed.startsWith('/') ||
                    trimmed.startsWith('./') ||
                    trimmed.startsWith('../')
                  ? trimmed
                  : `data:image/png;base64,${trimmed}`;
    const fileName = `three_${Date.now()}.png`;
    window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
      detail: { imageData: dataUrl, fileName, operationType: 'generate' }
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
    if (raw.startsWith('data:image')) return raw;
    if (raw.startsWith('blob:')) return raw;
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
    if (raw.startsWith('http://') || raw.startsWith('https://'))
      return proxifyRemoteAssetUrl(raw);
    return `data:image/png;base64,${raw}`;
  })();

  return (
    <div style={{ width: data.boxW || 280, height: data.boxH || 260, padding: 8, background: '#fff', border: `1px solid ${borderColor}`, borderRadius: 8, boxShadow, transition: 'border-color 0.15s ease, box-shadow 0.15s ease', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <NodeResizer isVisible={!!selected} minWidth={220} minHeight={200} color="transparent" lineStyle={{ display: 'none' }} handleStyle={{ background: 'transparent', border: 'none', width: 12, height: 12, opacity: 0 }}
        onResize={(e, p) => { onResize(p.width, p.height); rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: p.width, boxH: p.height } } : n)); }}
        onResizeEnd={(e, p) => { onResize(p.width, p.height); rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: p.width, boxH: p.height } } : n)); }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>3D</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button disabled={isModelUploading} onClick={() => fileInput.current?.click()} style={{ fontSize: 12, padding: '4px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, opacity: isModelUploading ? 0.6 : 1, cursor: isModelUploading ? 'not-allowed' : 'pointer' }}>
            {isModelUploading ? 'Uploading...' : 'Upload'}
          </button>
          <button onClick={addTestCube} style={{ fontSize: 12, padding: '4px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>Cube</button>
          <button onClick={capture} style={{ fontSize: 12, padding: '4px 8px', background: '#111827', color: '#fff', borderRadius: 6 }}>Capture</button>
          <button onClick={sendToCanvas} disabled={!data.imageData && !data.imageUrl} title={!data.imageData && !data.imageUrl ? '无可发送的图像' : '发送到画布'} style={{ fontSize: 12, padding: '4px 8px', background: !data.imageData && !data.imageUrl ? '#e5e7eb' : '#111827', color: '#fff', borderRadius: 6 }}>
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
        className="nodrag nowheel"
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{ flex: 1, minHeight: 120, background: '#fff', borderRadius: 6, border: '1px solid #e5e7eb', display: 'flex', overflow: 'hidden', position: 'relative' }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {err && (<div style={{ position: 'absolute', left: 8, bottom: 8, right: 8, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 10, padding: '4px 6px', borderRadius: 4 }}>{err}</div>)}
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
        imageTitle="全局图片预览"
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
