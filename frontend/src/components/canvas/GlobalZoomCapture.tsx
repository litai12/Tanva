import { useEffect, useRef } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import { normalizeWheelDelta, computeSmoothZoom } from '@/lib/zoomUtils';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

interface GestureLikeEvent extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

/**
 * 捕获全局的双指缩放/捏合手势，统一转化为画布缩放百分比。
 * 这样无论手势发生在节点、AI对话框还是其他浮层上，都不会触发浏览器分辨率缩放。
 */
const GlobalZoomCapture = () => {
  const gestureStartZoomRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const getCanvasMetrics = () => {
      const canvas = paper?.view?.element as HTMLCanvasElement | undefined;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return { rect, dpr };
    };

    const getFocusPoint = (clientX: number, clientY: number) => {
      const metrics = getCanvasMetrics();
      if (!metrics) return null;
      const { rect, dpr } = metrics;
      const clampedX = clamp(clientX, rect.left, rect.right);
      const clampedY = clamp(clientY, rect.top, rect.bottom);
      return {
        sx: (clampedX - rect.left) * dpr,
        sy: (clampedY - rect.top) * dpr,
      };
    };

    const applyZoom = (focusX: number, focusY: number, deltaZoom: number) => {
      const store = useCanvasStore.getState();
      const currentZoom = store.zoom || 1;
      const nextZoom = computeSmoothZoom(currentZoom, deltaZoom, { sensitivity: store.zoomSensitivity });
      if (currentZoom === nextZoom) return;
      const nextPanX = store.panX + focusX * (1 / nextZoom - 1 / currentZoom);
      const nextPanY = store.panY + focusY * (1 / nextZoom - 1 / currentZoom);
      store.setPan(nextPanX, nextPanY);
      store.setZoom(nextZoom);
    };

    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const focus = getFocusPoint(event.clientX, event.clientY);
      if (!focus) return;
      const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
      if (Math.abs(delta) < 1e-6) return;
      event.preventDefault();
      event.stopPropagation();
      applyZoom(focus.sx, focus.sy, delta);
    };

    const handleGestureStart = (event: GestureLikeEvent) => {
      if (event.scale == null || event.clientX == null || event.clientY == null) return;
      const focus = getFocusPoint(event.clientX, event.clientY);
      if (!focus) return;
      event.preventDefault();
      event.stopPropagation();
      const store = useCanvasStore.getState();
      gestureStartZoomRef.current = store.zoom || 1;
    };

    const handleGestureChange = (event: GestureLikeEvent) => {
      if (gestureStartZoomRef.current == null) return;
      if (event.scale == null || event.clientX == null || event.clientY == null) return;
      const focus = getFocusPoint(event.clientX, event.clientY);
      if (!focus) return;
      const baseZoom = gestureStartZoomRef.current;
      const store = useCanvasStore.getState();
      const targetZoom = clamp(baseZoom * event.scale, 0.1, 3);
      const currentZoom = store.zoom || 1;
      if (Math.abs(targetZoom - currentZoom) < 1e-4) return;
      event.preventDefault();
      event.stopPropagation();
      const nextPanX = store.panX + focus.sx * (1 / targetZoom - 1 / currentZoom);
      const nextPanY = store.panY + focus.sy * (1 / targetZoom - 1 / currentZoom);
      store.setPan(nextPanX, nextPanY);
      store.setZoom(targetZoom);
    };

    const handleGestureEnd = () => {
      gestureStartZoomRef.current = null;
    };

    const gestureStartListener: EventListener = (event) =>
      handleGestureStart(event as GestureLikeEvent);
    const gestureChangeListener: EventListener = (event) =>
      handleGestureChange(event as GestureLikeEvent);
    const gestureEndListener: EventListener = () => handleGestureEnd();

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', gestureStartListener, { passive: false });
    window.addEventListener('gesturechange', gestureChangeListener, { passive: false });
    window.addEventListener('gestureend', gestureEndListener, { passive: false });

    return () => {
      window.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('gesturestart', gestureStartListener);
      window.removeEventListener('gesturechange', gestureChangeListener);
      window.removeEventListener('gestureend', gestureEndListener);
    };
  }, []);

  return null;
};

export default GlobalZoomCapture;
