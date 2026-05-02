import { useCanvasStore } from "@/stores";

export interface CanvasViewportFrame {
  zoom: number;
  panX: number;
  panY: number;
  dpr: number;
  paperX: number;
  paperY: number;
  flowX: number;
  flowY: number;
}

type ViewportFrameListener = (frame: CanvasViewportFrame) => void;
type ViewportFrameListenerOptions = {
  immediate?: boolean;
  priority?: number;
};

const listeners = new Map<ViewportFrameListener, Required<ViewportFrameListenerOptions>>();

let unsubscribeStore: (() => void) | null = null;
let frameRaf: number | null = null;
let lastStoreViewport: Pick<CanvasViewportFrame, "zoom" | "panX" | "panY"> | null =
  null;

const readViewportFrame = (): CanvasViewportFrame => {
  const state = useCanvasStore.getState();
  const zoom = Number.isFinite(Number(state.zoom)) && Number(state.zoom) > 0
    ? Number(state.zoom)
    : 1;
  const panX = Number.isFinite(Number(state.panX)) ? Number(state.panX) : 0;
  const panY = Number.isFinite(Number(state.panY)) ? Number(state.panY) : 0;
  const dpr =
    typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio || 1
      : 1;
  const paperX = panX * zoom;
  const paperY = panY * zoom;

  return {
    zoom,
    panX,
    panY,
    dpr,
    paperX,
    paperY,
    flowX: paperX / dpr,
    flowY: paperY / dpr,
  };
};

const viewportChanged = (
  prev: Pick<CanvasViewportFrame, "zoom" | "panX" | "panY"> | null,
  next: Pick<CanvasViewportFrame, "zoom" | "panX" | "panY">
) =>
  !prev ||
  prev.zoom !== next.zoom ||
  prev.panX !== next.panX ||
  prev.panY !== next.panY;

const flushViewportFrame = () => {
  frameRaf = null;
  const frame = readViewportFrame();
  Array.from(listeners.entries())
    .sort(([, a], [, b]) => a.priority - b.priority)
    .forEach(([listener]) => {
      try {
        listener(frame);
      } catch {
        /* A stale viewport consumer should not block other layers. */
      }
    });
};

const scheduleViewportFrame = () => {
  if (typeof window === "undefined") {
    flushViewportFrame();
    return;
  }
  if (frameRaf !== null) return;
  frameRaf = window.requestAnimationFrame(flushViewportFrame);
};

const ensureStoreSubscription = () => {
  if (unsubscribeStore) return;
  lastStoreViewport = readViewportFrame();
  unsubscribeStore = useCanvasStore.subscribe((state) => {
    const next = {
      zoom: Number.isFinite(Number(state.zoom)) && Number(state.zoom) > 0
        ? Number(state.zoom)
        : 1,
      panX: Number.isFinite(Number(state.panX)) ? Number(state.panX) : 0,
      panY: Number.isFinite(Number(state.panY)) ? Number(state.panY) : 0,
    };
    if (!viewportChanged(lastStoreViewport, next)) return;
    lastStoreViewport = next;
    scheduleViewportFrame();
  });
};

const teardownStoreSubscription = () => {
  if (listeners.size > 0) return;
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  lastStoreViewport = null;
  if (frameRaf !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(frameRaf);
  }
  frameRaf = null;
};

export const getCanvasViewportFrame = () => readViewportFrame();

export const subscribeCanvasViewportFrame = (
  listener: ViewportFrameListener,
  options: ViewportFrameListenerOptions = {}
) => {
  const normalizedOptions = {
    immediate: options.immediate !== false,
    priority: Number.isFinite(Number(options.priority))
      ? Number(options.priority)
      : 0,
  };
  listeners.set(listener, normalizedOptions);
  ensureStoreSubscription();

  if (normalizedOptions.immediate) {
    listener(readViewportFrame());
  }

  return () => {
    listeners.delete(listener);
    teardownStoreSubscription();
  };
};
