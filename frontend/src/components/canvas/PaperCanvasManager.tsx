import { useCallback, useEffect, useRef } from 'react';
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

  const pendingViewUpdateRafRef = useRef<number | null>(null);
  const requestViewUpdate = useCallback(() => {
    try {
      if (!paper?.view) return;
      if (pendingViewUpdateRafRef.current !== null) return;

      if (typeof requestAnimationFrame !== 'function') {
        (paper.view as any)?.update?.();
        return;
      }

      pendingViewUpdateRafRef.current = requestAnimationFrame(() => {
        pendingViewUpdateRafRef.current = null;
        try { (paper.view as any)?.update?.(); } catch {}
      });
    } catch {}
  }, []);

  const applyViewTransformFromStore = useCallback(() => {
    try {
      if (!paper?.view) return;
      const state = useCanvasStore.getState();
      const z = Math.max(state.zoom ?? 1, 0.0001);
      const tx = (state.panX ?? 0) * z;
      const ty = (state.panY ?? 0) * z;
      paper.view.matrix = new paper.Matrix(z, 0, 0, z, tx, ty);
    } catch {}
  }, []);

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
        // 通过 setter 更新可确保 Paper.js 标记需要重绘
        if (paper.view) {
          try {
            paper.view.viewSize = new paper.Size(canvas.width, canvas.height);
          } catch {
            try {
              if ((paper.view as any).viewSize) {
                (paper.view.viewSize as any).width = canvas.width;
                (paper.view.viewSize as any).height = canvas.height;
              }
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
          // ⚠️ 这里不能使用闭包里的 zoom/pan：项目切换/选中图片会触发 resize，
          // 若用旧值会把 view.matrix 重置，导致"图片位置跳变/网格消失直到交互"
          applyViewTransformFromStore();
        }

        // resize 会清空 canvas 位图；强制请求一次重绘，避免状态延迟到交互才刷新
        requestViewUpdate();
      }
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
    // 记录上一次的父元素尺寸，避免不必要的 resize 处理
    let lastParentWidth = canvas.parentElement?.clientWidth ?? 0;
    let lastParentHeight = canvas.parentElement?.clientHeight ?? 0;

    let ro: ResizeObserver | null = null;
    if (canvas.parentElement && 'ResizeObserver' in window) {
      ro = new ResizeObserver((entries) => {
        // 检查尺寸是否真正变化
        // 这可以防止点击图片时因工具栏出现等 DOM 变化触发的不必要的 resize
        const entry = entries[0];
        if (entry) {
          const newWidth = entry.contentRect.width;
          const newHeight = entry.contentRect.height;

          // 只有当尺寸真正变化时才调用 resizeCanvas
          if (Math.abs(newWidth - lastParentWidth) > 1 || Math.abs(newHeight - lastParentHeight) > 1) {
            lastParentWidth = newWidth;
            lastParentHeight = newHeight;
            resizeCanvas();
          }
        }
      });
      ro.observe(canvas.parentElement);
    }

    return () => {
      if (pendingViewUpdateRafRef.current !== null) {
        try {
          if (typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(pendingViewUpdateRafRef.current);
          }
        } catch {}
        pendingViewUpdateRafRef.current = null;
      }
      window.removeEventListener('resize', handleResize);
      if (ro) {
        try { ro.disconnect(); } catch {}
        ro = null;
      }
    };
  }, [canvasRef, setPan, onInitialized, applyViewTransformFromStore, requestViewUpdate]);

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

    // 保险：部分场景下矩阵更新不会立刻触发重绘（或被 resize 覆盖）
    requestViewUpdate();
  
  }, [zoom, panX, panY, canvasRef, requestViewUpdate]);

  return null; // 这个组件不渲染任何DOM
};

export default PaperCanvasManager;
