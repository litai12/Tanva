import { useEffect } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';

interface PaperCanvasManagerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onInitialized?: () => void;
}

const PaperCanvasManager: React.FC<PaperCanvasManagerProps> = ({ 
  canvasRef, 
  onInitialized 
}) => {
  const { zoom, panX, panY, setPan } = useCanvasStore();

  // Paper.js 初始化和画布尺寸管理
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 初始化Paper.js
    paper.setup(canvas);
    
    // 禁用Paper.js的默认交互行为
    if (paper.view) {
      paper.view.onMouseDown = null;
      paper.view.onMouseDrag = null;
      paper.view.onMouseUp = null;
    }

    let isInitialized = false;
    
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        // 获取设备像素比，支持高DPI屏幕
        const pixelRatio = window.devicePixelRatio || 1;
        const displayWidth = parent.clientWidth;
        const displayHeight = parent.clientHeight;
        
        // 设置画布的实际尺寸（考虑设备像素比）
        canvas.width = displayWidth * pixelRatio;
        canvas.height = displayHeight * pixelRatio;
        
        // 设置画布的显示尺寸
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        
        // 更新Paper.js视图尺寸（使用实际像素尺寸，与 canvas.width/height 一致）
        // Paper 会基于此尺寸进行变换；事件→视图坐标需自行考虑 devicePixelRatio
        if (paper.view && paper.view.viewSize) {
          (paper.view.viewSize as any).width = canvas.width;
          (paper.view.viewSize as any).height = canvas.height;
        }
        
        // 初始化时，只有在没有保存的视口状态时才将坐标轴移动到画布中心
        if (!isInitialized) {
          const { panX: savedPanX, panY: savedPanY, zoom: savedZoom } = useCanvasStore.getState();

          // 如果没有保存的pan值（都为0），说明是首次访问，需要居中
          if (savedPanX === 0 && savedPanY === 0 && savedZoom === 1.0) {
            const centerX = (displayWidth / 2) * pixelRatio; // 世界坐标以设备像素为基准
            const centerY = (displayHeight / 2) * pixelRatio;
            setPan(centerX, centerY);
          }

          isInitialized = true;

          // 通知外部组件初始化完成
          if (onInitialized) {
            onInitialized();
          }
        } else {
          // 应用视口变换
          applyViewTransform();
        }
      }
    };

    // 应用视口变换 - 使用Paper.js默认左上角坐标系
    const applyViewTransform = () => {
      // 视口变换：screen = zoom * (world + pan)
      // 我们的 pan 存储在“世界坐标”单位中，因此需要乘以 zoom 才能作为视图平移
      // 等价于在矩阵中使用缩放与已缩放平移量
      const tx = panX * zoom;
      const ty = panY * zoom;
      const matrix = new paper.Matrix(zoom, 0, 0, zoom, tx, ty);
      paper.view.matrix = matrix;
    };

    // 初始化画布
    resizeCanvas();
    // 在下一帧和短延迟后再尝试一次，避免首屏布局尚未稳定
    requestAnimationFrame(resizeCanvas);
    setTimeout(resizeCanvas, 50);

    // 监听窗口大小变化
    const handleResize = () => {
      setTimeout(resizeCanvas, 100);
    };
    window.addEventListener('resize', handleResize);

    // 监听父元素尺寸变化（更可靠）
    let ro: ResizeObserver | null = null;
    if (canvas.parentElement && 'ResizeObserver' in window) {
      ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(canvas.parentElement);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (ro) {
        try { ro.disconnect(); } catch {}
        ro = null;
      }
    };
  }, [canvasRef, setPan, onInitialized]);

  // 处理视口变换的effect
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // 应用视口变换（同上：screen = zoom * (world + pan)）
    const tx = panX * zoom;
    const ty = panY * zoom;
    const matrix = new paper.Matrix(zoom, 0, 0, zoom, tx, ty);
    paper.view.matrix = matrix;
    
  }, [zoom, panX, panY, canvasRef]);

  return null; // 这个组件不渲染任何DOM
};

export default PaperCanvasManager;
