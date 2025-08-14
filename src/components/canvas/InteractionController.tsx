import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores';

interface InteractionControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const InteractionController: React.FC<InteractionControllerProps> = ({ canvasRef }) => {
  const isDraggingRef = useRef(false); // 拖拽状态缓存
  const zoomRef = useRef(1); // 缓存缩放值避免频繁getState
  const { zoom, setPan } = useCanvasStore();

  // 同步缓存的zoom值
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 画布交互功能 - 仅保留中键拖动
    let isDragging = false;
    let lastScreenPoint: { x: number, y: number } | null = null;
    let dragStartPanX = 0;
    let dragStartPanY = 0;
    let dragAnimationId: number | null = null;

    // 鼠标事件处理
    const handleMouseDown = (event: MouseEvent) => {
      // 只响应中键（button === 1）
      if (event.button === 1) {
        event.preventDefault(); // 阻止中键的默认行为（滚动）
        isDragging = true;
        isDraggingRef.current = true; // 设置拖拽状态缓存
        
        const rect = canvas.getBoundingClientRect();
        lastScreenPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        
        // 获取当前最新的状态值
        const currentState = useCanvasStore.getState();
        dragStartPanX = currentState.panX;
        dragStartPanY = currentState.panY;
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging && lastScreenPoint) {
        const rect = canvas.getBoundingClientRect();
        const currentScreenPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        
        // 计算屏幕坐标增量
        const screenDeltaX = currentScreenPoint.x - lastScreenPoint.x;
        const screenDeltaY = currentScreenPoint.y - lastScreenPoint.y;
        
        // 使用缓存的缩放值转换为世界坐标增量
        const worldDeltaX = screenDeltaX / zoomRef.current;
        const worldDeltaY = screenDeltaY / zoomRef.current;
        
        // 更新平移值
        const newPanX = dragStartPanX + worldDeltaX;
        const newPanY = dragStartPanY + worldDeltaY;
        
        // 拖拽时使用requestAnimationFrame优化性能
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
      if (event.button === 1 && isDragging) {
        isDragging = false;
        isDraggingRef.current = false; // 清除拖拽状态缓存
        lastScreenPoint = null;
        canvas.style.cursor = 'default';
        
        // 清理拖拽动画
        if (dragAnimationId) {
          cancelAnimationFrame(dragAnimationId);
          dragAnimationId = null;
        }
      }
    };

    // 处理滚轮/触控板事件：支持双指平移，阻止缩放
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault(); // 阻止浏览器默认行为（缩放/滚动）
      event.stopPropagation();
      
      // 检测触控板双指滑动或鼠标滚轮
      if (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) > 0) {
        // 转换为画布坐标系的平移（考虑当前缩放级别）
        const worldDeltaX = -event.deltaX / zoomRef.current;
        const worldDeltaY = -event.deltaY / zoomRef.current;
        
        // 获取当前状态并更新画布位置
        const currentState = useCanvasStore.getState();
        const newPanX = currentState.panX + worldDeltaX;
        const newPanY = currentState.panY + worldDeltaY;
        
        setPan(newPanX, newPanY);
      }
    };

    // 添加事件监听器
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [setPan, canvasRef]);

  return null; // 这个组件不渲染任何DOM
};

export default InteractionController;