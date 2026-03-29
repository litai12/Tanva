/**
 * Text selection overlay component
 * Renders selection borders and handles for selected text
 */

import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import paper from 'paper';
import { projectRectToClient, clientToProject } from '@/utils/paperCoords';
import { useCanvasStore } from '@/stores/canvasStore';

interface TextSelectionOverlayProps {
  textItems: Array<{
    id: string;
    paperText: paper.PointText;
    isSelected: boolean;
    isEditing: boolean;
  }>;
  selectedTextId: string | null;
  editingTextId: string | null;
  isDragging?: boolean;
  isResizing?: boolean;
  onTextDragStart?: (textId: string, startPoint: paper.Point) => void;
  onTextDrag?: (currentPoint: paper.Point) => void;
  onTextDragEnd?: () => void;
  onTextResizeStart?: (textId: string, startPoint: paper.Point, direction: string) => void;
  onTextResize?: (currentPoint: paper.Point, direction: string) => void;
  onTextResizeEnd?: () => void;
  onTextDoubleClick?: (textId: string) => void;
}

const TextSelectionOverlay: React.FC<TextSelectionOverlayProps> = ({
  textItems,
  selectedTextId,
  editingTextId,
  isDragging = false,
  isResizing = false,
  onTextDragStart,
  onTextDrag,
  onTextDragEnd,
  onTextResizeStart,
  onTextResize,
  onTextResizeEnd,
  onTextDoubleClick
}) => {
  const selectedTexts = useMemo(
    () => textItems.filter(item => item.isSelected && !item.isEditing),
    [textItems]
  );

  const activeText = useMemo(() => {
    if (selectedTextId) {
      const found = selectedTexts.find(item => item.id === selectedTextId);
      if (found) return found;
    }
    return selectedTexts[0] ?? null;
  }, [selectedTextId, selectedTexts]);

  const inactiveTexts = useMemo(
    () => selectedTexts.filter(item => (activeText ? item.id !== activeText.id : true)),
    [activeText, selectedTexts]
  );

  // Listen for canvas state changes.
  const zoom = useCanvasStore(state => state.zoom);
  const panX = useCanvasStore(state => state.panX);
  const panY = useCanvasStore(state => state.panY);

  // Force update state.
  const [updateKey, setUpdateKey] = useState(0);

  // Drag state.
  const isDraggingRef = useRef(false);
  const dragTypeRef = useRef<'move' | 'resize' | null>(null);
  const resizeDirectionRef = useRef<'nw' | 'ne' | 'sw' | 'se' | null>(null);

  // Listen to canvas updates and refresh overlay bounds.
  useEffect(() => {
    const handleUpdate = () => {
      setUpdateKey(k => k + 1);
    };

    // Listen to paper.view frame updates.
    let frameId: number | null = null;
    const onFrame = () => {
      handleUpdate();
    };

    // Throttle updates with requestAnimationFrame.
    const scheduleUpdate = () => {
      if (frameId === null) {
        frameId = requestAnimationFrame(() => {
          frameId = null;
          onFrame();
        });
      }
    };

    // Listen to events that may change element positions.
    window.addEventListener('wheel', scheduleUpdate, { passive: true });
    window.addEventListener('resize', handleUpdate);

    return () => {
      window.removeEventListener('wheel', scheduleUpdate);
      window.removeEventListener('resize', handleUpdate);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, []);

  // Also update on zoom/pan changes.
  useEffect(() => {
    setUpdateKey(k => k + 1);
  }, [zoom, panX, panY]);

  // Compute selection bounds.
  const getSelectionBounds = useCallback(
    (target?: { paperText: paper.PointText } | null) => {
      if (!target?.paperText || !paper.view || !paper.view.element) {
        return null;
      }

      try {
        const bounds = target.paperText.bounds;
        const padding = 4; // Inner padding for selection bounds.

        const canvasEl = paper.view.element as HTMLCanvasElement;
        const r = projectRectToClient(canvasEl, bounds);
        return {
          left: r.left - padding,
          top: r.top - padding,
          width: r.width + padding * 2,
          height: r.height + padding * 2,
        };
      } catch (error) {
        console.warn('Failed to calculate text selection bounds:', error);
        return null;
      }
    },
    [updateKey]
  ); // Keep updateKey in deps to refresh bounds.

  const activeSelectionBounds = useMemo(() => getSelectionBounds(activeText), [activeText, getSelectionBounds]);
  const inactiveSelectionBounds = useMemo(
    () =>
      inactiveTexts
        .map((t) => ({ id: t.id, bounds: getSelectionBounds(t) }))
        .filter((item): item is { id: string; bounds: NonNullable<ReturnType<typeof getSelectionBounds>> } => !!item.bounds),
    [inactiveTexts, getSelectionBounds]
  );
  const allSelectionBounds = useMemo(
    () =>
      selectedTexts
        .map((t) => ({ id: t.id, bounds: getSelectionBounds(t) }))
        .filter((item): item is { id: string; bounds: NonNullable<ReturnType<typeof getSelectionBounds>> } => !!item.bounds),
    [selectedTexts, getSelectionBounds]
  );
  const isMultiSelection = selectedTexts.length > 1;

  // Convert screen coordinates to Paper.js coordinates.
  const screenToPaperPoint = useCallback((clientX: number, clientY: number): paper.Point => {
    if (!paper.view || !paper.view.element) {
      return new paper.Point(clientX, clientY);
    }

    const canvasEl = paper.view.element as HTMLCanvasElement;
    return clientToProject(canvasEl, clientX, clientY);
  }, []);

  // Handle border drag (move).
  const handleBorderMouseDown = useCallback((e: React.MouseEvent) => {
    const activeTextId = activeText?.id || selectedTextId;
    if (!activeTextId || !onTextDragStart) return;

    e.preventDefault();
    e.stopPropagation();

    const paperPoint = screenToPaperPoint(e.clientX, e.clientY);
    isDraggingRef.current = true;
    dragTypeRef.current = 'move';

    onTextDragStart(activeTextId, paperPoint);
  }, [activeText, selectedTextId, onTextDragStart, screenToPaperPoint]);

  // Handle corner drag (resize).
  const handleCornerMouseDown = useCallback((direction: 'nw' | 'ne' | 'sw' | 'se') =>
    (e: React.MouseEvent) => {
      const activeTextId = activeText?.id || selectedTextId;
      if (!activeTextId || !onTextResizeStart) return;

      e.preventDefault();
      e.stopPropagation();

      const paperPoint = screenToPaperPoint(e.clientX, e.clientY);
      isDraggingRef.current = true;
      dragTypeRef.current = 'resize';
      resizeDirectionRef.current = direction;

      onTextResizeStart(activeTextId, paperPoint, direction);
    }, [activeText, selectedTextId, onTextResizeStart, screenToPaperPoint]);

  // Global mouse move/up handlers.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const paperPoint = screenToPaperPoint(e.clientX, e.clientY);

      if (dragTypeRef.current === 'move' && onTextDrag) {
        onTextDrag(paperPoint);
        // Refresh bounds while dragging.
        setUpdateKey(k => k + 1);
      } else if (dragTypeRef.current === 'resize' && onTextResize && resizeDirectionRef.current) {
        onTextResize(paperPoint, resizeDirectionRef.current);
        // Refresh bounds while resizing.
        setUpdateKey(k => k + 1);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        const wasResizing = dragTypeRef.current === 'resize';

        isDraggingRef.current = false;
        dragTypeRef.current = null;
        resizeDirectionRef.current = null;

        if (wasResizing && onTextResizeEnd) {
          onTextResizeEnd();
        } else if (onTextDragEnd) {
          onTextDragEnd();
        }

        // Refresh bounds after interaction completes.
        setUpdateKey(k => k + 1);
      }
    };

    // Always listen for these events.
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onTextDrag, onTextDragEnd, onTextResize, onTextResizeEnd, screenToPaperPoint]);

  // Enter edit mode on double click.
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const activeTextId = activeText?.id || selectedTextId;
    if (activeTextId && onTextDoubleClick) {
      onTextDoubleClick(activeTextId);
    }
  }, [activeText, selectedTextId, onTextDoubleClick]);

  // Hide overlay when no text is selected.
  if (selectedTexts.length === 0) {
    return null;
  }

  const isEditingActive = activeText && editingTextId === activeText.id;

  return (
    <>
      {(isMultiSelection ? allSelectionBounds : inactiveSelectionBounds).map(({ id, bounds }) => (
        <div
          key={`text-selection-${id}`}
          style={{
            position: 'fixed',
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            backgroundColor: 'transparent',
            pointerEvents: 'none',
            zIndex: 998,
            boxSizing: 'border-box',
            border: '1px dashed #60a5fa',
            borderRadius: 2,
          }}
        />
      ))}
      {!isMultiSelection && activeText && activeSelectionBounds && !isEditingActive && (
        <div
          style={{
            position: 'fixed',
            left: activeSelectionBounds.left,
            top: activeSelectionBounds.top,
            width: activeSelectionBounds.width,
            height: activeSelectionBounds.height,
            backgroundColor: 'transparent',
            pointerEvents: 'none', // Base layer does not intercept events.
            zIndex: 999,
            boxSizing: 'border-box'
          }}
        >
	          {/* Entire bounds are draggable; double-click to edit. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              cursor: 'move',
              pointerEvents: 'auto',
              border: '1px solid #3b82f6',
              boxSizing: 'border-box'
            }}
            onMouseDown={handleBorderMouseDown}
            onDoubleClick={handleDoubleClick}
          />
	          {/* Four corner handles - white fill, blue border. */}
          {(() => { const handleSize = 6; const offset = -(handleSize / 2); return (
          <>
          <div
            style={{
              position: 'absolute',
              top: offset,
              left: offset,
              width: handleSize,
              height: handleSize,
              backgroundColor: 'white',
              border: '1px solid #3b82f6',
              borderRadius: '1px',
              cursor: 'nw-resize',
              pointerEvents: 'auto'
            }}
            onMouseDown={handleCornerMouseDown('nw')}
          />
          <div
            style={{
              position: 'absolute',
              top: offset,
              right: offset,
              width: handleSize,
              height: handleSize,
              backgroundColor: 'white',
              border: '1px solid #3b82f6',
              borderRadius: '1px',
              cursor: 'ne-resize',
              pointerEvents: 'auto'
            }}
            onMouseDown={handleCornerMouseDown('ne')}
          />
          <div
            style={{
              position: 'absolute',
              bottom: offset,
              left: offset,
              width: handleSize,
              height: handleSize,
              backgroundColor: 'white',
              border: '1px solid #3b82f6',
              borderRadius: '1px',
              cursor: 'sw-resize',
              pointerEvents: 'auto'
            }}
            onMouseDown={handleCornerMouseDown('sw')}
          />
          <div
            style={{
              position: 'absolute',
              bottom: offset,
              right: offset,
              width: handleSize,
              height: handleSize,
              backgroundColor: 'white',
              border: '1px solid #3b82f6',
              borderRadius: '1px',
              cursor: 'se-resize',
              pointerEvents: 'auto'
            }}
            onMouseDown={handleCornerMouseDown('se')}
          />
          </>
          ); })()}
        </div>
      )}
    </>
  );
};

export default TextSelectionOverlay;
