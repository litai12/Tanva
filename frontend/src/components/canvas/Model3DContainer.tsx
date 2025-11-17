import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import Model3DViewer from './Model3DViewer';
import type { Model3DData, Model3DCameraState } from '@/services/model3DUploadService';
import { Button } from '../ui/button';
import { Camera, Trash2, Download } from 'lucide-react';
import { LoadingSpinner } from '../ui/loading-spinner';
import { downloadFile } from '@/utils/downloadHelper';
import { logger } from '@/utils/logger';

interface Model3DContainerProps {
  modelData: Model3DData;
  modelId: string; // 模型实例ID
  bounds: { x: number; y: number; width: number; height: number }; // Paper.js世界坐标
  isSelected?: boolean;
  visible?: boolean; // 是否可见
  drawMode?: string; // 当前绘图模式
  isSelectionDragging?: boolean; // 是否正在拖拽选择框
  onSelect?: (addToSelection?: boolean) => void;
  onMove?: (newPosition: { x: number; y: number }) => void; // Paper.js坐标
  onResize?: (newBounds: { x: number; y: number; width: number; height: number }) => void; // Paper.js坐标
  onDeselect?: () => void;
  onCameraChange?: (camera: Model3DCameraState) => void;
  onDelete?: (modelId: string) => void;
  onCapture?: (modelId: string) => void;
  isCapturePending?: boolean;
  showIndividualTools?: boolean;
}

const Model3DContainer: React.FC<Model3DContainerProps> = ({
  modelData,
  modelId,
  bounds,
  isSelected = false,
  visible = true,
  drawMode = 'select',
  isSelectionDragging = false,
  onSelect,
  onMove,
  onResize,
  onDeselect,
  onCameraChange,
  onDelete,
  onCapture,
  isCapturePending = false,
  showIndividualTools = true,
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

    const dpr = window.devicePixelRatio || 1;
    const topLeft = paper.view.projectToView(new paper.Point(paperBounds.x, paperBounds.y));
    const bottomRight = paper.view.projectToView(new paper.Point(paperBounds.x + paperBounds.width, paperBounds.y + paperBounds.height));

    return {
      x: topLeft.x / dpr,
      y: topLeft.y / dpr,
      width: (bottomRight.x - topLeft.x) / dpr,
      height: (bottomRight.y - topLeft.y) / dpr
    };
  }, []);

  const [screenBounds, setScreenBounds] = useState(() => convertToScreenBounds(bounds));

  useEffect(() => {
    let frame: number | null = null;
    let attempts = 0;

    const updateBounds = () => {
      const next = convertToScreenBounds(bounds);
      setScreenBounds(next);

      const valid = Number.isFinite(next.width) && next.width > 1 && Number.isFinite(next.height) && next.height > 1;
      if (!valid && attempts < 6) {
        attempts += 1;
        frame = requestAnimationFrame(updateBounds);
      } else {
        frame = null;
      }
    };

    updateBounds();
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [bounds, zoom, panX, panY, renderKey, convertToScreenBounds]);

  // 将屏幕坐标转换为Paper.js世界坐标
  const convertToPaperBounds = useCallback((screenBounds: { x: number; y: number; width: number; height: number }) => {
    if (!paper.view) return screenBounds;

    const dpr = window.devicePixelRatio || 1;
    const topLeft = paper.view.viewToProject(new paper.Point(screenBounds.x * dpr, screenBounds.y * dpr));
    const bottomRight = paper.view.viewToProject(new paper.Point((screenBounds.x + screenBounds.width) * dpr, (screenBounds.y + screenBounds.height) * dpr));

    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  }, []); // 移除依赖，通过强制重渲染确保同步

  // 计算控制点偏移量 - 与边框精确对齐
  const handleSize = 6; // 控制点尺寸（固定屏幕像素大小）
  // 控制点位置：边框外侧，中心对齐边框边缘
  const handleOffset = -(handleSize / 2); // 控制点中心对齐边框边缘

  const actionButtonStyle = useMemo<React.CSSProperties>(() => ({
    backdropFilter: 'blur(12px)',
    background: 'rgba(255, 255, 255, 0.9)',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    boxShadow:
      '0 8px 24px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255,255,255,0.35)',
  }), []);
  const actionButtonClass =
    'p-1.5 h-8 w-8 rounded-full shadow-lg hover:shadow-xl transition-all duration-150 ease-out hover:scale-105';
  const actionIconClass = 'w-4 h-4 text-slate-600';

  // 处理wheel事件，防止3D缩放时影响画布缩放
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isSelected && drawMode === 'select') {
      // 当3D模型被选中且在select模式时，阻止wheel事件传播到画布
      // 允许OrbitControls处理缩放
      e.stopPropagation();
      e.preventDefault();
    }
  }, [isSelected, drawMode]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const additiveSelection = e.metaKey || e.ctrlKey;

    // 如果点击的是Three.js canvas，完全让OrbitControls处理，不干扰
    if (target.tagName === 'CANVAS') {
      // 右键和中键完全由OrbitControls处理，不触发任何容器操作
      if (e.button === 1 || e.button === 2) {
        return;
      }
      // 左键仅选中模型，不开始拖拽
      if (e.button === 0) {
        onSelect?.(additiveSelection);
      }
      return;
    }

    // 只处理左键点击
    if (e.button !== 0) return;

    if (target === containerRef.current) {
      if (isSelected) {
        onDeselect?.();
      }
      return;
    }

    // 判断是否点击在调整手柄上 - 优先级最高
    if (target.classList.contains('resize-handle')) {
      e.preventDefault();
      e.stopPropagation();

      onSelect?.(additiveSelection);

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

      onSelect?.(additiveSelection);

      setIsDragging(true);
      setDragStart({ x: e.clientX - screenBounds.x, y: e.clientY - screenBounds.y });
      return;
    }

    // 其他情况只选中
    onSelect?.(additiveSelection);
  };

  // 节流控制
  const lastResizeTime = useRef<number>(0);
  const RESIZE_THROTTLE = 16; // 约60fps

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && onMove) {
      const newScreenX = e.clientX - dragStart.x;
      const newScreenY = e.clientY - dragStart.y;

      // 转换屏幕坐标为Paper.js坐标
      const dpr = window.devicePixelRatio || 1;
      const paperPosition = paper.view ? paper.view.viewToProject(new paper.Point(newScreenX * dpr, newScreenY * dpr)) : { x: newScreenX, y: newScreenY } as any;
      onMove({ x: paperPosition.x, y: paperPosition.y });
    } else if (isResizing && onResize && resizeDirection) {
      const now = Date.now();
      if (now - lastResizeTime.current < RESIZE_THROTTLE) {
        return;
      }
      lastResizeTime.current = now;
      
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

  // 强制在初始挂载后再计算一次，以防Paper视图尚未准备好
  useEffect(() => {
    const timer = requestAnimationFrame(() => setRenderKey((prev) => prev + 1));
    return () => cancelAnimationFrame(timer);
  }, []);

  return (
    <div
      ref={containerRef}
      data-model-id={modelId}
      style={{
        position: 'absolute',
        left: screenBounds.x,
        top: screenBounds.y,
        width: screenBounds.width,
        height: screenBounds.height,
        zIndex: isSelected ? 6 : 5,
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: 'none',
        pointerEvents: (drawMode === 'select' && !isSelectionDragging) || isSelected ? 'auto' : 'none', // 选择框拖拽时也让鼠标事件穿透
        display: visible ? 'block' : 'none' // 根据visible属性控制显示/隐藏
      }}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => {
        // 在3D canvas上右键时，阻止默认上下文菜单，让OrbitControls处理
        const target = e.target as HTMLElement;
        if (target.tagName === 'CANVAS' && isSelected && drawMode === 'select') {
          e.preventDefault();
        }
      }}
    >
      {/* 3D模型渲染器 - 使用屏幕坐标确保与边框和控制点对齐 */}
      <Model3DViewer
        modelData={modelData}
        width={screenBounds.width}
        height={screenBounds.height}
        isSelected={isSelected}
        drawMode={drawMode}
        onCameraChange={onCameraChange}
        isResizing={isResizing}
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
              borderTop: '1px solid #3b82f6',
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
              borderBottom: '1px solid #3b82f6',
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
              borderLeft: '1px solid #3b82f6',
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
              borderRight: '1px solid #3b82f6',
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
              backgroundColor: '#ffffff',
              border: '1px solid #3b82f6',
              boxShadow: 'none',
              cursor: 'nw-resize',
              borderRadius: 0,
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
              backgroundColor: '#ffffff',
              border: '1px solid #3b82f6',
              boxShadow: 'none',
              cursor: 'ne-resize',
              borderRadius: 0,
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
              backgroundColor: '#ffffff',
              border: '1px solid #3b82f6',
              boxShadow: 'none',
              cursor: 'sw-resize',
              borderRadius: 0,
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
              backgroundColor: '#ffffff',
              border: '1px solid #3b82f6',
              boxShadow: 'none',
              cursor: 'se-resize',
              borderRadius: 0,
              zIndex: 10
            }}
          />
        </>
      )}

      {/* 单独操作按钮 */}
      {isSelected && showIndividualTools && (
        <div
          className={`absolute flex items-center justify-center gap-2 transition-all duration-150 ${
            isCapturePending ? 'opacity-90' : 'opacity-100'
          }`}
          style={{
            bottom: -48,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            pointerEvents: 'auto',
          }}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={isCapturePending}
            className={actionButtonClass}
            style={actionButtonStyle}
            title="定格当前3D画面并贴到画布"
            onClick={() => onCapture?.(modelId)}
          >
            {isCapturePending ? (
              <LoadingSpinner size="sm" className="text-blue-600" />
            ) : (
              <Camera className={actionIconClass} />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={actionButtonClass}
            style={actionButtonStyle}
            title="下载3D模型"
            onClick={async () => {
              try {
                const modelUrl = modelData.url || modelData.path;
                if (!modelUrl) {
                  window.dispatchEvent(new CustomEvent('toast', {
                    detail: { message: '无法获取模型URL', type: 'error' }
                  }));
                  return;
                }

                const fileName = modelData.fileName || `model-${Date.now()}.${modelData.format || 'glb'}`;
                logger.info('📥 开始下载3D模型', { modelUrl, fileName });
                
                await downloadFile(modelUrl, fileName);
                
                window.dispatchEvent(new CustomEvent('toast', {
                  detail: { message: '✨ 3D模型下载已开始', type: 'success' }
                }));
              } catch (error) {
                const message = error instanceof Error ? error.message : '下载失败';
                logger.error('❌ 3D模型下载失败', error);
                window.dispatchEvent(new CustomEvent('toast', {
                  detail: { message, type: 'error' }
                }));
              }
            }}
          >
            <Download className={actionIconClass} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={`${actionButtonClass} hover:text-red-600`}
            style={actionButtonStyle}
            title="删除3D模型"
            onClick={() => onDelete?.(modelId)}
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default Model3DContainer;
