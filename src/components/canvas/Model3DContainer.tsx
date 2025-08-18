import React, { useState, useRef, useEffect, useCallback } from 'react';
import Model3DViewer from './Model3DViewer';
import type { Model3DData } from '@/services/model3DUploadService';

interface Model3DContainerProps {
  modelData: Model3DData;
  bounds: { x: number; y: number; width: number; height: number };
  isSelected?: boolean;
  onSelect?: () => void;
  onMove?: (newPosition: { x: number; y: number }) => void;
  onResize?: (newBounds: { x: number; y: number; width: number; height: number }) => void;
}

const Model3DContainer: React.FC<Model3DContainerProps> = ({
  modelData,
  bounds,
  isSelected = false,
  onSelect,
  onMove,
  onResize
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>('');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialBounds, setInitialBounds] = useState(bounds);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键

    const target = e.target as HTMLElement;
    
    // 如果点击的是Three.js canvas，不处理拖拽，让OrbitControls处理
    if (target.tagName === 'CANVAS') {
      // 仅选中模型，不开始拖拽
      if (onSelect) {
        onSelect();
      }
      return;
    }

    // 判断是否点击在调整手柄上 - 优先级最高
    if (target.classList.contains('resize-handle')) {
      e.preventDefault();
      e.stopPropagation();
      
      if (onSelect) {
        onSelect();
      }

      setIsResizing(true);
      setInitialBounds(bounds);
      
      // 直接从控制点的data属性获取方向，避免计算错误
      const direction = (target as HTMLElement).getAttribute('data-direction');
      if (direction) {
        setResizeDirection(direction);
      }
      return; // 重要：直接返回，不执行拖拽逻辑
    }

    // 判断是否点击在边框区域（不是canvas、不是控制点）
    if (target.classList.contains('border-area') || target === containerRef.current) {
      e.preventDefault();
      e.stopPropagation();

      if (onSelect) {
        onSelect();
      }

      setIsDragging(true);
      setDragStart({ x: e.clientX - bounds.x, y: e.clientY - bounds.y });
      return;
    }

    // 其他情况只选中
    if (onSelect) {
      onSelect();
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && onMove) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      onMove({ x: newX, y: newY });
    } else if (isResizing && onResize && resizeDirection) {
      const mouseX = e.clientX;
      const mouseY = e.clientY;
      
      let newBounds = { ...initialBounds };
      
      // 根据调整方向计算新的边界 - 对角调整
      if (resizeDirection.includes('e')) {
        // 向右调整：鼠标X - 左边界 = 新宽度
        newBounds.width = Math.max(100, mouseX - initialBounds.x);
      }
      if (resizeDirection.includes('w')) {
        // 向左调整：右边界 - 鼠标X = 新宽度，鼠标X = 新左边界
        const rightEdge = initialBounds.x + initialBounds.width;
        newBounds.width = Math.max(100, rightEdge - mouseX);
        newBounds.x = rightEdge - newBounds.width;
      }
      if (resizeDirection.includes('s')) {
        // 向下调整：鼠标Y - 上边界 = 新高度
        newBounds.height = Math.max(100, mouseY - initialBounds.y);
      }
      if (resizeDirection.includes('n')) {
        // 向上调整：下边界 - 鼠标Y = 新高度，鼠标Y = 新上边界
        const bottomEdge = initialBounds.y + initialBounds.height;
        newBounds.height = Math.max(100, bottomEdge - mouseY);
        newBounds.y = bottomEdge - newBounds.height;
      }
      
      onResize(newBounds);
    }
  }, [isDragging, isResizing, dragStart, initialBounds, resizeDirection, onMove, onResize]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeDirection('');
  }, []);

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: isSelected ? 1001 : 1000,
        cursor: isDragging ? 'grabbing' : (isSelected ? 'default' : 'grab'),
        userSelect: 'none'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 3D模型渲染器 */}
      <Model3DViewer
        modelData={modelData}
        width={bounds.width}
        height={bounds.height}
        isSelected={isSelected}
      />

      {/* 选中状态的调整手柄 - 四个角点，与边框对齐 */}
      {isSelected && (
        <>
          {/* 左上角 - 与边框左上角对齐 */}
          <div
            className="resize-handle"
            data-direction="nw"
            style={{
              position: 'absolute',
              top: -6,
              left: -6,
              width: 8,
              height: 8,
              backgroundColor: '#3b82f6',
              border: '1px solid white',
              cursor: 'nw-resize',
              borderRadius: '2px',
              zIndex: 10
            }}
          />
          {/* 右上角 - 与边框右上角对齐 */}
          <div
            className="resize-handle"
            data-direction="ne"
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              width: 8,
              height: 8,
              backgroundColor: '#3b82f6',
              border: '1px solid white',
              cursor: 'ne-resize',
              borderRadius: '2px',
              zIndex: 10
            }}
          />
          {/* 左下角 - 与边框左下角对齐 */}
          <div
            className="resize-handle"
            data-direction="sw"
            style={{
              position: 'absolute',
              bottom: -6,
              left: -6,
              width: 8,
              height: 8,
              backgroundColor: '#3b82f6',
              border: '1px solid white',
              cursor: 'sw-resize',
              borderRadius: '2px',
              zIndex: 10
            }}
          />
          {/* 右下角 - 与边框右下角对齐 */}
          <div
            className="resize-handle"
            data-direction="se"
            style={{
              position: 'absolute',
              bottom: -6,
              right: -6,
              width: 8,
              height: 8,
              backgroundColor: '#3b82f6',
              border: '1px solid white',
              cursor: 'se-resize',
              borderRadius: '2px',
              zIndex: 10
            }}
          />
        </>
      )}
    </div>
  );
};

export default Model3DContainer;