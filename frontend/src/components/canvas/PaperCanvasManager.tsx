import { useEffect } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import { useLayerStore } from '@/stores/layerStore';

interface PaperCanvasManagerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onInitialized?: () => void;
}

const PaperCanvasManager: React.FC<PaperCanvasManagerProps> = ({ 
  canvasRef, 
  onInitialized 
}) => {
  const { 
    zoom, 
    panX, 
    panY, 
    setPan, 
    isHydrated, 
    hasInitialCenterApplied, 
    markInitialCenterApplied 
  } = useCanvasStore();

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

    // 统一限制 paper.view.update 最大刷新率（~60fps），避免高刷新屏幕或高频事件导致过度刷新
    const installViewUpdateLimiter = () => {
      const view = paper.view as any;
      if (!view || view.__tanvaUpdateLimited) return;
      const originalUpdate = view.update?.bind(view);
      if (typeof originalUpdate !== 'function') return;

      const FRAME_INTERVAL = 1000 / 60; // 约 16.7ms
      let lastUpdateTime = 0;
      let rafId: number | null = null;
      let pending = false;

      const run = (timestamp: number) => {
        rafId = null;
        // 如果时间未到阈值，再排一次 rAF，确保上限 60fps
        if (timestamp - lastUpdateTime < FRAME_INTERVAL) {
          rafId = requestAnimationFrame(run);
          return;
        }
        lastUpdateTime = timestamp;
        pending = false;
        try {
          originalUpdate();
        } catch {}
      };

      view.update = () => {
        const now = performance.now();
        // 距离上次超过阈值：立即执行一次，保持单次调用的即时性
        if (!pending && now - lastUpdateTime >= FRAME_INTERVAL) {
          lastUpdateTime = now;
          try { originalUpdate(); } catch {}
          return;
        }
        // 已有排队则直接复用
        if (pending) return;
        pending = true;
        if (rafId === null) {
          rafId = requestAnimationFrame(run);
        }
      };

      // 暴露原始更新接口，必要时可强制同步刷新
      view.updateImmediate = originalUpdate;
      view.__tanvaUpdateLimited = true;
    };

    installViewUpdateLimiter();

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

          // 广播全局事件，便于其他模块（如自动保存管理器）得知 Paper 已就绪
          try { window.dispatchEvent(new CustomEvent('paper-ready')); } catch {}

          // 确保存在一个有效的用户图层（避免后续绘制落在兜底层或 grid 上）
          try {
            const ensure = useLayerStore.getState().ensureActiveLayer;
            if (typeof ensure === 'function') ensure();
          } catch (e) {
            console.warn('ensureActiveLayer failed during Paper init:', e);
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

  useEffect(() => {
    if (!isHydrated || hasInitialCenterApplied) {
      return;
    }

    if (Math.abs(panX) > 0.0001 || Math.abs(panY) > 0.0001) {
      markInitialCenterApplied();
      return;
    }

    const attemptInitialCenter = () => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const parent = canvas.parentElement;
      if (!parent) return false;

      const displayWidth = parent.clientWidth;
      const displayHeight = parent.clientHeight;
      if (displayWidth === 0 || displayHeight === 0) {
        return false;
      }

      const pixelRatio = window.devicePixelRatio || 1;
      const centerX = (displayWidth / 2) * pixelRatio;
      const centerY = (displayHeight / 2) * pixelRatio;
      setPan(centerX, centerY);
      markInitialCenterApplied();
      return true;
    };

    if (!attemptInitialCenter()) {
      const rafId = requestAnimationFrame(() => {
        if (!useCanvasStore.getState().hasInitialCenterApplied) {
          attemptInitialCenter();
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isHydrated, hasInitialCenterApplied, panX, panY, canvasRef, setPan, markInitialCenterApplied]);

  // 处理视口变换的effect
  useEffect(() => {
    if (!canvasRef.current) return;
    if (!paper || !paper.project || !paper.view) return;
    
    // 应用视口变换（同上：screen = zoom * (world + pan)）
    const tx = panX * zoom;
    const ty = panY * zoom;
    try {
      const matrix = new paper.Matrix(zoom, 0, 0, zoom, tx, ty);
      (paper.view as any).matrix = matrix;
    } catch {}
  
  }, [zoom, panX, panY, canvasRef]);

  return null; // 这个组件不渲染任何DOM
};

export default PaperCanvasManager;
