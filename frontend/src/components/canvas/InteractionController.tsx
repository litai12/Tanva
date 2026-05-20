import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores';
import { normalizeWheelDelta, computeSmoothZoom } from '@/lib/zoomUtils';
import { NodeManager } from '@/canvas/NodeManager';

interface InteractionControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const InteractionController: React.FC<InteractionControllerProps> = ({ canvasRef }) => {
  const zoomRef = useRef(1);
  const zoomEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoom = useCanvasStore((state) => state.zoom);
  const setPan = useCanvasStore((state) => state.setPan);
  const setViewport = useCanvasStore((state) => state.setViewport);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      const store = useCanvasStore.getState();

      if (store.isOperationInProgress) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const isModifierWheel = event.ctrlKey || event.metaKey;
      const shouldZoom =
        store.wheelZoomMode === 'direct' ? !isModifierWheel : isModifierWheel;

      if (shouldZoom) {
        event.preventDefault();
        event.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const sx = (event.clientX - rect.left) * dpr;
        const sy = (event.clientY - rect.top) * dpr;

        const z1 = zoomRef.current;
        const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
        if (Math.abs(delta) < 1e-6) return;

        const z2 = computeSmoothZoom(z1, delta, { sensitivity: store.zoomSensitivity });
        if (z1 === z2) return;

        const pan2x = store.panX + sx * (1 / z2 - 1 / z1);
        const pan2y = store.panY + sy * (1 / z2 - 1 / z1);

        NodeManager.getInstance().setViewportMoving(true);
        if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current);
        zoomEndTimerRef.current = setTimeout(() => {
          NodeManager.getInstance().setViewportMoving(false);
        }, 150);

        setViewport({ panX: pan2x, panY: pan2y, zoom: z2 });
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) > 0) {
        const dpr = window.devicePixelRatio || 1;
        const worldDeltaX = (-event.deltaX * dpr) / zoomRef.current;
        const worldDeltaY = (-event.deltaY * dpr) / zoomRef.current;

        const newPanX = store.panX + worldDeltaX;
        const newPanY = store.panY + worldDeltaY;
        setPan(newPanX, newPanY);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current);
    };
  }, [setPan, setViewport, canvasRef]);

  return null;
};

export default InteractionController;
