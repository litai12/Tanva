/**
 * 文本选择框覆盖层组件
 * 显示选中文本的边框和操作手柄
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

  // 监听画布状态变化
  const zoom = useCanvasStore(state => state.zoom);
  const panX = useCanvasStore(state => state.panX);
  const panY = useCanvasStore(state => state.panY);

  // 强制更新状态
  const [updateKey, setUpdateKey] = useState(0);

  // 拖拽状态
  const isDraggingRef = useRef(false);
  const dragTypeRef = useRef<'move' | 'resize' | null>(null);
  const resizeDirectionRef = useRef<'nw' | 'ne' | 'sw' | 'se' | null>(null);

  // 监听画布变化，强制更新选择框位置
  useEffect(() => {
    const handleUpdate = () => {
      setUpdateKey(k => k + 1);
    };

    // 监听 paper.view 的帧更新
    let frameId: number | null = null;
    const onFrame = () => {
      handleUpdate();
    };

    // 使用 requestAnimationFrame 来节流更新
    const scheduleUpdate = () => {
      if (frameId === null) {
        frameId = requestAnimationFrame(() => {
          frameId = null;
          onFrame();
        });
      }
    };

    // 监听各种可能导致位置变化的事件
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

  // 额外监听 zoom/pan 变化
  useEffect(() => {
    setUpdateKey(k => k + 1);
  }, [zoom, panX, panY]);

  // 计算选择框位置
  const getSelectionBounds = useCallback(
    (target?: { paperText: paper.PointText } | null) => {
      if (!target?.paperText || !paper.view || !paper.view.element) {
        return null;
      }

      try {
        const bounds = target.paperText.bounds;
        const padding = 4; // 选择框的内边距

        const canvasEl = paper.view.element as HTMLCanvasElement;
        const r = projectRectToClient(canvasEl, bounds);
        return {
          left: r.left - padding,
          top: r.top - padding,
          width: r.width + padding * 2,
          height: r.height + padding * 2,
        };
      } catch (error) {
        console.warn('计算文本选择框位置失败:', error);
        return null;
      }
    },
    [updateKey]
  ); // 添加 updateKey 依赖

  const activeSelectionBounds = useMemo(() => getSelectionBounds(activeText), [activeText, getSelectionBounds]);
  const inactiveSelectionBounds = useMemo(
    () =>
      inactiveTexts
        .map((t) => ({ id: t.id, bounds: getSelectionBounds(t) }))
        .filter((item): item is { id: string; bounds: NonNullable<ReturnType<typeof getSelectionBounds>> } => !!item.bounds),
    [inactiveTexts, getSelectionBounds]
  );

  // 转换屏幕坐标到Paper.js坐标
  const screenToPaperPoint = useCallback((clientX: number, clientY: number): paper.Point => {
    if (!paper.view || !paper.view.element) {
      return new paper.Point(clientX, clientY);
    }

    const canvasEl = paper.view.element as HTMLCanvasElement;
    return clientToProject(canvasEl, clientX, clientY);
  }, []);

  // 处理选择框边框拖拽（移动）
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

  // 处理角点拖拽（调整大小）
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

  // 全局鼠标移动和释放事件
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const paperPoint = screenToPaperPoint(e.clientX, e.clientY);

      if (dragTypeRef.current === 'move' && onTextDrag) {
        onTextDrag(paperPoint);
        // 拖拽时更新选择框位置
        setUpdateKey(k => k + 1);
      } else if (dragTypeRef.current === 'resize' && onTextResize && resizeDirectionRef.current) {
        onTextResize(paperPoint, resizeDirectionRef.current);
        // 调整大小时更新选择框位置
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

        // 操作结束后更新选择框位置
        setUpdateKey(k => k + 1);
      }
    };

    // 始终监听这些事件
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onTextDrag, onTextDragEnd, onTextResize, onTextResizeEnd, screenToPaperPoint]);

  // 处理双击进入编辑
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const activeTextId = activeText?.id || selectedTextId;
    if (activeTextId && onTextDoubleClick) {
      onTextDoubleClick(activeTextId);
    }
  }, [activeText, selectedTextId, onTextDoubleClick]);

  // 如果没有选中文本，不显示选择框
  if (selectedTexts.length === 0) {
    return null;
  }

  const isEditingActive = activeText && editingTextId === activeText.id;

  return (
    <>
      {inactiveSelectionBounds.map(({ id, bounds }) => (
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
      {activeText && activeSelectionBounds && !isEditingActive && (
        <div
          style={{
            position: 'fixed',
            left: activeSelectionBounds.left,
            top: activeSelectionBounds.top,
            width: activeSelectionBounds.width,
            height: activeSelectionBounds.height,
            backgroundColor: 'transparent',
            pointerEvents: 'none', // 基层不拦截事件
            zIndex: 999,
            boxSizing: 'border-box'
          }}
        >
          {/* 整个选择框区域可拖拽，双击进入编辑 */}
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
          {/* 四个角的方块手柄 - 白色填充，蓝色边框 */}
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
