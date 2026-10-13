/**
 * Single component that owns ALL window-level event listeners.
 * Publishes every captured event to the CanvasEventBus so that
 * other components can subscribe without touching window directly.
 *
 * Mount exactly once near the root of the app (beside GlobalZoomCapture).
 */
import { useEffect } from 'react';
import { canvasEventBus, type CanvasEventMap, type CanvasEventType } from '@/canvas/CanvasEventBus';

const IMAGE_PREVIEW_SELECTOR = '[data-image-preview-modal="true"]';
const CANVAS_CONTROL_SELECTOR = '[data-canvas-control="true"]';

function emitCanvasEvent<T extends CanvasEventType>(type: T, event: CanvasEventMap[T]) {
  // Window capture runs before the preview's zoom/pan handlers. Leave those
  // events available to the preview without also moving the underlying canvas.
  if (event.composedPath().some((target) =>
    target instanceof Element && (target.matches(IMAGE_PREVIEW_SELECTOR) || target.matches(CANVAS_CONTROL_SELECTOR))
  )) return;
  if (event instanceof KeyboardEvent && document.querySelector(IMAGE_PREVIEW_SELECTOR)) return;
  if (event instanceof KeyboardEvent && document.querySelector('[data-canvas-background-popover="true"]')) return;
  canvasEventBus.emit(type, event);
}

const GlobalEventCapture = () => {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onWheel = (e: WheelEvent) => emitCanvasEvent('wheel', e);
    const onMouseDown = (e: MouseEvent) => emitCanvasEvent('mousedownCapture', e);
    const onMouseMove = (e: MouseEvent) => emitCanvasEvent('mousemoveCapture', e);
    const onMouseUp = (e: MouseEvent) => emitCanvasEvent('mouseupCapture', e);
    const onKeyDown = (e: KeyboardEvent) => emitCanvasEvent('keydownCapture', e);
    const onKeyUp = (e: KeyboardEvent) => emitCanvasEvent('keyupCapture', e);
    const onGestureStart = (e: Event) => emitCanvasEvent('gesturestart', e);
    const onGestureChange = (e: Event) => emitCanvasEvent('gesturechange', e);
    const onGestureEnd = (e: Event) => emitCanvasEvent('gestureend', e);

    // capture: true so we intercept before any React synthetic handler
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mousemove', onMouseMove, { capture: true });
    window.addEventListener('mouseup', onMouseUp, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('gesturestart', onGestureStart, { passive: false });
    window.addEventListener('gesturechange', onGestureChange, { passive: false });
    window.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('gesturestart', onGestureStart);
      window.removeEventListener('gesturechange', onGestureChange);
      window.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  return null;
};

export default GlobalEventCapture;
