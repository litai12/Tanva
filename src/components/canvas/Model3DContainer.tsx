import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import Model3DViewer from './Model3DViewer';
import type { Model3DData } from '@/services/model3DUploadService';

interface Model3DContainerProps {
  modelData: Model3DData;
  bounds: { x: number; y: number; width: number; height: number }; // Paper.js世界坐标
  isSelected?: boolean;
  drawMode?: string; // 当前绘图模式
  isSelectionDragging?: boolean; // 是否正在拖拽选择框
  onSelect?: () => void;
  onMove?: (newPosition: { x: number; y: number }) => void; // Paper.js坐标
  onResize?: (newBounds: { x: number; y: number; width: number; height: number }) => void; // Paper.js坐标
}

const Model3DContainer: React.FC<Model3DContainerProps> = ({
  modelData,
  bounds,
  isSelected = false,
  drawMode = 'select',
  isSelectionDragging = false,
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

  // 获取画布状态
  const { zoom, panX, panY } = useCanvasStore();
  
  // 优化的同步机制 - 使用ref跟踪更新状态，避免强制重渲染循环
  const [renderKey, setRenderKey] = useState(0);
  const needsUpdateRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  // 监听画布状态变化，在下一个动画帧重新计算以确保Paper.js矩阵已更新
  useEffect(() => {
    // 标记需要更新，但不立即触发重渲染
    needsUpdateRef.current = true;
    
    // 取消之前的动画帧请求，避免重复执行
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    // 使用requestAnimationFrame确保在浏览器重绘前Paper.js矩阵已更新
    animationFrameRef.current = requestAnimationFrame(() => {
      if (needsUpdateRef.current) {
        setRenderKey(prev => prev + 1);
        needsUpdateRef.current = false;
      }
      animationFrameRef.current = null;
    });
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [zoom, panX, panY]); // 移除forceRerender依赖，避免循环

  // 将Paper.js世界坐标转换为屏幕坐标 - 直接使用当前Paper.js状态
  const convertToScreenBounds = useCallback((paperBounds: { x: number; y: number; width: number; height: number }) => {
    if (!paper.view) return paperBounds;
    
    const topLeft = paper.view.projectToView(new paper.Point(paperBounds.x, paperBounds.y));
    const bottomRight = paper.view.projectToView(new paper.Point(paperBounds.x + paperBounds.width, paperBounds.y + paperBounds.height));
    
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  }, []);

  // 计算当前屏幕坐标 - renderKey确保在Paper.js矩阵更新后重新计算
  const screenBounds = useMemo(() => convertToScreenBounds(bounds), [bounds, renderKey, convertToScreenBounds]);

  // 将屏幕坐标转换为Paper.js世界坐标
  const convertToPaperBounds = useCallback((screenBounds: { x: number; y: number; width: number; height: number }) => {
    if (!paper.view) return screenBounds;
    
    const topLeft = paper.view.viewToProject(new paper.Point(screenBounds.x, screenBounds.y));
    const bottomRight = paper.view.viewToProject(new paper.Point(screenBounds.x + screenBounds.width, screenBounds.y + screenBounds.height));
    
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  }, []); // 移除依赖，通过强制重渲染确保同步

  // 计算控制点偏移量 - 与边框精确对齐
  const handleSize = 8; // 控制点尺寸（固定屏幕像素大小）
  // 控制点位置：边框外侧，中心对齐边框边缘
  const handleOffset = -(handleSize / 2); // 控制点中心对齐边框边缘

  // 处理wheel事件，防止3D缩放时影响画布缩放
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isSelected) {
      // 当3D模型被选中时，阻止wheel事件传播到画布
      e.stopPropagation();
      // 允许OrbitControls处理缩放
    }
  }, [isSelected]);

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

    // 判断是否点击在边框线上（不是canvas、不是控制点）
    if (target.classList.contains('border-line')) {
      e.preventDefault();
      e.stopPropagation();

      if (onSelect) {
        onSelect();
      }

      setIsDragging(true);
      setDragStart({ x: e.clientX - screenBounds.x, y: e.clientY - screenBounds.y });
      return;
    }

    // 其他情况只选中
    if (onSelect) {
      onSelect();
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && onMove) {
      const newScreenX = e.clientX - dragStart.x;
      const newScreenY = e.clientY - dragStart.y;
      
      // 转换屏幕坐标为Paper.js坐标
      const paperPosition = paper.view ? paper.view.viewToProject(new paper.Point(newScreenX, newScreenY)) : { x: newScreenX, y: newScreenY };
      onMove({ x: paperPosition.x, y: paperPosition.y });
    } else if (isResizing && onResize && resizeDirection) {
      const mouseX = e.clientX;
      const mouseY = e.clientY;
      
      // 先计算屏幕坐标的新边界 - 使用统一的转换函数
      const initialScreenBounds = convertToScreenBounds(initialBounds);
      const newScreenBounds = { ...initialScreenBounds };
      
      // 根据调整方向计算新的边界 - 对角调整
      if (resizeDirection.includes('e')) {
        // 向右调整：鼠标X - 左边界 = 新宽度
        newScreenBounds.width = Math.max(100, mouseX - initialScreenBounds.x);
      }
      if (resizeDirection.includes('w')) {
        // 向左调整：右边界 - 鼠标X = 新宽度，鼠标X = 新左边界
        const rightEdge = initialScreenBounds.x + initialScreenBounds.width;
        newScreenBounds.width = Math.max(100, rightEdge - mouseX);
        newScreenBounds.x = rightEdge - newScreenBounds.width;
      }
      if (resizeDirection.includes('s')) {
        // 向下调整：鼠标Y - 上边界 = 新高度
        newScreenBounds.height = Math.max(100, mouseY - initialScreenBounds.y);
      }
      if (resizeDirection.includes('n')) {
        // 向上调整：下边界 - 鼠标Y = 新高度，鼠标Y = 新上边界
        const bottomEdge = initialScreenBounds.y + initialScreenBounds.height;
        newScreenBounds.height = Math.max(100, bottomEdge - mouseY);
        newScreenBounds.y = bottomEdge - newScreenBounds.height;
      }
      
      // 转换屏幕坐标为Paper.js坐标
      const newPaperBounds = convertToPaperBounds(newScreenBounds);
      onResize(newPaperBounds);
    }
  }, [isDragging, isResizing, dragStart, initialBounds, resizeDirection, onMove, onResize, convertToScreenBounds, convertToPaperBounds]);

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

  // 添加wheel事件监听
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: screenBounds.x,
        top: screenBounds.y,
        width: screenBounds.width,
        height: screenBounds.height,
        zIndex: isSelected ? 1001 : 1000,
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: 'none',
        pointerEvents: (drawMode === 'select' && !isSelectionDragging) || isSelected ? 'auto' : 'none' // 选择框拖拽时也让鼠标事件穿透
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 3D模型渲染器 - 使用屏幕坐标确保与边框和控制点对齐 */}
      <Model3DViewer
        modelData={modelData}
        width={screenBounds.width}
        height={screenBounds.height}
        isSelected={isSelected}
      />

      {/* 选中状态的边框线 - 四条独立边框，只在边框上响应拖拽 */}
      {isSelected && (
        <>
          {/* 顶部边框线 */}
          <div
            className="border-line"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '4px',
              backgroundColor: 'transparent',
              borderTop: '2px solid #3b82f6',
              cursor: 'move',
              zIndex: 10,
              pointerEvents: 'all',
              transition: 'border-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderTopColor = '#2563eb'}
            onMouseLeave={(e) => e.currentTarget.style.borderTopColor = '#3b82f6'}
          />
          {/* 底部边框线 */}
          <div
            className="border-line"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: '4px',
              backgroundColor: 'transparent',
              borderBottom: '2px solid #3b82f6',
              cursor: 'move',
              zIndex: 10,
              pointerEvents: 'all',
              transition: 'border-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderBottomColor = '#2563eb'}
            onMouseLeave={(e) => e.currentTarget.style.borderBottomColor = '#3b82f6'}
          />
          {/* 左侧边框线 */}
          <div
            className="border-line"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '4px',
              height: '100%',
              backgroundColor: 'transparent',
              borderLeft: '2px solid #3b82f6',
              cursor: 'move',
              zIndex: 10,
              pointerEvents: 'all',
              transition: 'border-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderLeftColor = '#2563eb'}
            onMouseLeave={(e) => e.currentTarget.style.borderLeftColor = '#3b82f6'}
          />
          {/* 右侧边框线 */}
          <div
            className="border-line"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '4px',
              height: '100%',
              backgroundColor: 'transparent',
              borderRight: '2px solid #3b82f6',
              cursor: 'move',
              zIndex: 10,
              pointerEvents: 'all',
              transition: 'border-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderRightColor = '#2563eb'}
            onMouseLeave={(e) => e.currentTarget.style.borderRightColor = '#3b82f6'}
          />
        </>
      )}

      {/* 选中状态的调整手柄 - 四个角点，与边框对齐 */}
      {isSelected && (
        <>
          {/* 左上角 - 与边框左上角对齐 */}
          <div
            className="resize-handle"
            data-direction="nw"
            style={{
              position: 'absolute',
              top: handleOffset,
              left: handleOffset,
              width: handleSize,
              height: handleSize,
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
              top: handleOffset,
              right: handleOffset,
              width: handleSize,
              height: handleSize,
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
              bottom: handleOffset,
              left: handleOffset,
              width: handleSize,
              height: handleSize,
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
              bottom: handleOffset,
              right: handleOffset,
              width: handleSize,
              height: handleSize,
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