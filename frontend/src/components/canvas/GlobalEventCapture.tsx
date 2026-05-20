/**
 * Single component that owns ALL window-level event listeners.
 * Publishes every captured event to the CanvasEventBus so that
 * other components can subscribe without touching window directly.
 *
 * Mount exactly once near the root of the app (beside GlobalZoomCapture).
 */
import { useEffect } from 'react';
import { canvasEventBus } from '@/canvas/CanvasEventBus';

const GlobalEventCapture = () => {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onWheel = (e: WheelEvent) => canvasEventBus.emit('wheel', e);
    const onMouseDown = (e: MouseEvent) => canvasEventBus.emit('mousedownCapture', e);
    const onMouseMove = (e: MouseEvent) => canvasEventBus.emit('mousemoveCapture', e);
    const onMouseUp = (e: MouseEvent) => canvasEventBus.emit('mouseupCapture', e);
    const onKeyDown = (e: KeyboardEvent) => canvasEventBus.emit('keydownCapture', e);
    const onKeyUp = (e: KeyboardEvent) => canvasEventBus.emit('keyupCapture', e);
    const onGestureStart = (e: Event) => canvasEventBus.emit('gesturestart', e);
    const onGestureChange = (e: Event) => canvasEventBus.emit('gesturechange', e);
    const onGestureEnd = (e: Event) => canvasEventBus.emit('gestureend', e);

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
