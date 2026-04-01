import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores';
import { useCurrentTool } from '@/stores/toolStore';
import { normalizeWheelDelta, computeSmoothZoom } from '@/lib/zoomUtils';
import { getCursorForDrawMode } from '@/utils/cursorStyles';

interface InteractionControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const InteractionController: React.FC<InteractionControllerProps> = ({ canvasRef }) => {
  const isDraggingRef = useRef(false); // Drag state cache.
  const zoomRef = useRef(1); // Cache zoom value to avoid frequent getState calls.
  const { zoom, setPan, setDragging } = useCanvasStore();
  const drawMode = useCurrentTool();
  const drawModeRef = useRef(drawMode);

  // Sync cached zoom value.
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Canvas interaction - keep only middle-button drag.
    let isDragging = false;
    let lastScreenPoint: { x: number, y: number } | null = null;
    let dragStartPanX = 0;
    let dragStartPanY = 0;
    let dragAnimationId: number | null = null;

    const stopDragging = () => {
      if (!isDragging) return;
      isDragging = false;
      isDraggingRef.current = false;
      setDragging(false);
      lastScreenPoint = null;
      if (dragAnimationId) {
        cancelAnimationFrame(dragAnimationId);
        dragAnimationId = null;
      }
      if (canvas) {
        canvas.style.cursor = getCursorForDrawMode(drawModeRef.current) || 'default';
      }
    };

    // Mouse event handlers.
    const handleMouseDown = (event: MouseEvent) => {
      // Only respond to middle button (button === 1).
      if (event.button === 1) {
        event.preventDefault(); // Prevent default middle-button behavior (scroll).
        isDragging = true;
        isDraggingRef.current = true; // Update drag state cache.
        setDragging(true); // Notify canvasStore that dragging started.
        
        const rect = canvas.getBoundingClientRect();
        lastScreenPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        
        // Read latest state values.
        const currentState = useCanvasStore.getState();
        dragStartPanX = currentState.panX;
        dragStartPanY = currentState.panY;
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging && lastScreenPoint) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const currentScreenPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        
        // Compute screen-space delta.
        const screenDeltaX = currentScreenPoint.x - lastScreenPoint.x;
        const screenDeltaY = currentScreenPoint.y - lastScreenPoint.y;
        
        // Convert deltas using cached zoom.
        // Convert CSS pixel delta -> Paper view coords (device pixels) -> world coords.
        const worldDeltaX = (screenDeltaX * dpr) / zoomRef.current;
        const worldDeltaY = (screenDeltaY * dpr) / zoomRef.current;
        
        // Update pan values.
        const newPanX = dragStartPanX + worldDeltaX;
        const newPanY = dragStartPanY + worldDeltaY;
        
        // Use requestAnimationFrame for drag updates.
        if (dragAnimationId) {
          cancelAnimationFrame(dragAnimationId);
        }
        
        dragAnimationId = requestAnimationFrame(() => {
          setPan(newPanX, newPanY);
          dragAnimationId = null;
        });
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 1) {
        stopDragging();
      }
    };

    // Handle mouse leaving canvas / window-level middle-button release during dragging.
    const handleMouseLeave = () => {
      stopDragging();
    };

    const handleWindowMouseUp = (event: MouseEvent) => {
      if (event.button === 1) {
        stopDragging();
      }
    };

    // Handle wheel/trackpad: switch between zoom and pan based on settings.
    const handleWheel = (event: WheelEvent) => {
      const store = useCanvasStore.getState();
      const isModifierWheel = event.ctrlKey || event.metaKey;
      const shouldZoom =
        store.wheelZoomMode === 'direct' ? !isModifierWheel : isModifierWheel;

      // Zoom (centered on pointer position).
      if (shouldZoom) {
        event.preventDefault();
        event.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const sx = (event.clientX - rect.left) * dpr; // device pixels
        const sy = (event.clientY - rect.top) * dpr;

        const z1 = zoomRef.current;
        const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
        if (Math.abs(delta) < 1e-6) return;

        const z2 = computeSmoothZoom(z1, delta, { sensitivity: store.zoomSensitivity });
        if (z1 === z2) return;

        // Keep world coordinate under pointer fixed:
        // W = sx/z1 - pan1;  pan2 = sx/z2 - W
        const pan2x = store.panX + sx * (1 / z2 - 1 / z1);
        const pan2y = store.panY + sy * (1 / z2 - 1 / z1);

        store.setPan(pan2x, pan2y);
        store.setZoom(z2);
        return;
      }

      // Pan.
      event.preventDefault(); // Prevent browser default behavior (zoom/scroll).
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

    // Register event listeners.
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      
      // Cleanup pending animation frame to avoid memory leaks.
      if (dragAnimationId) {
        cancelAnimationFrame(dragAnimationId);
        dragAnimationId = null;
      }
    };
  }, [setPan, canvasRef]);

  return null; // This component renders no DOM.
};

export default InteractionController;
