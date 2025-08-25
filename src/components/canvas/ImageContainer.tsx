import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';

interface ImageData {
  id: string;
  src: string;
  fileName?: string;
}

interface ImageContainerProps {
  imageData: ImageData;
  bounds: { x: number; y: number; width: number; height: number }; // Paper.js世界坐标
  isSelected?: boolean;
  visible?: boolean; // 是否可见
  drawMode?: string; // 当前绘图模式
  isSelectionDragging?: boolean; // 是否正在拖拽选择框
  onSelect?: () => void;
  onMove?: (newPosition: { x: number; y: number }) => void; // Paper.js坐标
  onResize?: (newBounds: { x: number; y: number; width: number; height: number }) => void; // Paper.js坐标
}

const ImageContainer: React.FC<ImageContainerProps> = ({
  imageData,
  bounds,
  isSelected = false,
  visible = true,
  drawMode = 'select',
  isSelectionDragging = false,
  onSelect,
  onMove,
  onResize
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>('');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0 });
  const [initialBounds, setInitialBounds] = useState(bounds);
  const [, setActualImageBounds] = useState<{ x: number, y: number, width: number, height: number } | null>(null);

  // 获取画布状态用于坐标转换
  const { zoom, panX, panY } = useCanvasStore();

  // 优化的同步机制 - 使用ref跟踪更新状态，避免强制重渲染循环
  const [renderKey, setRenderKey] = useState(0);
  const needsUpdateRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  // 将Paper.js世界坐标转换为屏幕坐标
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
  }, []);

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
  }, [zoom, panX, panY]); // 移除不必要的依赖，避免循环

  // 计算当前屏幕坐标 - renderKey确保在Paper.js矩阵更新后重新计算
  const screenBounds = useMemo(() => convertToScreenBounds(bounds), [bounds, renderKey, convertToScreenBounds]);

  // 计算控制点偏移量 - 考虑边框宽度和缩放
  const borderWidth = 2; // 边框宽度
  const handleSize = 8; // 控制点尺寸
  const handleOffset = -(borderWidth + handleSize / 2); // 控制点偏移

  // 计算图片在容器中的实际显示尺寸和位置
  const calculateActualImageBounds = useCallback(() => {
    if (!imageRef.current) return null;

    const img = imageRef.current;
    const containerWidth = screenBounds.width;
    const containerHeight = screenBounds.height;

    // 获取图片的原始尺寸
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    if (naturalWidth === 0 || naturalHeight === 0) return null;

    // 计算object-fit: contain的实际显示尺寸
    const containerAspectRatio = containerWidth / containerHeight;
    const imageAspectRatio = naturalWidth / naturalHeight;

    let actualWidth, actualHeight, offsetX, offsetY;

    if (imageAspectRatio > containerAspectRatio) {
      // 图片更宽，以宽度为准
      actualWidth = containerWidth;
      actualHeight = containerWidth / imageAspectRatio;
      offsetX = 0;
      offsetY = (containerHeight - actualHeight) / 2;
    } else {
      // 图片更高，以高度为准
      actualHeight = containerHeight;
      actualWidth = containerHeight * imageAspectRatio;
      offsetX = (containerWidth - actualWidth) / 2;
      offsetY = 0;
    }

    return {
      x: offsetX,
      y: offsetY,
      width: actualWidth,
      height: actualHeight
    };
  }, [screenBounds.width, screenBounds.height]);

  // 当图片加载完成后计算实际边界
  const handleImageLoad = useCallback(() => {
    const actualBounds = calculateActualImageBounds();
    setActualImageBounds(actualBounds);
  }, [calculateActualImageBounds]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键

    // 在绘制模式下，不处理任何鼠标事件，让事件传递到Paper.js画布
    if (drawMode !== 'select') {
      return;
    }

    const target = e.target as HTMLElement;

    // 如果点击的是图片本身，只选中不拖拽
    if (target.tagName === 'IMG') {
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
      setResizeStart({ x: e.clientX, y: e.clientY }); // 记录调整大小开始时的鼠标位置

      // 直接从控制点的data属性获取方向，避免计算错误
      const direction = (target as HTMLElement).getAttribute('data-direction');
      if (direction) {
        setResizeDirection(direction);
      }
      return; // 重要：直接返回，不执行拖拽逻辑
    }

    // 判断是否点击在边框区域（不是图片、不是控制点）
    if (target.classList.contains('border-area') || target === containerRef.current) {
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
      // 计算鼠标移动的偏移量
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      // 先计算屏幕坐标的新边界
      const initialScreenBounds = convertToScreenBounds(initialBounds);
      const newScreenBounds = { ...initialScreenBounds };

      // 根据调整方向计算新的边界 - 使用偏移量避免跳跃
      if (resizeDirection.includes('e')) {
        // 向右调整：原宽度 + X偏移量
        newScreenBounds.width = Math.max(100, initialScreenBounds.width + deltaX);
      }
      if (resizeDirection.includes('w')) {
        // 向左调整：原宽度 - X偏移量，位置向左移动X偏移量
        newScreenBounds.width = Math.max(100, initialScreenBounds.width - deltaX);
        newScreenBounds.x = initialScreenBounds.x + (initialScreenBounds.width - newScreenBounds.width);
      }
      if (resizeDirection.includes('s')) {
        // 向下调整：原高度 + Y偏移量
        newScreenBounds.height = Math.max(100, initialScreenBounds.height + deltaY);
      }
      if (resizeDirection.includes('n')) {
        // 向上调整：原高度 - Y偏移量，位置向上移动Y偏移量
        newScreenBounds.height = Math.max(100, initialScreenBounds.height - deltaY);
        newScreenBounds.y = initialScreenBounds.y + (initialScreenBounds.height - newScreenBounds.height);
      }

      // 转换屏幕坐标为Paper.js坐标
      const newPaperBounds = convertToPaperBounds(newScreenBounds);
      onResize(newPaperBounds);
    }
  }, [isDragging, isResizing, dragStart, resizeStart, initialBounds, resizeDirection, onMove, onResize, convertToScreenBounds, convertToPaperBounds]);

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

  // 当bounds或视图变化时重新计算实际图片边界 - 使用renderKey确保同步
  useEffect(() => {
    if (imageRef.current && imageRef.current.complete) {
      const actualBounds = calculateActualImageBounds();
      setActualImageBounds(actualBounds);
    }
  }, [bounds, renderKey, calculateActualImageBounds]);

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
        cursor: isDragging ? 'grabbing' : (isSelected ? 'default' : 'grab'),
        userSelect: 'none',
        pointerEvents: (drawMode === 'select' && !isSelectionDragging) || isSelected ? 'auto' : 'none', // 选择框拖拽时也让鼠标事件穿透
        display: visible ? 'block' : 'none' // 根据visible属性控制显示/隐藏
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 图片容器 - 内层处理overflow */}
      <div
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          borderRadius: '0',
          overflow: 'hidden',
          backgroundColor: 'transparent'
        }}
      >
        {/* 图片显示 */}
        <img
          ref={imageRef}
          src={imageData.src}
          alt={imageData.fileName || 'Uploaded image'}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
          draggable={false}
          onLoad={handleImageLoad}
        />
      </div>

      {/* 选中状态的边框 - 覆盖整个容器，与3D保持一致 */}
      {isSelected && (
        <div
          className="border-area"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: '2px solid #3b82f6',
            borderRadius: '0',
            pointerEvents: 'all',
            cursor: 'move',
            zIndex: 5,
            backgroundColor: 'transparent'
          }}
        />
      )}

      {/* 选中状态的调整手柄 - 四个角点，与3D保持一致 */}
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

export default ImageContainer;