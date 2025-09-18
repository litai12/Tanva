import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Send as SendIcon } from 'lucide-react';

type Props = {
  id: string;
  data: {
    imageData?: string;
    modelUrl?: string;
    boxW?: number; boxH?: number;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

export default function ThreeNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const modelRef = React.useRef<THREE.Object3D | null>(null);
  const gridRef = React.useRef<THREE.GridHelper | null>(null);
  const axesRef = React.useRef<THREE.AxesHelper | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const animRef = React.useRef<number | null>(null);
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);

  const initIfNeeded = React.useCallback(() => {
    if (!containerRef.current) return;
    if (rendererRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = Math.max(220, Math.floor(rect.width || ((data.boxW || 260) - 16)));
    const h = Math.max(140, Math.floor(rect.height || ((data.boxH || 220) - 64)));
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false; // 只允许旋转/缩放，不平移
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
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    // Resize observer to keep renderer matching container size
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const r = rendererRef.current, c = cameraRef.current;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (r && c && width > 0 && height > 0) {
        r.setSize(width, height);
        c.aspect = width / height;
        c.updateProjectionMatrix();
      }
    });
    ro.observe(containerRef.current);
  }, [data.boxW, data.boxH]);

  React.useEffect(() => {
    const t = setTimeout(() => initIfNeeded(), 0); // 等布局稳定再初始化
    return () => { clearTimeout(t); if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [initIfNeeded]);

  const onResize = (w: number, h: number) => {
    const r = rendererRef.current, c = cameraRef.current;
    if (r && c) {
      r.setSize(Math.max(220, w - 16), Math.max(140, h - 64));
      c.aspect = r.domElement.width / r.domElement.height;
      c.updateProjectionMatrix();
    }
  };

  const fitToObject = (obj: THREE.Object3D) => {
    const camera = cameraRef.current!;
    const controls = controlsRef.current!;
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let dist = (maxDim / (2 * Math.tan(fov / 2))); // distance required to fit object
    dist *= 1.3; // padding
    const direction = new THREE.Vector3(1, 0.8, 1).normalize();
    camera.position.copy(center.clone().add(direction.multiplyScalar(dist)));
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  };

  const loadModel = (file: File) => {
    initIfNeeded();
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    // 支持 Draco 压缩的 glb/gltf
    try {
      const draco = new DRACOLoader();
      // 使用线上解码器（浏览器端加载），若离线可改为本地路径
      draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
      loader.setDRACOLoader(draco);
    } catch {}

    loader.load(url, (gltf) => {
      const scene = sceneRef.current!;
      if (modelRef.current) scene.remove(modelRef.current);
      modelRef.current = gltf.scene;
      scene.add(gltf.scene);
      try { fitToObject(gltf.scene); } catch {}
      URL.revokeObjectURL(url);
      setErr(null);
      // 上传成功后隐藏辅助
      if (gridRef.current) gridRef.current.visible = false;
      if (axesRef.current) axesRef.current.visible = false;
    }, undefined, (e) => { console.error('load gltf failed', e); setErr('加载模型失败，可能需要Draco/KTX2解码'); });
  };

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
  };

  const sendToCanvas = () => {
    const img = data.imageData;
    if (!img) return;
    const dataUrl = `data:image/png;base64,${img}`;
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

  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;

  return (
    <div style={{ width: data.boxW || 280, height: data.boxH || 260, padding: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <NodeResizer isVisible={!!selected} minWidth={220} minHeight={200} color="transparent" lineStyle={{ display: 'none' }} handleStyle={{ background: 'transparent', border: 'none', width: 12, height: 12, opacity: 0 }}
        onResize={(e, p) => { onResize(p.width, p.height); rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: p.width, boxH: p.height } } : n)); }}
        onResizeEnd={(e, p) => { onResize(p.width, p.height); rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: p.width, boxH: p.height } } : n)); }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>3D</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => fileInput.current?.click()} style={{ fontSize: 12, padding: '4px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>Upload</button>
          <button onClick={addTestCube} style={{ fontSize: 12, padding: '4px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>Cube</button>
          <button onClick={capture} style={{ fontSize: 12, padding: '4px 8px', background: '#111827', color: '#fff', borderRadius: 6 }}>Capture</button>
          <button onClick={sendToCanvas} disabled={!data.imageData} title={!data.imageData ? '无可发送的图像' : '发送到画布'} style={{ fontSize: 12, padding: '4px 8px', background: !data.imageData ? '#e5e7eb' : '#111827', color: '#fff', borderRadius: 6 }}>
            <SendIcon size={14} />
          </button>
        </div>
      </div>
      <input ref={fileInput} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadModel(f); }} />
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
      {preview && src && (
        <div onClick={() => setPreview(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <img src={src} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', background: '#000' }} />
        </div>
      )}
    </div>
  );
}
