import { useCallback, useEffect, useRef } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore, GridStyle } from '@/stores';
import { memoryMonitor } from '@/utils/memoryMonitor';

interface GridRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isPaperInitialized: boolean;
}

const GridRenderer: React.FC<GridRendererProps> = ({ canvasRef, isPaperInitialized }) => {
  const { gridSize, gridStyle, zoom, isDragging, panX, panY } = useCanvasStore();
  const gridDotSize = useCanvasStore(state => state.gridDotSize);
  const gridColor = useCanvasStore(state => state.gridColor);
  const gridBgColor = useCanvasStore(state => state.gridBgColor);
  const { showGrid, showAxis } = useUIStore();
  const gridLayerRef = useRef<paper.Layer | null>(null);
  const lastPanRef = useRef({ x: panX, y: panY }); // 缓存上次的平移值

  // Paper.js对象池 - 简化为只有线条对象池
  const pathPoolRef = useRef<paper.Path[]>([]);
  const axisPathsRef = useRef<{ xAxis: paper.Path | null, yAxis: paper.Path | null }>({
    xAxis: null,
    yAxis: null
  });

  // 专业版网格系统 - 支持视口裁剪的无限网格，固定间距
  const createGrid = useCallback((baseGridSize: number = 20) => {
    // 添加 Paper.js 状态检查
    if (!paper.project || !paper.view) {
      console.warn('Paper.js not initialized yet');
      return;
    }

    // 使用固定网格间距，通过缩放实现视觉变化
    const currentGridSize = baseGridSize;
    // 保存当前活动图层
    const previousActiveLayer = paper.project.activeLayer;

    // 找到或创建网格图层
    let gridLayer = gridLayerRef.current;

    // 检查图层是否还有效（存在且未被删除）
    const isLayerValid = gridLayer && gridLayer.project === paper.project;

    if (!isLayerValid) {
      gridLayer = new paper.Layer();
      gridLayer.name = "grid";
      gridLayer.sendToBack();
      gridLayerRef.current = gridLayer;
    }

    // 确保gridLayer不为null
    if (!gridLayer) return;

    // 简化的清理方式 - 只处理线条网格和纯色背景
    const existingChildren = gridLayer.children;
    for (let i = existingChildren.length - 1; i >= 0; i--) {
      const child = existingChildren[i];
      if (child instanceof paper.Path && !child.data?.isAxis) {
        child.visible = false;
        
        // 只回收线条网格到对象池
        if (child.data?.type === 'grid' && pathPoolRef.current.length < 50) {
          pathPoolRef.current.push(child as paper.Path);
        } else {
          child.remove();
        }
      } else if (child.data?.isAxis) {
        // 保留坐标轴，只是隐藏
        child.visible = false;
      }
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
    
    // 根据缩放级别动态调整渲染范围
    const renderMultiplier = Math.max(1, Math.min(3, 1 / zoom)); // 缩放越小，渲染范围越大
    const effectivePadding = padding * renderMultiplier;
    
    const minX = Math.floor((viewBounds.left - effectivePadding) / currentGridSize) * currentGridSize;
    const maxX = Math.ceil((viewBounds.right + effectivePadding) / currentGridSize) * currentGridSize;
    const minY = Math.floor((viewBounds.top - effectivePadding) / currentGridSize) * currentGridSize;
    const maxY = Math.ceil((viewBounds.bottom + effectivePadding) / currentGridSize) * currentGridSize;
    
    // 虚拟化限制：防止渲染区域过大，但确保足够的覆盖
    const maxRenderWidth = viewWidth * 6; // 增加到6倍视口宽度
    const maxRenderHeight = viewHeight * 6; // 增加到6倍视口高度
    
    // 修复边界计算逻辑
    const actualMaxX = Math.min(maxX, minX + maxRenderWidth);
    const actualMaxY = Math.min(maxY, minY + maxRenderHeight);
    const actualMinX = Math.max(minX, minX); // 确保不会缩小最小边界
    const actualMinY = Math.max(minY, minY); // 确保不会缩小最小边界
    
    // 使用修正后的边界
    const finalMinX = actualMinX;
    const finalMaxX = actualMaxX;
    const finalMinY = actualMinY;
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

    // 创建网格（如果启用）- 暂时禁用点阵，只支持线条和纯色
    if (showGrid) {
      if (gridStyle === GridStyle.SOLID) {
        // 创建纯色背景，使用虚拟化边界
        createSolidBackground(finalMinX, finalMaxX, finalMinY, finalMaxY, gridLayer);
      } else if (gridStyle === GridStyle.DOTS) {
        // 创建点阵网格
        createDotGrid(currentGridSize, finalMinX, finalMaxX, finalMinY, finalMaxY, gridDotSize, gridLayer);
      } else {
        // 创建线条网格（默认）
        createLineGrid(currentGridSize, finalMinX, finalMaxX, finalMinY, finalMaxY, zoom, gridLayer);
      }
    }

    // 将网格层移到最底部
    gridLayer.sendToBack();

    // 恢复之前的活动图层
    if (previousActiveLayer && previousActiveLayer.name &&
      previousActiveLayer.name.startsWith('layer_')) {
      previousActiveLayer.activate();
    }
  }, [zoom, showGrid, showAxis, gridStyle]);

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
      } else {
        // 创建新路径
        line = new paper.Path.Line({
          from: [x, minY],
          to: [x, maxY],
          strokeColor: isMainGrid ? majorColor : minorColor,
          strokeWidth: isMainGrid ? 0.8 : 0.3,
          data: { isHelper: true, type: 'grid' }
        });
      }
      gridLayer.addChild(line);
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
      } else {
        // 创建新路径
        line = new paper.Path.Line({
          from: [minX, y],
          to: [maxX, y],
          strokeColor: isMainGrid ? majorColor : minorColor,
          strokeWidth: isMainGrid ? 0.8 : 0.3,
          data: { isHelper: true, type: 'grid' }
        });
      }
      gridLayer.addChild(line);
    }
  };

  // 点阵网格创建
  const createDotGrid = (currentGridSize: number, minX: number, maxX: number, minY: number, maxY: number, dotSize: number, gridLayer: paper.Layer) => {
    const fill = new paper.Color(0, 0, 0, 0.28); // 默认透明度
    try {
      const c = gridColor.replace('#','');
      const r = c.length === 6 ? parseInt(c.substring(0,2), 16) : 229;
      const g = c.length === 6 ? parseInt(c.substring(2,4), 16) : 231;
      const b = c.length === 6 ? parseInt(c.substring(4,6), 16) : 235;
      fill.red = r/255; fill.green = g/255; fill.blue = b/255;
    } catch {}

    const radius = Math.max(0.5, Math.min(4, dotSize));

    for (let x = minX; x <= maxX; x += currentGridSize) {
      for (let y = minY; y <= maxY; y += currentGridSize) {
        const dot = new paper.Path.Circle({ center: [x, y], radius, fillColor: fill, data: { isHelper: true, type: 'grid-dot' } });
        gridLayer.addChild(dot);
      }
    }
  };

  // 纯色背景创建函数 - 创建淡淡的灰色背景
  const createSolidBackground = (minX: number, maxX: number, minY: number, maxY: number, gridLayer: paper.Layer) => {
    // 添加 Paper.js 状态检查
    if (!paper.project || !paper.view) {
      console.warn('Paper.js not initialized yet');
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

  // 监听状态变化并渲染网格
  useEffect(() => {
    if (!isPaperInitialized || !canvasRef.current) return;
    if (showGrid || showAxis) {
      // 直接重绘，保持响应性
      createGrid(gridSize);
    }
  }, [isPaperInitialized, showGrid, showAxis, gridSize, gridStyle, zoom, isDragging]); // 添加isDragging依赖

  // 智能平移检测 - 只有在平移距离足够大时才重绘
  useEffect(() => {
    if (!isPaperInitialized || !canvasRef.current) return;
    
    // 计算平移距离
    const panDistance = Math.sqrt(
      Math.pow(panX - lastPanRef.current.x, 2) + 
      Math.pow(panY - lastPanRef.current.y, 2)
    );
    
    // 根据网格样式调整重绘阈值
    const redrawThreshold = gridStyle === GridStyle.DOTS ? gridSize / 4 : gridSize / 2;
    const shouldRedrawFromPan = panDistance > redrawThreshold;
    
    if (showGrid || showAxis) {
      // 针对点阵样式使用防抖，提升性能
      if (gridStyle === GridStyle.DOTS) {
        // 拖拽时不重绘，非拖拽时响应平移
        if (!isDragging && (shouldRedrawFromPan || panDistance === 0)) {
          const timeoutId = setTimeout(() => {
            createGrid(gridSize);
            lastPanRef.current = { x: panX, y: panY };
          }, shouldRedrawFromPan ? 150 : 0); // 平移时延迟，其他情况立即执行
          return () => clearTimeout(timeoutId);
        }
      } else {
        // 线条网格：平移时即时重绘，保持响应性
        if (shouldRedrawFromPan || panDistance === 0) {
          createGrid(gridSize);
          lastPanRef.current = { x: panX, y: panY };
        }
      }
    }
  }, [isPaperInitialized, showGrid, showAxis, gridSize, gridStyle, zoom, isDragging, panX, panY, createGrid]);

  // 专门处理拖拽结束后的点阵重绘
  useEffect(() => {
    if (!isPaperInitialized || !showGrid) return;
    
    // 当拖拽结束且是点阵模式时，立即重绘
    if (!isDragging && gridStyle === GridStyle.DOTS) {
      const timeoutId = setTimeout(() => {
        createGrid(gridSize);
        lastPanRef.current = { x: panX, y: panY };
      }, 50); // 较短的延迟，确保拖拽完全结束
      
      return () => clearTimeout(timeoutId);
    }
  }, [isDragging, isPaperInitialized, showGrid, gridStyle, gridSize, createGrid, panX, panY]);

  // 强制垃圾回收函数 - 用于内存压力过大时
  const forceMemoryCleanup = useCallback(() => {
    // 强制清空所有对象池
    pathPoolRef.current.forEach(path => path && path.remove && path.remove());
    pathPoolRef.current = [];

    // 标记内存清理完成
    memoryMonitor.markCleanup();
    
    // 开发模式下触发手动垃圾回收
    if (process.env.NODE_ENV === 'development') {
      memoryMonitor.forceCleanup();
    }

    console.log('强制内存清理已完成');
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
    };

    // 每30秒检查一次内存使用情况
    const intervalId = setInterval(checkMemoryPressure, 30000);
    
    return () => clearInterval(intervalId);
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

      // 最终清理内存监控
      memoryMonitor.markCleanup();
    };
  }, [forceMemoryCleanup]); // 添加forceMemoryCleanup依赖

  return null; // 这个组件不渲染任何DOM
};

export default GridRenderer;
