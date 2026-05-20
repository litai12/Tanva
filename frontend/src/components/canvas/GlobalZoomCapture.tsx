import { useEffect, useRef } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import { normalizeWheelDelta, computeSmoothZoom } from '@/lib/zoomUtils';
import { NodeManager } from '@/canvas/NodeManager';

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
const FLOW_OVERLAY_SELECTOR = '.tanva-flow-overlay';

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

const shouldBypassCanvasZoom = (
  event: Event,
  options?: { ignoreFlowOverlay?: boolean }
) => {
  const includeFlowOverlay = options?.ignoreFlowOverlay ? false : true;
  const path = getEventPath(event);
  if (includeFlowOverlay && pathContainsSelector(path, FLOW_OVERLAY_SELECTOR)) {
    return true;
  }
  if (
    pathContainsSelector(path, MODEL3D_CONTAINER_SELECTOR) ||
    pathContainsSelector(path, FLOW_THREE_NODE_SELECTOR)
  ) {
    return true;
  }

  const element = resolveEventElement(event);
  if (
    (includeFlowOverlay && element?.closest(FLOW_OVERLAY_SELECTOR)) ||
    element?.closest(MODEL3D_CONTAINER_SELECTOR) ||
    element?.closest(FLOW_THREE_NODE_SELECTOR)
  ) {
    return true;
  }

  return (
    (includeFlowOverlay && pointHitsSelector(event, FLOW_OVERLAY_SELECTOR)) ||
    pointHitsSelector(event, MODEL3D_CONTAINER_SELECTOR) ||
    pointHitsSelector(event, FLOW_THREE_NODE_SELECTOR)
  );
};

/**
 * Capture global pinch/zoom gestures and translate them into canvas zoom.
 * This prevents browser-level page zoom regardless of gesture origin.
 */
const GlobalZoomCapture = () => {
  const gestureStartZoomRef = useRef<number | null>(null);
  const pendingViewportRef = useRef<{ panX: number; panY: number; zoom: number } | null>(null);
  const viewportRafRef = useRef<number | null>(null);
  const pinchEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const flushViewport = () => {
      viewportRafRef.current = null;
      const next = pendingViewportRef.current;
      pendingViewportRef.current = null;
      if (!next) return;
      useCanvasStore.getState().setViewport(next);
    };

    const scheduleViewport = (viewport: { panX: number; panY: number; zoom: number }) => {
      pendingViewportRef.current = viewport;
      if (viewportRafRef.current !== null) return;
      viewportRafRef.current = window.requestAnimationFrame(flushViewport);
    };

    const getViewportState = () => {
      const pending = pendingViewportRef.current;
      if (pending) return pending;
      const store = useCanvasStore.getState();
      return {
        panX: store.panX,
        panY: store.panY,
        zoom: store.zoom || 1,
      };
    };

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
      const viewport = getViewportState();
      const store = useCanvasStore.getState();
      const currentZoom = viewport.zoom || 1;
      const nextZoom = computeSmoothZoom(currentZoom, deltaZoom, { sensitivity: store.zoomSensitivity });
      if (currentZoom === nextZoom) return;
      const nextPanX = viewport.panX + focusX * (1 / nextZoom - 1 / currentZoom);
      const nextPanY = viewport.panY + focusY * (1 / nextZoom - 1 / currentZoom);
      scheduleViewport({
        panX: nextPanX,
        panY: nextPanY,
        zoom: nextZoom,
      });
    };

    const handleWheel = (event: WheelEvent) => {
      if (shouldBypassCanvasZoom(event)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const store = useCanvasStore.getState();

      // In reverse mode, Ctrl/Cmd + wheel does not zoom canvas, but still blocks page zoom.
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
      NodeManager.getInstance().setViewportMoving(true);
      if (pinchEndTimerRef.current) clearTimeout(pinchEndTimerRef.current);
      pinchEndTimerRef.current = setTimeout(() => {
        NodeManager.getInstance().setViewportMoving(false);
      }, 150);
      applyZoom(focus.sx, focus.sy, delta);
    };

    const handleGestureStart = (event: GestureLikeEvent) => {
      if (shouldBypassCanvasZoom(event, { ignoreFlowOverlay: true })) return;
      if (event.scale == null || event.clientX == null || event.clientY == null) return;
      const focus = getFocusPoint(event.clientX, event.clientY);
      if (!focus) return;
      event.preventDefault();
      event.stopPropagation();
      NodeManager.getInstance().setViewportMoving(true);
      gestureStartZoomRef.current = getViewportState().zoom || 1;
    };

    const handleGestureChange = (event: GestureLikeEvent) => {
      if (shouldBypassCanvasZoom(event, { ignoreFlowOverlay: true })) return;
      if (gestureStartZoomRef.current == null) return;
      if (event.scale == null || event.clientX == null || event.clientY == null) return;
      const focus = getFocusPoint(event.clientX, event.clientY);
      if (!focus) return;
      const baseZoom = gestureStartZoomRef.current;
      const targetZoom = clamp(baseZoom * event.scale, 0.1, 4);
      const viewport = getViewportState();
      const currentZoom = viewport.zoom || 1;
      event.preventDefault();
      event.stopPropagation();
      if (Math.abs(targetZoom - currentZoom) < 1e-4) return;
      const nextPanX = viewport.panX + focus.sx * (1 / targetZoom - 1 / currentZoom);
      const nextPanY = viewport.panY + focus.sy * (1 / targetZoom - 1 / currentZoom);
      scheduleViewport({
        panX: nextPanX,
        panY: nextPanY,
        zoom: targetZoom,
      });
    };

    const handleGestureEnd = () => {
      gestureStartZoomRef.current = null;
      NodeManager.getInstance().setViewportMoving(false);
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
      if (viewportRafRef.current !== null) {
        window.cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
      }
      pendingViewportRef.current = null;
      window.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('gesturestart', gestureStartListener);
      window.removeEventListener('gesturechange', gestureChangeListener);
      window.removeEventListener('gestureend', gestureEndListener);
      if (pinchEndTimerRef.current) clearTimeout(pinchEndTimerRef.current);
    };
  }, []);

  return null;
};

export default GlobalZoomCapture;
