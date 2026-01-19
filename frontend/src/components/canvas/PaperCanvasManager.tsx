import { useEffect } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import { useLayerStore } from '@/stores/layerStore';

const patchPaperRasterSetSourceCompat = (() => {
  let patched = false;
  return () => {
    if (patched) return;
    patched = true;

    try {
      const rasterProto = (paper as any)?.Raster?.prototype;
      if (!rasterProto || typeof rasterProto.setSource !== 'function') return;
      if (rasterProto.__tanvaSetSourceCompatPatched) return;

      const originalSetSource = rasterProto.setSource;

      rasterProto.setSource = function (src: any) {
        if (src && typeof src === 'object') {
          try {
            // 兼容错误用法：把 HTMLImageElement / Canvas 当成 Raster.source 传入
            // Paper.js 的 setSource 期望 string，否则会被转成 "[object HTMLImageElement]" 并导致加载失败。
            if (typeof src.getContext === 'function' || src.naturalHeight != null) {
              return this.setImage(src);
            }
            if (typeof src.src === 'string') {
              return originalSetSource.call(this, src.src);
            }
          } catch {}
        }
        return originalSetSource.call(this, src);
      };

      rasterProto.__tanvaSetSourceCompatPatched = true;
    } catch (error) {
      console.warn('[PaperCanvasManager] patchPaperRasterSetSourceCompat failed:', error);
    }
  };
})();

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
    patchPaperRasterSetSourceCompat();
    
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
        if (paper.view) {
          try {
            paper.view.viewSize = new paper.Size(canvas.width, canvas.height);
          } catch {
            try {
              (paper.view.viewSize as any).width = canvas.width;
              (paper.view.viewSize as any).height = canvas.height;
            } catch {}
          }
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
      // 注意：resize 回调可能在 zoom/pan 变化后触发，因此这里必须读取最新值，避免闭包过期。
      const { zoom: currentZoom, panX: currentPanX, panY: currentPanY } = useCanvasStore.getState();
      const tx = currentPanX * currentZoom;
      const ty = currentPanY * currentZoom;
      const matrix = new paper.Matrix(currentZoom, 0, 0, currentZoom, tx, ty);
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
      // 🛑 清理 Paper.js 项目资源 (P1 修复)
      if (paper.project) {
        try {
          paper.project.clear();
          paper.project.remove();
        } catch (e) {
          console.warn('Paper.js project cleanup failed:', e);
        }
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
