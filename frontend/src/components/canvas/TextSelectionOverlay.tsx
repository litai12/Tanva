/**
 * 文本选择框覆盖层组件
 * 显示选中文本的边框和操作手柄
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import paper from 'paper';
import { projectRectToClient, clientToProject } from '@/utils/paperCoords';

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
  onTextResizeEnd
}) => {
  const selectedText = textItems.find(item => item.id === selectedTextId);
  
  // 拖拽状态
  const isDraggingRef = useRef(false);
  const dragTypeRef = useRef<'move' | 'resize' | null>(null);
  const resizeDirectionRef = useRef<'nw' | 'ne' | 'sw' | 'se' | null>(null);

  // 计算选择框位置
  const getSelectionBounds = useCallback(() => {
    if (!selectedText || !selectedText.paperText || !paper.view || !paper.view.element) {
      return null;
    }

    try {
      const bounds = selectedText.paperText.bounds;
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
  }, [selectedText]);

  const selectionBounds = useMemo(() => getSelectionBounds(), [getSelectionBounds]);

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
    if (!selectedTextId || !onTextDragStart) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const paperPoint = screenToPaperPoint(e.clientX, e.clientY);
    isDraggingRef.current = true;
    dragTypeRef.current = 'move';
    
    onTextDragStart(selectedTextId, paperPoint);
    console.log('🤏 开始拖拽文本边框');
  }, [selectedTextId, onTextDragStart, screenToPaperPoint]);

  // 处理角点拖拽（调整大小）
  const handleCornerMouseDown = useCallback((direction: 'nw' | 'ne' | 'sw' | 'se') => 
    (e: React.MouseEvent) => {
      if (!selectedTextId || !onTextResizeStart) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const paperPoint = screenToPaperPoint(e.clientX, e.clientY);
      isDraggingRef.current = true;
      dragTypeRef.current = 'resize';
      resizeDirectionRef.current = direction;
      
      onTextResizeStart(selectedTextId, paperPoint, direction);
      console.log('🔄 开始调整文本大小，方向:', direction);
    }, [selectedTextId, onTextResizeStart, screenToPaperPoint]);

  // 全局鼠标移动事件
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      
      const paperPoint = screenToPaperPoint(e.clientX, e.clientY);
      
      if (dragTypeRef.current === 'move' && onTextDrag) {
        onTextDrag(paperPoint);
      } else if (dragTypeRef.current === 'resize' && onTextResize && resizeDirectionRef.current) {
        onTextResize(paperPoint, resizeDirectionRef.current);
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
        
        console.log('✋ 结束文本操作');
      }
    };

    if (isDraggingRef.current) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [onTextDrag, onTextDragEnd, onTextResize, onTextResizeEnd, screenToPaperPoint]);

  // 如果没有选中文本或正在编辑，不显示选择框
  if (!selectedTextId || !selectedText || editingTextId === selectedTextId || !selectionBounds) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: selectionBounds.left,
        top: selectionBounds.top,
        width: selectionBounds.width,
        height: selectionBounds.height,
        backgroundColor: 'transparent',
        pointerEvents: 'none', // 基层不拦截事件
        zIndex: 999,
        boxSizing: 'border-box'
      }}
    >
      {/* 可视边框（不拦截事件） */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: '1px solid #3b82f6',
          pointerEvents: 'none'
        }}
      />

      {/* 四条边的命中区域：仅在边框上显示移动光标并响应拖拽 */}
      <div
        style={{ position: 'absolute', left: -3, top: -3, width: `calc(100% + 6px)`, height: 6, cursor: 'move', pointerEvents: 'auto' }}
        onMouseDown={handleBorderMouseDown}
      />
      <div
        style={{ position: 'absolute', left: -3, bottom: -3, width: `calc(100% + 6px)`, height: 6, cursor: 'move', pointerEvents: 'auto' }}
        onMouseDown={handleBorderMouseDown}
      />
      <div
        style={{ position: 'absolute', left: -3, top: 0, width: 6, height: '100%', cursor: 'move', pointerEvents: 'auto' }}
        onMouseDown={handleBorderMouseDown}
      />
      <div
        style={{ position: 'absolute', right: -3, top: 0, width: 6, height: '100%', cursor: 'move', pointerEvents: 'auto' }}
        onMouseDown={handleBorderMouseDown}
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
  );
};

export default TextSelectionOverlay;
