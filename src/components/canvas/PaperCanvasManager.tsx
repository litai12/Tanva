import { useEffect, useRef } from 'react';
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
  // 守护只初始化一次（跨 StrictMode 双执行）
  const setupDoneRef = useRef(false);
  const initNotifiedRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const pendingRafRef = useRef<number | null>(null);

  // Paper.js 初始化和画布尺寸管理
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 在以下任一情况重新 setup：
    // 1) 首次初始化；2) 当前 paper.view 未绑定；3) 绑定的 canvas 与现有不一致（HMR/刷新后重建 DOM）
    const needSetup = !setupDoneRef.current || !paper.view || (paper.view as any)?.element !== canvas;
    if (needSetup) {
      paper.setup(canvas);
      // 禁用Paper.js的默认交互行为
      if (paper.view) {
        paper.view.onMouseDown = null;
        paper.view.onMouseDrag = null;
        paper.view.onMouseUp = null;
      }
      setupDoneRef.current = true;
      // console.debug('[PaperCanvasManager] paper.setup executed (needSetup=%s)', needSetup);
    }

    // let isInitialized = false; // 替换为 initNotifiedRef 持久化
    
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        // 获取设备像素比，支持高DPI屏幕
        const pixelRatio = window.devicePixelRatio || 1;
        const displayWidth = parent.clientWidth;
        const displayHeight = parent.clientHeight;
        // 若容器尚未完成布局，延迟一次再尝试
        if (!displayWidth || !displayHeight) {
          if (pendingRafRef.current) cancelAnimationFrame(pendingRafRef.current);
          pendingRafRef.current = requestAnimationFrame(() => resizeCanvas());
          return;
        }
        
        // 设置画布的实际尺寸（考虑设备像素比）
        canvas.width = displayWidth * pixelRatio;
        canvas.height = displayHeight * pixelRatio;
        
        // 设置画布的显示尺寸
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        
        // 更新Paper.js视图尺寸
        paper.view.viewSize.width = canvas.width;
        paper.view.viewSize.height = canvas.height;
        
        // 初始化时将坐标轴移动到画布中心（仅执行一次）
        if (!initNotifiedRef.current) {
          const centerX = displayWidth / 2;
          const centerY = displayHeight / 2;
          setPan(centerX, centerY);
          initNotifiedRef.current = true;
          
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
      // 构建新的变换矩阵，避免频繁重置
      const matrix = new paper.Matrix();
      matrix.scale(zoom);
      matrix.translate(panX, panY);
      paper.view.matrix = matrix;
    };

    // 初始化画布（推迟到下一帧，确保布局完成）
    pendingRafRef.current = requestAnimationFrame(() => resizeCanvas());

    // 监听窗口大小变化
    const handleResize = () => {
      setTimeout(resizeCanvas, 100);
    };
    window.addEventListener('resize', handleResize);

    // 监听父容器尺寸变化，覆盖非窗口来源的布局变更
    const parent = canvas.parentElement;
    if (parent && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(parent);
      resizeObserverRef.current = ro;
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserverRef.current) {
        try { resizeObserverRef.current.disconnect(); } catch {}
        resizeObserverRef.current = null;
      }
      if (pendingRafRef.current) {
        cancelAnimationFrame(pendingRafRef.current);
        pendingRafRef.current = null;
      }
    };
  }, [canvasRef, setPan, onInitialized]);

  // 处理视口变换的effect
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // 应用视口变换
    const matrix = new paper.Matrix();
    matrix.scale(zoom);
    matrix.translate(panX, panY);
    paper.view.matrix = matrix;
    
  }, [zoom, panX, panY, canvasRef]);

  return null; // 这个组件不渲染任何DOM
};

export default PaperCanvasManager;
