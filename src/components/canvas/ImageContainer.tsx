import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ImageData {
  id: string;
  src: string;
  fileName?: string;
}

interface ImageContainerProps {
  imageData: ImageData;
  bounds: { x: number; y: number; width: number; height: number };
  isSelected?: boolean;
  onSelect?: () => void;
  onMove?: (newPosition: { x: number; y: number }) => void;
  onResize?: (newBounds: { x: number; y: number; width: number; height: number }) => void;
}

const ImageContainer: React.FC<ImageContainerProps> = ({
  imageData,
  bounds,
  isSelected = false,
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
  const [initialBounds, setInitialBounds] = useState(bounds);
  const [actualImageBounds, setActualImageBounds] = useState<{x: number, y: number, width: number, height: number} | null>(null);

  // 计算图片在容器中的实际显示尺寸和位置
  const calculateActualImageBounds = useCallback(() => {
    if (!imageRef.current) return null;
    
    const img = imageRef.current;
    const containerWidth = bounds.width;
    const containerHeight = bounds.height;
    
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
  }, [bounds.width, bounds.height]);

  // 当图片加载完成后计算实际边界
  const handleImageLoad = useCallback(() => {
    const actualBounds = calculateActualImageBounds();
    setActualImageBounds(actualBounds);
  }, [calculateActualImageBounds]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键

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

  // 当bounds变化时重新计算实际图片边界
  useEffect(() => {
    if (imageRef.current && imageRef.current.complete) {
      const actualBounds = calculateActualImageBounds();
      setActualImageBounds(actualBounds);
    }
  }, [bounds, calculateActualImageBounds]);

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
              top: -3,
              left: -3,
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
              top: -3,
              right: -3,
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
              bottom: -3,
              left: -3,
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
              bottom: -3,
              right: -3,
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

export default ImageContainer;