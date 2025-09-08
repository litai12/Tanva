import { useCallback, useEffect, useRef } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore, GridStyle } from '@/stores';
import { memoryMonitor } from '@/utils/memoryMonitor';

interface GridRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isPaperInitialized: boolean;
}

const GridRenderer: React.FC<GridRendererProps> = ({ canvasRef, isPaperInitialized }) => {
  const { gridSize, gridStyle, zoom, isDragging } = useCanvasStore();
  const { showGrid, showAxis } = useUIStore();
  const gridLayerRef = useRef<paper.Layer | null>(null);

  // Paper.js对象池 - 减少频繁创建/删除的性能损耗
  const pathPoolRef = useRef<paper.Path[]>([]);
  const dotPoolRef = useRef<paper.Path.Circle[]>([]); // 点阵对象池（增加容量）
  const dotPoolMainRef = useRef<paper.Path.Circle[]>([]); // 主网格点对象池
  const dotPoolMinorRef = useRef<paper.Path.Circle[]>([]); // 副网格点对象池
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

    // 优化的清理方式 - 高效回收路径到对象池
    const existingPaths = gridLayer.children.slice(); // 复制数组避免修改过程中的问题
    
    // 批量处理，减少循环开销
    const itemsToRecycle: {
      solidBg: paper.Path[],
      mainDots: paper.Path.Circle[],
      minorDots: paper.Path.Circle[],
      gridLines: paper.Path[]
    } = { solidBg: [], mainDots: [], minorDots: [], gridLines: [] };

    existingPaths.forEach((child) => {
      if (child instanceof paper.Path && !child.data?.isAxis) {
        child.visible = false;
        child.remove(); // 从图层中移除

        // 按类型分类待回收对象
        if (child.data?.type === 'solid-background') {
          itemsToRecycle.solidBg.push(child);
        } else if (child.data?.type === 'grid-dot' && child instanceof paper.Path.Circle) {
          if (child.data?.isMainGrid) {
            itemsToRecycle.mainDots.push(child as paper.Path.Circle);
          } else {
            itemsToRecycle.minorDots.push(child as paper.Path.Circle);
          }
        } else if (child.data?.type === 'grid' && !(child instanceof paper.Path.Circle)) {
          itemsToRecycle.gridLines.push(child as paper.Path);
        }
      } else if (child.data?.isAxis) {
        // 保留坐标轴，只是隐藏
        child.visible = false;
      }
    });

    // 批量回收到对象池，避免频繁的数组操作
    // 纯色背景直接销毁，不回收
    itemsToRecycle.solidBg.forEach(item => item.remove());
    
    // 回收主网格点（大幅减小池大小，防止内存积累）
    const mainDotsToAdd = itemsToRecycle.mainDots.slice(0, Math.max(0, 200 - dotPoolMainRef.current.length));
    dotPoolMainRef.current.push(...mainDotsToAdd);
    // 超出限制的对象直接销毁
    itemsToRecycle.mainDots.slice(mainDotsToAdd.length).forEach(dot => dot.remove());
    
    // 回收副网格点（大幅减小池大小）
    const minorDotsToAdd = itemsToRecycle.minorDots.slice(0, Math.max(0, 500 - dotPoolMinorRef.current.length));
    dotPoolMinorRef.current.push(...minorDotsToAdd);
    // 超出限制的对象直接销毁
    itemsToRecycle.minorDots.slice(minorDotsToAdd.length).forEach(dot => dot.remove());
    
    // 回收网格线（减小池大小）
    const gridLinesToAdd = itemsToRecycle.gridLines.slice(0, Math.max(0, 50 - pathPoolRef.current.length));
    pathPoolRef.current.push(...gridLinesToAdd);
    // 超出限制的对象直接销毁
    itemsToRecycle.gridLines.slice(gridLinesToAdd.length).forEach(line => line.remove());

    // 更新内存监控统计
    memoryMonitor.updatePoolStats(
      dotPoolMainRef.current.length,
      dotPoolMinorRef.current.length, 
      pathPoolRef.current.length
    );

    // 检查内存警告
    if (memoryMonitor.checkMemoryWarning()) {
      console.warn('内存警告检测:', memoryMonitor.getMemorySummary());
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
    
    // 虚拟化限制：防止渲染区域过大
    const maxRenderWidth = viewWidth * 4; // 最多渲染4倍视口宽度
    const maxRenderHeight = viewHeight * 4; // 最多渲染4倍视口高度
    
    const actualMaxX = Math.min(maxX, minX + maxRenderWidth);
    const actualMaxY = Math.min(maxY, minY + maxRenderHeight);
    const actualMinX = Math.max(minX, maxX - maxRenderWidth);
    const actualMinY = Math.max(minY, maxY - maxRenderHeight);
    
    // 使用实际限制后的边界
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

    // 创建网格（如果启用）- 根据样式选择线条、点阵或纯色，使用虚拟化边界
    if (showGrid) {
      if (gridStyle === GridStyle.SOLID) {
        // 创建纯色背景，使用虚拟化边界
        createSolidBackground(finalMinX, finalMaxX, finalMinY, finalMaxY, gridLayer);
      } else if (gridStyle === GridStyle.DOTS) {
        // 创建点阵网格，使用虚拟化边界
        createDotGrid(currentGridSize, finalMinX, finalMaxX, finalMinY, finalMaxY, zoom, gridLayer);
      } else {
        // 创建线条网格（默认） - 保持原有逻辑，使用虚拟化边界
        // 计算副网格显示阈值 - 当缩放小于30%时隐藏副网格
        const shouldShowMinorGrid = zoom >= 0.3;

        // 创建垂直网格线，使用虚拟化边界
        for (let x = finalMinX; x <= finalMaxX; x += currentGridSize) {
          // 跳过轴线位置（如果显示轴线）
          if (showAxis && x === 0) continue;

          // 计算是否为主网格线（每5条线）
          const gridIndex = Math.round(x / currentGridSize);
          const isMainGrid = gridIndex % 5 === 0;

          // 如果是副网格且缩放过小，则跳过
          if (!isMainGrid && !shouldShowMinorGrid) continue;

          // 高效获取线条对象 - 优化对象池操作
          let line: paper.Path;
          const poolItem = pathPoolRef.current.pop();

          if (poolItem && !(poolItem instanceof paper.Path.Circle)) {
            // 复用现有路径 - 批量更新属性，使用虚拟化边界
            line = poolItem;
            const segments = line.segments;
            segments[0].point.set(x, finalMinY);
            segments[1].point.set(x, finalMaxY);
            
            // 只在需要时更新颜色和宽度
            const targetOpacity = isMainGrid ? 0.18 : 0.15;
            const targetWidth = isMainGrid ? 0.8 : 0.3;
            if (line.strokeColor?.alpha !== targetOpacity || line.strokeWidth !== targetWidth) {
              line.strokeColor = new paper.Color(0, 0, 0, targetOpacity);
              line.strokeWidth = targetWidth;
            }
            
            line.visible = true;
            line.data = { isHelper: true, type: 'grid' }; // 重置data
          } else {
            // 圆形对象放回对应池 - 避免类型混乱，使用新的池大小限制
            if (poolItem instanceof paper.Path.Circle) {
              const targetPool = poolItem.data?.isMainGrid ? dotPoolMainRef.current : dotPoolMinorRef.current;
              const maxSize = poolItem.data?.isMainGrid ? 200 : 500;
              if (targetPool.length < maxSize) {
                targetPool.push(poolItem);
              } else {
                // 超出限制直接销毁
                poolItem.remove();
              }
            }
            
            // 创建新路径，使用虚拟化边界
            line = new paper.Path.Line({
              from: [x, finalMinY],
              to: [x, finalMaxY],
              strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
              strokeWidth: isMainGrid ? 0.8 : 0.3,
              data: { isHelper: true, type: 'grid' }
            });
          }
          gridLayer.addChild(line);
        }

        // 创建水平网格线，使用虚拟化边界
        for (let y = finalMinY; y <= finalMaxY; y += currentGridSize) {
          // 跳过轴线位置（如果显示轴线）
          if (showAxis && y === 0) continue;

          // 计算是否为主网格线（每5条线）
          const gridIndex = Math.round(y / currentGridSize);
          const isMainGrid = gridIndex % 5 === 0;

          // 如果是副网格且缩放过小，则跳过
          if (!isMainGrid && !shouldShowMinorGrid) continue;

          // 高效获取线条对象 - 水平线优化
          let line: paper.Path;
          const poolItem = pathPoolRef.current.pop();

          if (poolItem && !(poolItem instanceof paper.Path.Circle)) {
            // 复用现有路径 - 批量更新属性，使用虚拟化边界
            line = poolItem;
            const segments = line.segments;
            segments[0].point.set(finalMinX, y);
            segments[1].point.set(finalMaxX, y);
            
            // 只在需要时更新颜色和宽度
            const targetOpacity = isMainGrid ? 0.18 : 0.15;
            const targetWidth = isMainGrid ? 0.8 : 0.3;
            if (line.strokeColor?.alpha !== targetOpacity || line.strokeWidth !== targetWidth) {
              line.strokeColor = new paper.Color(0, 0, 0, targetOpacity);
              line.strokeWidth = targetWidth;
            }
            
            line.visible = true;
            line.data = { isHelper: true, type: 'grid' }; // 重置data
          } else {
            // 圆形对象放回对应池 - 避免类型混乱，使用新的池大小限制
            if (poolItem instanceof paper.Path.Circle) {
              const targetPool = poolItem.data?.isMainGrid ? dotPoolMainRef.current : dotPoolMinorRef.current;
              const maxSize = poolItem.data?.isMainGrid ? 200 : 500;
              if (targetPool.length < maxSize) {
                targetPool.push(poolItem);
              } else {
                // 超出限制直接销毁
                poolItem.remove();
              }
            }
            
            // 创建新路径，使用虚拟化边界
            line = new paper.Path.Line({
              from: [finalMinX, y],
              to: [finalMaxX, y],
              strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
              strokeWidth: isMainGrid ? 0.8 : 0.3,
              data: { isHelper: true, type: 'grid' }
            });
          }
          gridLayer.addChild(line);
        }
      } // 关闭else块
    } // 关闭showGrid的if块

    // 将网格层移到最底部
    gridLayer.sendToBack();

    // 恢复之前的活动图层
    if (previousActiveLayer && previousActiveLayer.name &&
      previousActiveLayer.name.startsWith('layer_')) {
      previousActiveLayer.activate();
    }
  }, [zoom, showGrid, showAxis, gridStyle]);

  // 纯色背景创建函数 - 创建淡淡的灰色背景
  const createSolidBackground = (minX: number, maxX: number, minY: number, maxY: number, gridLayer: paper.Layer) => {
    // 添加 Paper.js 状态检查
    if (!paper.project || !paper.view) {
      console.warn('Paper.js not initialized yet');
      return;
    }

    // 创建一个覆盖整个可视区域的纯色矩形
    const backgroundRect = new paper.Path.Rectangle({
      from: [minX, minY],
      to: [maxX, maxY],
      fillColor: new paper.Color(0.95, 0.95, 0.95, 1.0), // 淡淡的灰色背景
      data: { isHelper: true, type: 'solid-background' }
    });

    gridLayer.addChild(backgroundRect);
  };

  // 优化后的点阵网格创建函数 - 大幅提升性能
  const createDotGrid = (currentGridSize: number, minX: number, maxX: number, minY: number, maxY: number, zoom: number, gridLayer: paper.Layer) => {
    // 计算副网格显示阈值 - 当缩放小于50%时隐藏副网格，进一步减少点数
    const shouldShowMinorGrid = zoom >= 0.5;

    // 性能优化：大幅限制最大网格数量，避免创建过多对象
    const maxDotsPerAxis = Math.max(50, Math.min(200, Math.ceil(600 / zoom))); // 从500降至200，从1000降至600
    const actualGridSize = Math.max(currentGridSize, (maxX - minX) / maxDotsPerAxis);

    // 预计算常用值 - 降低透明度
    const mainGridOpacity = 0.25;  // 从0.4降低到0.25
    const minorGridOpacity = 0.15; // 从0.3降低到0.15
    const mainDotRadius = 1.2;
    const minorDotRadius = 0.8;

    // 创建点阵网格 - 优化的双循环
    for (let x = minX; x <= maxX; x += actualGridSize) {
      for (let y = minY; y <= maxY; y += actualGridSize) {
        // 跳过轴线位置（如果显示轴线）
        if ((showAxis && Math.abs(x) < actualGridSize / 2) || (showAxis && Math.abs(y) < actualGridSize / 2)) continue;

        // 计算是否为主网格点（每5个点）- 优化计算
        const xIndex = Math.round(x / actualGridSize);
        const yIndex = Math.round(y / actualGridSize);
        const isMainGrid = (xIndex % 5 === 0) && (yIndex % 5 === 0);

        // 如果是副网格且缩放过小，则跳过
        if (!isMainGrid && !shouldShowMinorGrid) continue;

        // 从对应的对象池获取圆点
        const dotPool = isMainGrid ? dotPoolMainRef.current : dotPoolMinorRef.current;
        let dot = dotPool.pop();

        if (dot) {
          // 复用现有圆点 - 批量更新属性
          dot.position.set(x, y);
          
          // 只在颜色不匹配时更新填充色
          const expectedOpacity = isMainGrid ? mainGridOpacity : minorGridOpacity;
          if (!dot.fillColor || dot.fillColor.alpha !== expectedOpacity) {
            dot.fillColor = new paper.Color(0, 0, 0, expectedOpacity);
          }
          
          dot.visible = true;

          // 优化尺寸检查 - 减少bounds计算
          const expectedRadius = isMainGrid ? mainDotRadius : minorDotRadius;
          const currentRadius = dot.bounds.width * 0.5;
          if (Math.abs(currentRadius - expectedRadius) > 0.15) {
            // 直接设置新半径，避免缩放计算
            const center = dot.position.clone();
            dot.remove();
            dot = new paper.Path.Circle({
              center: center,
              radius: expectedRadius,
              fillColor: new paper.Color(0, 0, 0, expectedOpacity),
              data: {
                isHelper: true,
                type: 'grid-dot',
                isMainGrid: isMainGrid
              }
            });
          }
        } else {
          // 创建新圆点 - 减少data对象的属性
          dot = new paper.Path.Circle({
            center: [x, y],
            radius: isMainGrid ? mainDotRadius : minorDotRadius,
            fillColor: new paper.Color(0, 0, 0, isMainGrid ? mainGridOpacity : minorGridOpacity),
            data: {
              isHelper: true,
              type: 'grid-dot',
              isMainGrid: isMainGrid
            }
          });
        }
        gridLayer.addChild(dot);
      }
    }
  };

  // 直接监听状态变化，避免依赖链
  useEffect(() => {
    if (!isPaperInitialized || !canvasRef.current) return;
    if (showGrid || showAxis) {
      // 针对点阵样式使用防抖，提升性能
      if (gridStyle === GridStyle.DOTS) {
        // 如果结束拖拽，立即重绘点阵；否则使用防抖
        if (!isDragging) {
          const timeoutId = setTimeout(() => createGrid(gridSize), 100); // 增加防抖延迟，从32ms增至100ms
          return () => clearTimeout(timeoutId);
        }
      } else {
        // 线条网格直接重绘，保持触控板响应性
        createGrid(gridSize);
      }
    }
  }, [isPaperInitialized, showGrid, showAxis, gridSize, gridStyle, zoom, isDragging]); // 添加isDragging依赖

  // 强制垃圾回收函数 - 用于内存压力过大时
  const forceMemoryCleanup = useCallback(() => {
    // 强制清空所有对象池
    pathPoolRef.current.forEach(path => path && path.remove && path.remove());
    pathPoolRef.current = [];

    dotPoolRef.current.forEach(dot => dot && dot.remove && dot.remove());
    dotPoolRef.current = [];

    dotPoolMainRef.current.forEach(dot => dot && dot.remove && dot.remove());
    dotPoolMainRef.current = [];

    dotPoolMinorRef.current.forEach(dot => dot && dot.remove && dot.remove());
    dotPoolMinorRef.current = [];

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
      const totalPoolSize = stats.activePoolSize.mainDots + 
                           stats.activePoolSize.minorDots + 
                           stats.activePoolSize.gridLines;
      
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

      // 清理点阵对象池
      dotPoolRef.current.forEach(dot => {
        if (dot && dot.remove) {
          dot.remove();
        }
      });
      dotPoolRef.current = [];

      // 清理主网格点对象池
      dotPoolMainRef.current.forEach(dot => {
        if (dot && dot.remove) {
          dot.remove();
        }
      });
      dotPoolMainRef.current = [];

      // 清理副网格点对象池
      dotPoolMinorRef.current.forEach(dot => {
        if (dot && dot.remove) {
          dot.remove();
        }
      });
      dotPoolMinorRef.current = [];

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