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

const MODEL3D_CONTAINER_SELECTOR = '[data-model3d-container="true"]';
const FLOW_THREE_NODE_SELECTOR =
  '[data-flow-three-node-viewport="true"], .react-flow__node-three, .react-flow__node-threePathTracer';

const getEventPath = (event: Event): EventTarget[] => {
  const composedPath = (event as Event & { composedPath?: () => EventTarget[] })
    .composedPath;
  if (typeof composedPath !== 'function') return [];
  try {
    const path = composedPath.call(event);
    return Array.isArray(path) ? path : [];
  } catch {
    return [];
  }
};

const pathContainsSelector = (path: EventTarget[], selector: string) =>
  path.some((node) => node instanceof Element && Boolean(node.closest(selector)));

const resolveEventElement = (event: Event): Element | null => {
  if (event.target instanceof Element) return event.target;
  const path = getEventPath(event);
  const pathElement = path.find((node) => node instanceof Element);
  if (pathElement instanceof Element) return pathElement;
  const anyEvent = event as Event & { clientX?: number; clientY?: number };
  const x = Number(anyEvent.clientX);
  const y = Number(anyEvent.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y) || typeof document === 'undefined') {
    return null;
  }
  return document.elementFromPoint(x, y);
};

const pointHitsSelector = (event: Event, selector: string): boolean => {
  const anyEvent = event as Event & { clientX?: number; clientY?: number };
  const x = Number(anyEvent.clientX);
  const y = Number(anyEvent.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y) || typeof document === 'undefined') {
    return false;
  }
  const element = document.elementFromPoint(x, y);
  return Boolean(element?.closest(selector));
};

const shouldBypassCanvasZoom = (event: Event) => {
  const path = getEventPath(event);
  if (
    pathContainsSelector(path, MODEL3D_CONTAINER_SELECTOR) ||
    pathContainsSelector(path, FLOW_THREE_NODE_SELECTOR)
  ) {
    return true;
  }

  const element = resolveEventElement(event);
  if (
    element?.closest(MODEL3D_CONTAINER_SELECTOR) ||
    element?.closest(FLOW_THREE_NODE_SELECTOR)
  ) {
    return true;
  }

  return (
    pointHitsSelector(event, MODEL3D_CONTAINER_SELECTOR) ||
    pointHitsSelector(event, FLOW_THREE_NODE_SELECTOR)
  );
};

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
      if (shouldBypassCanvasZoom(event)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const store = useCanvasStore.getState();

      // 反转模式下，Ctrl/Cmd + 滚轮不执行缩放，但仍阻止浏览器页面缩放
      if (store.wheelZoomMode === 'direct') {
        event.preventDefault();
        return;
      }

      const focus = getFocusPoint(event.clientX, event.clientY);
      if (!focus) return;
      const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
      if (Math.abs(delta) < 1e-6) return;
      event.preventDefault();
      event.stopPropagation();
      applyZoom(focus.sx, focus.sy, delta);
    };

    const handleGestureStart = (event: GestureLikeEvent) => {
      if (shouldBypassCanvasZoom(event)) return;
      if (event.scale == null || event.clientX == null || event.clientY == null) return;
      const focus = getFocusPoint(event.clientX, event.clientY);
      if (!focus) return;
      event.preventDefault();
      event.stopPropagation();
      const store = useCanvasStore.getState();
      gestureStartZoomRef.current = store.zoom || 1;
    };

    const handleGestureChange = (event: GestureLikeEvent) => {
      if (shouldBypassCanvasZoom(event)) return;
      if (gestureStartZoomRef.current == null) return;
      if (event.scale == null || event.clientX == null || event.clientY == null) return;
      const focus = getFocusPoint(event.clientX, event.clientY);
      if (!focus) return;
      const baseZoom = gestureStartZoomRef.current;
      const store = useCanvasStore.getState();
      const targetZoom = clamp(baseZoom * event.scale, 0.1, 4);
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
