import { useCallback, useEffect, useRef } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore, GridStyle } from '@/stores';
import { memoryMonitor } from '@/utils/memoryMonitor';
import { logger } from '@/utils/logger';

interface GridRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isPaperInitialized: boolean;
}

const isLayerRemoved = (layer: paper.Layer | null): boolean => Boolean(layer && (layer as any).removed);

const GridRenderer: React.FC<GridRendererProps> = ({ canvasRef, isPaperInitialized }) => {
  const { gridSize, gridStyle, zoom, isDragging, panX, panY } = useCanvasStore();
  const gridColor = useCanvasStore(state => state.gridColor);
  const gridBgColor = useCanvasStore(state => state.gridBgColor);
  const gridBgEnabled = useCanvasStore(state => state.gridBgEnabled);
  const { showGrid, showAxis } = useUIStore();
  const gridLayerRef = useRef<paper.Layer | null>(null);
  const lastPanRef = useRef({ x: panX, y: panY }); // 缓存上次的平移值
  const lastZoomRef = useRef(zoom); // 缓存上次的缩放值
  const isInitializedRef = useRef(false); // 标记是否已完成初始化渲染

  // Paper.js对象池 - 优化：增加池大小和清理机制
  const pathPoolRef = useRef<paper.Path[]>([]);
  const MAX_POOL_SIZE = 500; // 增加到500，支持大型项目
  const POOL_CLEANUP_THRESHOLD = 750; // 超过750时触发清理
  const lastPoolCleanupRef = useRef<number>(Date.now());
  const POOL_CLEANUP_INTERVAL = 30000; // 30秒清理一次

  const axisPathsRef = useRef<{ xAxis: paper.Path | null, yAxis: paper.Path | null }>({
    xAxis: null,
    yAxis: null
  });

  // 使用 ref 存储最新的 gridSize，避免事件监听器依赖变化
  const gridSizeRef = useRef(gridSize);
  gridSizeRef.current = gridSize;

  // 专业版网格系统 - 支持视口裁剪的无限网格，固定间距
  const createGrid = useCallback((baseGridSize: number = 20) => {
    // 强化 Paper.js 状态检查
    if (!isPaperInitialized || !paper.project || !paper.view || !canvasRef.current) {
      console.warn('Paper.js not properly initialized');
      return;
    }

    if (paper.view.bounds.width === 0 || paper.view.bounds.height === 0) {
      requestAnimationFrame(() => createGrid(baseGridSize));
      return;
    }

    // 防止重复调用
    if (gridLayerRef.current?.data?.isRendering) {
      logger.debug('Grid render already in progress, skipping');
      return;
    }

    // 使用固定网格间距，通过缩放实现视觉变化
    const currentGridSize = baseGridSize;
    // 保存当前活动图层
    const previousActiveLayer = paper.project.activeLayer;

    // 找到或创建网格图层
    let gridLayer = gridLayerRef.current;

    // 强化图层有效性检查
    const isLayerValid = gridLayer &&
                        gridLayer.project === paper.project &&
                        !isLayerRemoved(gridLayer) &&
                        gridLayer.parent !== null;

    if (!isLayerValid) {
      // 清理旧图层
      if (gridLayer && !isLayerRemoved(gridLayer)) {
        gridLayer.removeChildren();
        gridLayer.remove();
      }

      gridLayer = new paper.Layer();
      gridLayer.name = "grid";
      gridLayer.data = { isGrid: true };
      gridLayer.sendToBack();
      gridLayerRef.current = gridLayer;
    }

    // 确保gridLayer有效
    if (!gridLayer) return;

    // 设置渲染标记，防止重复调用
    gridLayer.data = { isGrid: true, isRendering: true };

    // 清理现有网格内容
    const existingChildren = gridLayer.children;
    for (let i = existingChildren.length - 1; i >= 0; i--) {
      const child = existingChildren[i];
      if (child instanceof paper.Path && !child.data?.isAxis) {
        child.visible = false;

        // 优化：增加对象池大小，并验证对象有效性
        if (child.data?.type === 'grid' && pathPoolRef.current.length < MAX_POOL_SIZE) {
          // 验证对象有效性后再回收
          if (child.project && !(child as any).removed) {
            pathPoolRef.current.push(child as paper.Path);
          } else {
            child.remove();
          }
        } else {
          child.remove();
        }
      } else if (child.data?.isAxis) {
        // 保留坐标轴，只是隐藏
        child.visible = false;
      }
    }

    // 定期清理对象池中的无效对象
    const now = Date.now();
    if (now - lastPoolCleanupRef.current > POOL_CLEANUP_INTERVAL) {
      pathPoolRef.current = pathPoolRef.current.filter(path => {
        if (!path.project || (path as any).removed) {
          path.remove();
          return false;
        }
        return true;
      });
      // 如果池太大，删除一半
      if (pathPoolRef.current.length > POOL_CLEANUP_THRESHOLD) {
        const toRemove = pathPoolRef.current.splice(0, Math.floor(pathPoolRef.current.length / 2));
        toRemove.forEach(path => path.remove());
      }
      lastPoolCleanupRef.current = now;
    }

    gridLayer.activate();

    // 如果网格和坐标轴都关闭，则不显示任何内容
    if (!showGrid && !showAxis) {
      return;
    }

    // 获取世界坐标系中的可视边界
    const viewBounds = paper.view.bounds;

    // 虚拟化渲染：智能计算渲染边界，避免过度渲染
    const padding = currentGridSize * 2;
    const viewWidth = viewBounds.width;
    const viewHeight = viewBounds.height;

    // 优化：根据缩放级别动态调整渲染倍数，避免低缩放时渲染过多
    const calculateRenderMultiplier = (z: number): number => {
      if (z >= 0.5) return 3;      // 50%+ 渲染3倍
      if (z >= 0.3) return 4;      // 30-50% 渲染4倍
      if (z >= 0.15) return 5;     // 15-30% 渲染5倍
      return 6;                     // <15% 渲染6倍（保持原来的值）
    };

    const renderMultiplier = calculateRenderMultiplier(zoom);
    const effectivePadding = padding * Math.min(renderMultiplier, 3);

    const minX = Math.floor((viewBounds.left - effectivePadding) / currentGridSize) * currentGridSize;
    const maxX = Math.ceil((viewBounds.right + effectivePadding) / currentGridSize) * currentGridSize;
    const minY = Math.floor((viewBounds.top - effectivePadding) / currentGridSize) * currentGridSize;
    const maxY = Math.ceil((viewBounds.bottom + effectivePadding) / currentGridSize) * currentGridSize;

    // 优化：虚拟化限制，根据缩放动态调整，并设置绝对像素上限
    const maxRenderWidth = viewWidth * renderMultiplier;
    const maxRenderHeight = viewHeight * renderMultiplier;

    // 绝对像素上限：防止极端情况下渲染过多（增大到8000px，确保正常显示）
    const MAX_RENDER_PIXELS = 8000;
    const cappedRenderWidth = Math.min(maxRenderWidth, MAX_RENDER_PIXELS);
    const cappedRenderHeight = Math.min(maxRenderHeight, MAX_RENDER_PIXELS);

    // 当视口很大时，限制渲染区域时仍要覆盖视口中心
    const centerX = paper.view.center.x;
    const centerY = paper.view.center.y;
    const calcRange = (
      min: number,
      max: number,
      cappedSize: number,
      center: number
    ) => {
      const total = max - min;
      const size = Math.min(total, cappedSize);
      const half = size / 2;
      const clampedMin = Math.max(min, center - half);
      const clampedMax = Math.min(max, center + half);
      const snappedMin = Math.floor(clampedMin / currentGridSize) * currentGridSize;
      const snappedMax = Math.ceil(clampedMax / currentGridSize) * currentGridSize;
      if (snappedMax <= snappedMin) {
        return { min: snappedMin, max: snappedMin + currentGridSize };
      }
      return { min: snappedMin, max: snappedMax };
    };

    const { min: finalMinX, max: finalMaxX } = calcRange(minX, maxX, cappedRenderWidth, centerX);
    const { min: finalMinY, max: finalMaxY } = calcRange(minY, maxY, cappedRenderHeight, centerY);

    // 创建或更新坐标轴（如果启用）- 固定在Paper.js (0,0)点
    if (showAxis) {
      // Y轴（蓝色竖直线） - 复用现有轴或创建新的，使用虚拟化边界
      if (!axisPathsRef.current.yAxis || !axisPathsRef.current.yAxis.project) {
        axisPathsRef.current.yAxis = new paper.Path.Line({
          from: [0, finalMinY - effectivePadding],
          to: [0, finalMaxY + effectivePadding],
          strokeColor: new paper.Color(0.2, 0.4, 0.8, 1.0), // 蓝色Y轴
          strokeWidth: 1.5,
          data: { isAxis: true, axis: 'Y', isHelper: true }
        });
        gridLayer.addChild(axisPathsRef.current.yAxis);
      } else {
        // 更新现有Y轴的位置
        axisPathsRef.current.yAxis.segments[0].point = new paper.Point(0, finalMinY - effectivePadding);
        axisPathsRef.current.yAxis.segments[1].point = new paper.Point(0, finalMaxY + effectivePadding);
        axisPathsRef.current.yAxis.visible = true;
        if (axisPathsRef.current.yAxis.parent !== gridLayer) {
          gridLayer.addChild(axisPathsRef.current.yAxis);
        }
      }

      // X轴（红色水平线） - 复用现有轴或创建新的，使用虚拟化边界
      if (!axisPathsRef.current.xAxis || !axisPathsRef.current.xAxis.project) {
        axisPathsRef.current.xAxis = new paper.Path.Line({
          from: [finalMinX - effectivePadding, 0],
          to: [finalMaxX + effectivePadding, 0],
          strokeColor: new paper.Color(0.8, 0.2, 0.2, 1.0), // 红色X轴
          strokeWidth: 1.5,
          data: { isAxis: true, axis: 'X', isHelper: true }
        });
        gridLayer.addChild(axisPathsRef.current.xAxis);
      } else {
        // 更新现有X轴的位置
        axisPathsRef.current.xAxis.segments[0].point = new paper.Point(finalMinX - effectivePadding, 0);
        axisPathsRef.current.xAxis.segments[1].point = new paper.Point(finalMaxX + effectivePadding, 0);
        axisPathsRef.current.xAxis.visible = true;
        if (axisPathsRef.current.xAxis.parent !== gridLayer) {
          gridLayer.addChild(axisPathsRef.current.xAxis);
        }
      }
    }

    // 用于上报面板的对象池计数
    let poolStats = { main: 0, minor: 0, lines: 0 };

    // 创建网格（如果启用）- 暂时禁用点阵，只支持线条和纯色
    if (showGrid) {
      // 可选：在任何样式下都叠加底色
      if (gridBgEnabled || gridStyle === GridStyle.SOLID) {
        // 背景必须覆盖完整视口，不能使用虚拟化后的裁剪尺寸，否则低缩放会露白
        const bgPadding = Math.max(viewWidth, viewHeight) * 0.5 + effectivePadding;
        const bgMinX = viewBounds.left - bgPadding;
        const bgMaxX = viewBounds.right + bgPadding;
        const bgMinY = viewBounds.top - bgPadding;
        const bgMaxY = viewBounds.bottom + bgPadding;
        createSolidBackground(bgMinX, bgMaxX, bgMinY, bgMaxY, gridLayer);
      }

      // 线条网格
      if (gridStyle === GridStyle.LINES) {
        const counts = createLineGrid(currentGridSize, finalMinX, finalMaxX, finalMinY, finalMaxY, zoom, gridLayer);
        poolStats = { main: counts.mainCount, minor: counts.minorCount, lines: counts.lineCount };
      }
      // SOLID 模式只显示纯色背景，不叠加其他内容
    } else {
      // 网格关闭时同步清零
      memoryMonitor.updatePoolStats(0, 0, 0);
    }

    // 将网格层移到最底部并清除渲染标记
    gridLayer.sendToBack();
    if (gridLayer.data) {
      gridLayer.data.isRendering = false;
    }

    // 恢复之前的活动图层
    if (previousActiveLayer && previousActiveLayer.name &&
      previousActiveLayer.name.startsWith('layer_')) {
      previousActiveLayer.activate();
    }

    if (showGrid) {
      memoryMonitor.updatePoolStats(poolStats.main, poolStats.minor, poolStats.lines);
    }
  }, [zoom, showGrid, showAxis, gridStyle, gridColor, gridBgColor, gridBgEnabled]);

  // 线条网格创建函数
  const getColorWithAlpha = (hex: string, alpha: number) => {
    // 解析 #rrggbb 或 #rgb
    let r = 229, g = 231, b = 235; // fallback #e5e7eb
    const h = (hex || '').replace('#','');
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16);
    } else if (h.length === 6) {
      r = parseInt(h.substring(0,2), 16); g = parseInt(h.substring(2,4), 16); b = parseInt(h.substring(4,6), 16);
    }
    return new paper.Color(r/255, g/255, b/255, alpha);
  };

  const createLineGrid = (currentGridSize: number, minX: number, maxX: number, minY: number, maxY: number, zoom: number, gridLayer: paper.Layer) => {
    let mainCount = 0;
    let minorCount = 0;
    let lineCount = 0;

    // 计算副网格显示阈值 - 当缩放小于30%时隐藏副网格
    const shouldShowMinorGrid = zoom >= 0.3;
    const minorColor = getColorWithAlpha(gridColor, 0.10);
    const majorColor = getColorWithAlpha(gridColor, 0.13);

    // 创建垂直网格线
    for (let x = minX; x <= maxX; x += currentGridSize) {
      // 跳过轴线位置（如果显示轴线）
      if (showAxis && x === 0) continue;

      // 计算是否为主网格线（每5条线）
      const gridIndex = Math.round(x / currentGridSize);
      const isMainGrid = gridIndex % 5 === 0;

      // 如果是副网格且缩放过小，则跳过
      if (!isMainGrid && !shouldShowMinorGrid) continue;

      lineCount += 1;
      if (isMainGrid) mainCount += 1;
      else minorCount += 1;

      // 从对象池获取路径或创建新的 - 垂直线
      let line: paper.Path;
      const poolItem = pathPoolRef.current.pop();

      if (poolItem && poolItem.segments && poolItem.segments.length === 2) {
        // 复用现有路径
        line = poolItem;
        line.segments[0].point = new paper.Point(x, minY);
        line.segments[1].point = new paper.Point(x, maxY);
        line.strokeColor = isMainGrid ? majorColor : minorColor;
        line.strokeWidth = isMainGrid ? 0.8 : 0.3;
        line.visible = true;
        line.data = { ...(line.data || {}), isHelper: true, type: 'grid', isMain: isMainGrid };
      } else {
        // 创建新路径
        line = new paper.Path.Line({
          from: [x, minY],
          to: [x, maxY],
          strokeColor: isMainGrid ? majorColor : minorColor,
          strokeWidth: isMainGrid ? 0.8 : 0.3,
          data: { isHelper: true, type: 'grid', isMain: isMainGrid }
        });
      }
      gridLayer.addChild(line);
      lineCount += 1;
    }

    // 创建水平网格线
    for (let y = minY; y <= maxY; y += currentGridSize) {
      // 跳过轴线位置（如果显示轴线）
      if (showAxis && y === 0) continue;

      // 计算是否为主网格线（每5条线）
      const gridIndex = Math.round(y / currentGridSize);
      const isMainGrid = gridIndex % 5 === 0;

      // 如果是副网格且缩放过小，则跳过
      if (!isMainGrid && !shouldShowMinorGrid) continue;

      lineCount += 1;
      if (isMainGrid) mainCount += 1;
      else minorCount += 1;

      // 从对象池获取路径或创建新的 - 水平线
      let line: paper.Path;
      const poolItem = pathPoolRef.current.pop();

      if (poolItem && poolItem.segments && poolItem.segments.length === 2) {
        // 复用现有路径
        line = poolItem;
        line.segments[0].point = new paper.Point(minX, y);
        line.segments[1].point = new paper.Point(maxX, y);
        line.strokeColor = isMainGrid ? majorColor : minorColor;
        line.strokeWidth = isMainGrid ? 0.8 : 0.3;
        line.visible = true;
        line.data = { ...(line.data || {}), isHelper: true, type: 'grid', isMain: isMainGrid };
      } else {
        // 创建新路径
        line = new paper.Path.Line({
          from: [minX, y],
          to: [maxX, y],
          strokeColor: isMainGrid ? majorColor : minorColor,
          strokeWidth: isMainGrid ? 0.8 : 0.3,
          data: { isHelper: true, type: 'grid', isMain: isMainGrid }
        });
      }
      gridLayer.addChild(line);
      lineCount += 1;
    }

    return { mainCount, minorCount, lineCount };
  };

  // 纯色背景创建函数 - 创建淡淡的灰色背景
  const createSolidBackground = (minX: number, maxX: number, minY: number, maxY: number, gridLayer: paper.Layer) => {
    // 强化 Paper.js 状态检查
    if (!isPaperInitialized || !paper.project || !paper.view || !gridLayer || isLayerRemoved(gridLayer)) {
      console.warn('Paper.js or gridLayer not properly initialized');
      return;
    }

    // 创建一个覆盖整个可视区域的纯色矩形
    const bg = (() => {
      try {
        const h = (gridBgColor || '#f7f7f7').replace('#','');
        let r = 247, g = 247, b = 247;
        if (h.length === 3) {
          r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16);
        } else if (h.length === 6) {
          r = parseInt(h.substring(0,2), 16); g = parseInt(h.substring(2,4), 16); b = parseInt(h.substring(4,6), 16);
        }
        return new paper.Color(r/255, g/255, b/255, 1);
      } catch {
        return new paper.Color(0.95, 0.95, 0.95, 1.0);
      }
    })();

    const backgroundRect = new paper.Path.Rectangle({
      from: [minX, minY],
      to: [maxX, maxY],
      fillColor: bg,
      data: { isHelper: true, type: 'solid-background' }
    });

    gridLayer.addChild(backgroundRect);
  };

  // 统一网格渲染控制 - 合并所有触发条件到单一useEffect
  useEffect(() => {
    if (!isPaperInitialized || !canvasRef.current) return;

    // 如果网格和坐标轴都关闭，清理并返回
    if (!showGrid && !showAxis) {
      const gridLayer = gridLayerRef.current;
      if (gridLayer && !isLayerRemoved(gridLayer)) {
        gridLayer.removeChildren();
      }
      isInitializedRef.current = false; // 重置初始化标记
      memoryMonitor.updatePoolStats(0, 0, 0);
      return;
    }

    // 检查是否是首次渲染（Paper.js初始化后且未渲染过网格）
    const isFirstRender = !isInitializedRef.current;

    // 计算平移距离
    const panDistance = Math.sqrt(
      Math.pow(panX - lastPanRef.current.x, 2) +
      Math.pow(panY - lastPanRef.current.y, 2)
    );

    // 检测缩放是否变化
    const zoomChanged = zoom !== lastZoomRef.current;

    // 重绘阈值
    const redrawThreshold = gridSize / 2;
    const shouldRedrawFromPan = panDistance > redrawThreshold;

    // 决定是否需要重绘：
    // 1. 平移距离超过阈值
    // 2. 缩放变化
    const shouldRedraw = shouldRedrawFromPan || zoomChanged;

    if (isFirstRender) {
      createGrid(gridSize);
      lastPanRef.current = { x: panX, y: panY };
      lastZoomRef.current = zoom;
      isInitializedRef.current = true;
      return;
    }

    if (shouldRedraw) {
      createGrid(gridSize);
      lastPanRef.current = { x: panX, y: panY };
      lastZoomRef.current = zoom;
    }
  }, [isPaperInitialized, showGrid, showAxis, gridSize, gridStyle, zoom, isDragging, panX, panY, gridColor, gridBgColor, gridBgEnabled, createGrid]);

  // 额外的初始化兜底：在 Paper 初始化后的下一帧与100ms后各触发一次渲染
  useEffect(() => {
    if (!isPaperInitialized || !showGrid) return;
    const raf = requestAnimationFrame(() => createGrid(gridSize));
    const timer = setTimeout(() => createGrid(gridSize), 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [isPaperInitialized, showGrid, gridSize, createGrid]);

  // 监听项目变更（如 importJSON 后）强制重绘网格
  // 使用 ref 来获取最新的 createGrid 和 gridSize，避免依赖变化导致事件监听器频繁重建
  const createGridRef = useRef(createGrid);
  createGridRef.current = createGrid;

  useEffect(() => {
    const handler = () => {
      isInitializedRef.current = false;
      // 使用 ref 获取最新值，避免闭包过期
      setTimeout(() => createGridRef.current(gridSizeRef.current), 0);
    };
    window.addEventListener('paper-project-changed', handler as any);
    window.addEventListener('paper-ready', handler as any);
    window.addEventListener('paper-project-cleared', handler as any);
    return () => {
      window.removeEventListener('paper-project-changed', handler as any);
      window.removeEventListener('paper-ready', handler as any);
      window.removeEventListener('paper-project-cleared', handler as any);
    };
  }, []); // 空依赖数组，事件监听器只绑定一次

  // 强制垃圾回收函数 - 用于内存压力过大时
  const forceMemoryCleanup = useCallback(() => {
    // 强制清空所有对象池
    pathPoolRef.current.forEach(path => path && path.remove && path.remove());
    pathPoolRef.current = [];

    // 标记内存清理完成
    memoryMonitor.markCleanup();
    
    // 开发模式下触发手动垃圾回收
    if (import.meta.env.DEV) {
      memoryMonitor.forceCleanup();
    }

    logger.debug('强制内存清理已完成');
  }, []);

  // 监控内存使用，必要时触发强制清理
  useEffect(() => {
    const checkMemoryPressure = () => {
      const stats = memoryMonitor.getStats();
      const totalPoolSize = stats.activePoolSize.gridLines;

      // 如果对象池总大小超过1000或总对象超过5000，强制清理
      if (totalPoolSize > 1000 || stats.totalItems > 5000) {
        console.warn('检测到内存压力，执行强制清理:', stats);
        forceMemoryCleanup();
      }

      // 优化：调用 memoryMonitor 的自动清理检查
      memoryMonitor.checkAndCleanup();
    };

    // 注册内存压力清理回调
    const unregister = memoryMonitor.onMemoryPressure(forceMemoryCleanup);

    // 每30秒检查一次内存使用情况
    const intervalId = setInterval(checkMemoryPressure, 30000);

    return () => {
      clearInterval(intervalId);
      unregister(); // 取消注册清理回调
    };
  }, [forceMemoryCleanup]);

  // 清理函数
  useEffect(() => {
    return () => {
      // 清理对象池中的路径
      pathPoolRef.current.forEach(path => {
        if (path && path.remove) {
          path.remove();
        }
      });
      pathPoolRef.current = [];

      // 清理坐标轴
      if (axisPathsRef.current.xAxis) {
        axisPathsRef.current.xAxis.remove();
        axisPathsRef.current.xAxis = null;
      }
      if (axisPathsRef.current.yAxis) {
        axisPathsRef.current.yAxis.remove();
        axisPathsRef.current.yAxis = null;
      }

      // 清理网格图层
      const gridLayer = gridLayerRef.current;
      if (gridLayer && gridLayer.project) {
        gridLayer.removeChildren();
        gridLayer.remove();
        gridLayerRef.current = null;
      }

      // 重置初始化标记
      isInitializedRef.current = false;

      // 最终清理内存监控
      memoryMonitor.markCleanup();
    };
  }, [forceMemoryCleanup]); // 添加forceMemoryCleanup依赖

  return null; // 这个组件不渲染任何DOM
};

export default GridRenderer;
