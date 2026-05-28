// @ts-nocheck
import React from 'react';
import { createPortal } from 'react-dom';
import paper from 'paper';
import { useCanvasStore } from '@/stores';

/**
 * MiniMapImageOverlay
 * Adds a <g> layer above the React Flow MiniMap <svg>,
 * reads canvas image instances (window.tanvaImageInstances),
 * and renders them as green rectangles.
 *
 * Notes:
 * - FlowOverlay already syncs ReactFlow viewport with Canvas pan/zoom.
 * - MiniMap viewBox matches world coordinates, so image world bounds can be used directly.
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

  // Pan world coordinates to the view center.
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

  // Convert client coordinates to MiniMap world coordinates.
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

  // Find the MiniMap SVG host element. Stops polling once found.
  React.useEffect(() => {
    let id: number | undefined;
    const find = (): boolean => {
      let host: SVGSVGElement | null = null;
      const container = document.querySelector('.react-flow__minimap') as HTMLElement | null;
      if (container) {
        if (container instanceof SVGSVGElement) host = container as SVGSVGElement;
        else {
          const innerSvg = container.querySelector('svg');
          if (innerSvg instanceof SVGSVGElement) host = innerSvg as SVGSVGElement;
        }
      }
      // Prefer the graph group so this layer inherits the same transforms/clipping.
      const graph = host?.querySelector('.react-flow__minimap-graph') as SVGGElement | null;
      const target = (graph || host) as any;
      if (target) {
        try { if (!(window as any).__minimap_found__) { console.log('[MiniMapImageOverlay] Found MiniMap Graph'); (window as any).__minimap_found__ = true; } } catch {}
        setTargetEl(target);
        if (host) setSvgEl(host);
        return true;
      }
      return false;
    };
    if (!find()) {
      id = window.setInterval(() => {
        if (find() && id !== undefined) window.clearInterval(id);
      }, 500);
    }
    return () => { if (id !== undefined) window.clearInterval(id); };
  }, []);

  const updateImages = React.useCallback(() => {
    try {
      const list = (window as any).tanvaImageInstances || [];
      // Keep visible images only.
      const visible = list.filter((img: any) => img && (img.visible !== false));
      const dpr = (window.devicePixelRatio || 1);
      const mapped = visible.map((img: any) => ({
        id: img.id,
        x: Number(img.bounds?.x || 0) / dpr,
        y: Number(img.bounds?.y || 0) / dpr,
        width: Number(img.bounds?.width || 0) / dpr,
        height: Number(img.bounds?.height || 0) / dpr,
      }));
      // Build a signature and update state only when changed.
      const sig = JSON.stringify(mapped);
      if (sig !== lastSigRef.current) {
        lastSigRef.current = sig;
        setImages(mapped);
      }
    } catch {}
  }, []);

  // Event-driven refresh when image instances change.
  React.useEffect(() => {
    const onUpdate = () => updateImages();
    window.addEventListener("tanva-image-instances-updated", onUpdate);
    return () => window.removeEventListener("tanva-image-instances-updated", onUpdate);
  }, [updateImages]);

  // Lightweight fallback polling in case events are missed.
  React.useEffect(() => {
    const id = window.setInterval(() => updateImages(), 1000);
    return () => window.clearInterval(id);
  }, [updateImages]);

  React.useEffect(() => {
    if (!targetEl) return;
    updateImages();
  }, [targetEl, updateImages]);

  // Click MiniMap to quickly center viewport.
  React.useEffect(() => {
    if (!svgEl) return;
    const onClick = (ev: MouseEvent) => {
      try {
        const world = clientToWorld(ev.clientX, ev.clientY);
        if (!world) return;

        // If clicked inside an image block, use its center; otherwise use click position.
        const hit = images.find(m => world.x >= m.x && world.x <= m.x + m.width && world.y >= m.y && world.y <= m.y + m.height);
        const worldX = hit ? (hit.x + hit.width / 2) : world.x;
        const worldY = hit ? (hit.y + hit.height / 2) : world.y;

        panToWorldCenter(worldX, worldY);
      } catch {}
    };
    svgEl.addEventListener('click', onClick);
    return () => svgEl.removeEventListener('click', onClick);
  }, [svgEl, images, clientToWorld, panToWorldCenter]);

  // Drag on MiniMap to pan canvas.
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
          fill="#10b98155" // Semi-transparent green with no stroke.
          rx={2}
          ry={2}
        />
      ))}
    </g>,
    targetEl
  );
};

export default MiniMapImageOverlay;
