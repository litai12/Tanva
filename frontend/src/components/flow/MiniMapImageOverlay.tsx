// @ts-nocheck
import React from 'react';
import { createPortal } from 'react-dom';
import paper from 'paper';
import { useCanvasStore } from '@/stores';

/**
 * MiniMapImageOverlay
 * 在 React Flow 的 MiniMap <svg> 上方追加一层 <g>，
 * 读取画布中的图片实例（window.tanvaImageInstances）并以绿色矩形表示。
 *
 * 说明：
 * - FlowOverlay 已把 ReactFlow 的视口与 Canvas 的 pan/zoom 同步。
 * - MiniMap 的 viewBox 与节点/世界坐标一致，因此直接用图片的世界坐标即可。
 */
const MiniMapImageOverlay: React.FC = () => {
  const [svgEl, setSvgEl] = React.useState<SVGSVGElement | null>(null);
  const [targetEl, setTargetEl] = React.useState<SVGGElement | SVGSVGElement | null>(null);
  const [images, setImages] = React.useState<Array<{ id: string; x: number; y: number; width: number; height: number }>>([]);
  const lastSigRef = React.useRef("");
  const dragState = React.useRef<{ active: boolean; pointerId: number | null; lastEvent: PointerEvent | null; raf: number }>({
    active: false,
    pointerId: null,
    lastEvent: null,
    raf: 0,
  });

  // 将世界坐标平移到视图中心
  const panToWorldCenter = React.useCallback((worldX: number, worldY: number) => {
    try {
      const { zoom, setPan } = useCanvasStore.getState();
      const vs = paper?.view?.viewSize;
      const cx = vs ? vs.width / 2 : window.innerWidth / 2;
      const cy = vs ? vs.height / 2 : window.innerHeight / 2;
      const desiredPanX = (cx / (zoom || 1)) - worldX;
      const desiredPanY = (cy / (zoom || 1)) - worldY;
      setPan(desiredPanX, desiredPanY);
    } catch {}
  }, []);

  // 将客户端坐标转换为 minimap 世界坐标
  const clientToWorld = React.useCallback((clientX: number, clientY: number) => {
    if (!svgEl) return null;
    const pt = svgEl.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    const inv = ctm.inverse();
    const svgPt = pt.matrixTransform(inv);
    return { x: svgPt.x, y: svgPt.y };
  }, [svgEl]);

  // 获取 minimap 的 svg 元素
  React.useEffect(() => {
    const find = () => {
      let host: SVGSVGElement | null = null;
      const container = document.querySelector('.react-flow__minimap') as HTMLElement | null;
      if (container) {
        if (container instanceof SVGSVGElement) host = container as SVGSVGElement;
        else {
          const innerSvg = container.querySelector('svg');
          if (innerSvg instanceof SVGSVGElement) host = innerSvg as SVGSVGElement;
        }
      }
      // 优先插入到 graph 分组，这样能继承同样的缩放/裁剪
      const graph = host?.querySelector('.react-flow__minimap-graph') as SVGGElement | null;
      const target = (graph || host) as any;
      if (target) {
        try { if (!(window as any).__minimap_found__) { console.log('[MiniMapImageOverlay] Found MiniMap Graph'); (window as any).__minimap_found__ = true; } } catch {}
        setTargetEl(target);
        if (host) setSvgEl(host);
      }
    };
    find();
    const id = window.setInterval(find, 500);
    return () => window.clearInterval(id);
  }, []);

  const updateImages = React.useCallback(() => {
    try {
      const list = (window as any).tanvaImageInstances || [];
      // 仅保留可见图片
      const visible = list.filter((img: any) => img && (img.visible !== false));
      const dpr = (window.devicePixelRatio || 1);
      const mapped = visible.map((img: any) => ({
        id: img.id,
        x: Number(img.bounds?.x || 0) / dpr,
        y: Number(img.bounds?.y || 0) / dpr,
        width: Number(img.bounds?.width || 0) / dpr,
        height: Number(img.bounds?.height || 0) / dpr,
      }));
      // 生成签名，发生变更再更新状态
      const sig = JSON.stringify(mapped);
      if (sig !== lastSigRef.current) {
        lastSigRef.current = sig;
        setImages(mapped);
      }
    } catch {}
  }, []);

  // 事件驱动：图片实例更新后立即刷新 MiniMap
  React.useEffect(() => {
    const onUpdate = () => updateImages();
    window.addEventListener("tanva-image-instances-updated", onUpdate);
    return () => window.removeEventListener("tanva-image-instances-updated", onUpdate);
  }, [updateImages]);

  // 轻量兜底轮询，避免极端情况下事件遗漏
  React.useEffect(() => {
    const id = window.setInterval(() => updateImages(), 1000);
    return () => window.clearInterval(id);
  }, [updateImages]);

  React.useEffect(() => {
    if (!targetEl) return;
    updateImages();
  }, [targetEl, updateImages]);

  // 点击 MiniMap 快速跳转到视图
  React.useEffect(() => {
    if (!svgEl) return;
    const onClick = (ev: MouseEvent) => {
      try {
        const world = clientToWorld(ev.clientX, ev.clientY);
        if (!world) return;

        // 若点击位置落在某个图片块内，则用该块中心点；否则就用点击处
        const hit = images.find(m => world.x >= m.x && world.x <= m.x + m.width && world.y >= m.y && world.y <= m.y + m.height);
        const worldX = hit ? (hit.x + hit.width / 2) : world.x;
        const worldY = hit ? (hit.y + hit.height / 2) : world.y;

        panToWorldCenter(worldX, worldY);
      } catch {}
    };
    svgEl.addEventListener('click', onClick);
    return () => svgEl.removeEventListener('click', onClick);
  }, [svgEl, images, clientToWorld, panToWorldCenter]);

  // 在 MiniMap 上按住拖动以平移画布
  React.useEffect(() => {
    const el = svgEl;
    if (!el) return;
    const state = dragState.current;

    const applyDrag = () => {
      state.raf = 0;
      const ev = state.lastEvent;
      if (!ev) return;
      const world = clientToWorld(ev.clientX, ev.clientY);
      if (!world) return;
      panToWorldCenter(world.x, world.y);
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      state.active = true;
      state.pointerId = ev.pointerId;
      state.lastEvent = ev;
      try { el.setPointerCapture(ev.pointerId); } catch {}
      ev.preventDefault();
      applyDrag();
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!state.active || state.pointerId !== ev.pointerId) return;
      state.lastEvent = ev;
      if (!state.raf) state.raf = window.requestAnimationFrame(applyDrag);
    };

    const stopDrag = (ev: PointerEvent) => {
      if (!state.active || state.pointerId !== ev.pointerId) return;
      state.active = false;
      state.pointerId = null;
      state.lastEvent = null;
      if (state.raf) {
        window.cancelAnimationFrame(state.raf);
        state.raf = 0;
      }
      try { el.releasePointerCapture(ev.pointerId); } catch {}
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', stopDrag);
    el.addEventListener('pointercancel', stopDrag);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', stopDrag);
      el.removeEventListener('pointercancel', stopDrag);
      if (state.raf) window.cancelAnimationFrame(state.raf);
    };
  }, [svgEl, clientToWorld, panToWorldCenter]);

  if (!targetEl || images.length === 0) return null;

  return createPortal(
    <g className="tanva-minimap-images" style={{ pointerEvents: 'none' as const }}>
      {images.map((img) => (
        <rect
          key={img.id}
          x={img.x}
          y={img.y}
          width={Math.max(0, img.width)}
          height={Math.max(0, img.height)}
          fill="#10b98155" // 绿色半透明，无描边
          rx={2}
          ry={2}
        />
      ))}
    </g>,
    targetEl
  );
};

export default MiniMapImageOverlay;
