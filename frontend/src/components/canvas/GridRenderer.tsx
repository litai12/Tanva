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
  const gridDotSize = useCanvasStore(state => state.gridDotSize);
  const gridColor = useCanvasStore(state => state.gridColor);
  const gridBgColor = useCanvasStore(state => state.gridBgColor);
  const gridBgEnabled = useCanvasStore(state => state.gridBgEnabled);
  const { showGrid, showAxis } = useUIStore();
  const gridLayerRef = useRef<paper.Layer | null>(null);
  const lastPanRef = useRef({ x: panX, y: panY }); // 缓存上次的平移值
  const dotRasterRef = useRef<paper.Raster | null>(null); // 点阵模式使用的单一 Raster
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
      if (child instanceof paper.Raster && child.data?.type === 'grid-dot-raster') {
        child.remove();
        if (dotRasterRef.current === child) {
          dotRasterRef.current = null;
        }
        continue;
      }
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

    // 性能优化：拖拽时隐藏点阵网格，保留轴线
    if (isDragging && gridStyle === GridStyle.DOTS) {
      // 只隐藏网格内容，保留坐标轴
      gridLayer.children.forEach((child) => {
        if (child.data?.type === 'grid-dot') {
          child.visible = false;
        }
      });
      
      // 更新坐标轴位置但不重绘点阵
      if (showAxis) {
        const viewBounds = paper.view.bounds;
        const padding = currentGridSize * 2;
        
        // 更新Y轴
        if (axisPathsRef.current.yAxis && axisPathsRef.current.yAxis.project) {
          axisPathsRef.current.yAxis.segments[0].point = new paper.Point(0, viewBounds.top - padding);
          axisPathsRef.current.yAxis.segments[1].point = new paper.Point(0, viewBounds.bottom + padding);
          axisPathsRef.current.yAxis.visible = true;
        }
        
        // 更新X轴
        if (axisPathsRef.current.xAxis && axisPathsRef.current.xAxis.project) {
          axisPathsRef.current.xAxis.segments[0].point = new paper.Point(viewBounds.left - padding, 0);
          axisPathsRef.current.xAxis.segments[1].point = new paper.Point(viewBounds.right + padding, 0);
          axisPathsRef.current.xAxis.visible = true;
        }
      }
      
      return; // 拖拽时提前返回，不重绘点阵
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

    // 修复边界计算逻辑
    const actualMaxX = Math.min(maxX, minX + cappedRenderWidth);
    const actualMaxY = Math.min(maxY, minY + cappedRenderHeight);

    // 使用修正后的边界
    const finalMinX = minX;
    const finalMaxX = actualMaxX;
    const finalMinY = minY;
    const finalMaxY = actualMaxY;

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
        createSolidBackground(finalMinX, finalMaxX, finalMinY, finalMaxY, gridLayer);
      }

      // 覆盖层（线条/点阵）
      if (gridStyle === GridStyle.DOTS) {
        const counts = createDotGrid(currentGridSize, finalMinX, finalMaxX, finalMinY, finalMaxY, gridDotSize, gridLayer);
        poolStats = { main: counts.mainCount, minor: counts.minorCount, lines: 0 };
      } else if (gridStyle === GridStyle.LINES) {
        // 切换到线条时移除点阵 Raster
        if (dotRasterRef.current) {
          dotRasterRef.current.remove();
          dotRasterRef.current = null;
        }
        const counts = createLineGrid(currentGridSize, finalMinX, finalMaxX, finalMinY, finalMaxY, zoom, gridLayer);
        poolStats = { main: counts.mainCount, minor: counts.minorCount, lines: counts.lineCount };
      } else {
        // SOLID 时移除点阵并不叠加其他内容
        if (dotRasterRef.current) {
          dotRasterRef.current.remove();
          dotRasterRef.current = null;
        }
      }
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
  }, [zoom, showGrid, showAxis, gridStyle, gridDotSize, gridColor, gridBgColor, gridBgEnabled]);

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

  // 点阵网格创建
  const createDotGrid = (
    currentGridSize: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    dotSize: number,
    gridLayer: paper.Layer
  ) => {
    // 先移除旧的 Raster，避免累计
    if (dotRasterRef.current) {
      dotRasterRef.current.remove();
      dotRasterRef.current = null;
    }

    const viewWidth = maxX - minX;
    const viewHeight = maxY - minY;
    if (viewWidth <= 0 || viewHeight <= 0) {
      return { mainCount: 0, minorCount: 0, lineCount: 0 };
    }

    // 计算主/副点数量（基于坐标索引，避免实际创建所有点）
    const startX = Math.ceil(minX / currentGridSize);
    const endX = Math.floor(maxX / currentGridSize);
    const startY = Math.ceil(minY / currentGridSize);
    const endY = Math.floor(maxY / currentGridSize);
    const cols = Math.max(0, endX - startX + 1);
    const rows = Math.max(0, endY - startY + 1);
    const countMultiples = (start: number, end: number, step: number) => {
      const first = Math.ceil(start / step) * step;
      const last = Math.floor(end / step) * step;
      if (first > last) return 0;
      return Math.floor((last - first) / step) + 1;
    };
    const mainCols = countMultiples(startX, endX, 5);
    const mainRows = countMultiples(startY, endY, 5);
    const mainCount = mainCols * mainRows;
    const totalDots = cols * rows;
    const minorCount = Math.max(0, totalDots - mainCount);

    // 用小 tile 生成重复图案，再绘制到受限尺寸的离屏画布，减少对象数量
    const patternSize = Math.max(1, Math.round(currentGridSize * 5)); // 5格一周期
    const tile = document.createElement('canvas');
    tile.width = patternSize;
    tile.height = patternSize;
    const tctx = tile.getContext('2d');
    if (!tctx) return { mainCount, minorCount, lineCount: 0 };

    const parseColor = (hex: string) => {
      let r = 229, g = 231, b = 235;
      const h = (hex || '').replace('#', '');
      if (h.length === 3) {
        r = parseInt(h[0] + h[0], 16);
        g = parseInt(h[1] + h[1], 16);
        b = parseInt(h[2] + h[2], 16);
      } else if (h.length === 6) {
        r = parseInt(h.substring(0, 2), 16);
        g = parseInt(h.substring(2, 4), 16);
        b = parseInt(h.substring(4, 6), 16);
      }
      return `rgba(${r}, ${g}, ${b}, 0.28)`;
    };

    const radius = Math.max(0.5, Math.min(4, dotSize));
    const color = parseColor(gridColor);
    tctx.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const isMain = i === 0 && j === 0; // 每 5 格交点
        const cx = i * currentGridSize;
        const cy = j * currentGridSize;
        tctx.beginPath();
        tctx.arc(cx, cy, isMain ? radius * 1.2 : radius, 0, Math.PI * 2);
        tctx.fill();
      }
    }

    const MAX_CANVAS = 4096; // 防止离屏画布过大
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(MAX_CANVAS, Math.max(1, Math.round(viewWidth + patternSize)));
    canvas.height = Math.min(MAX_CANVAS, Math.max(1, Math.round(viewHeight + patternSize)));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { mainCount, minorCount, lineCount: 0 };

    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return { mainCount, minorCount, lineCount: 0 };

    // 对齐世界坐标系，保证点阵与其他网格元素对齐
    const offsetX = ((minX % patternSize) + patternSize) % patternSize;
    const offsetY = ((minY % patternSize) + patternSize) % patternSize;
    ctx.translate(-offsetX, -offsetY);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width + patternSize, canvas.height + patternSize);

    const raster = new paper.Raster({
      source: canvas,
      position: new paper.Point(
        minX + canvas.width / 2,
        minY + canvas.height / 2
      ),
    });
    raster.data = { isHelper: true, type: 'grid-dot-raster' };
    // Paper.js 类型声明中 smoothing 可能被标成 string，这里显式断言为 any 以避免 TS 报错
    (raster as any).smoothing = false;
    gridLayer.addChild(raster);
    dotRasterRef.current = raster;

    return { mainCount, minorCount, lineCount: 0 };
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
      if (dotRasterRef.current) {
        dotRasterRef.current.remove();
        dotRasterRef.current = null;
      }
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

    // 根据网格样式调整重绘阈值
    const redrawThreshold = gridStyle === GridStyle.DOTS ? gridSize / 3 : gridSize / 2;
    const shouldRedrawFromPan = panDistance > redrawThreshold;

    // 决定是否需要重绘
    const shouldRedraw = shouldRedrawFromPan || (!isDragging && gridStyle === GridStyle.DOTS);

    if (isFirstRender) {
      createGrid(gridSize);
      lastPanRef.current = { x: panX, y: panY };
      isInitializedRef.current = true;
      return;
    }

    if (shouldRedraw) {
      const delay = (gridStyle === GridStyle.DOTS && shouldRedrawFromPan) ? 100 : 0;
      const timeoutId = setTimeout(() => {
        createGrid(gridSize);
        lastPanRef.current = { x: panX, y: panY };
      }, delay);

      return () => clearTimeout(timeoutId);
    }
  }, [isPaperInitialized, showGrid, showAxis, gridSize, gridStyle, zoom, isDragging, panX, panY, gridDotSize, gridColor, gridBgColor, gridBgEnabled, createGrid]);

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

      if (dotRasterRef.current) {
        dotRasterRef.current.remove();
        dotRasterRef.current = null;
      }


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
