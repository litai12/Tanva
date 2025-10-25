import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores';

interface InteractionControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const InteractionController: React.FC<InteractionControllerProps> = ({ canvasRef }) => {
  const isDraggingRef = useRef(false); // 拖拽状态缓存
  const zoomRef = useRef(1); // 缓存缩放值避免频繁getState
  const { zoom, setPan, setDragging } = useCanvasStore();

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
        setDragging(true); // 通知canvasStore开始拖拽
        
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
        const dpr = window.devicePixelRatio || 1;
        const currentScreenPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        
        // 计算屏幕坐标增量
        const screenDeltaX = currentScreenPoint.x - lastScreenPoint.x;
        const screenDeltaY = currentScreenPoint.y - lastScreenPoint.y;
        
        // 使用缓存的缩放值转换为世界坐标增量
        // 将 CSS 像素增量转换到 Paper 视图坐标（设备像素），再转世界坐标
        const worldDeltaX = (screenDeltaX * dpr) / zoomRef.current;
        const worldDeltaY = (screenDeltaY * dpr) / zoomRef.current;
        
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
        setDragging(false); // 通知canvasStore结束拖拽
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
      // Ctrl/Cmd + 滚轮：缩放（以鼠标位置为中心）
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const sx = (event.clientX - rect.left) * dpr; // 设备像素
        const sy = (event.clientY - rect.top) * dpr;

        const store = useCanvasStore.getState();
        const z1 = zoomRef.current;
        // deltaY>0 通常为缩小，反向取指数更顺滑
        const factor = Math.exp(-event.deltaY * 0.0015);
        const z2 = Math.max(0.1, Math.min(3, z1 * factor));

        // 保持鼠标下的世界坐标点不动：
        // W = sx/z1 - pan1;  pan2 = sx/z2 - W
        const pan2x = store.panX + sx * (1 / z2 - 1 / z1);
        const pan2y = store.panY + sy * (1 / z2 - 1 / z1);

        store.setPan(pan2x, pan2y);
        store.setZoom(z2);
        return;
      }

      // 普通滚轮/触控板：平移
      event.preventDefault(); // 阻止浏览器默认行为（缩放/滚动）
      event.stopPropagation();

      if (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) > 0) {
        const dpr = window.devicePixelRatio || 1;
        const worldDeltaX = (-event.deltaX * dpr) / zoomRef.current;
        const worldDeltaY = (-event.deltaY * dpr) / zoomRef.current;

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
      
      // 清理未完成的动画帧，防止内存泄漏
      if (dragAnimationId) {
        cancelAnimationFrame(dragAnimationId);
        dragAnimationId = null;
      }
    };
  }, [setPan, canvasRef]);

  return null; // 这个组件不渲染任何DOM
};

export default InteractionController;
