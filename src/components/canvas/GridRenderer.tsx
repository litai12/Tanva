import { useCallback, useEffect, useRef } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore, GridStyle } from '@/stores';

interface GridRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isPaperInitialized: boolean;
}

const GridRenderer: React.FC<GridRendererProps> = ({ canvasRef, isPaperInitialized }) => {
  const { gridSize, gridStyle, zoom, panX, panY } = useCanvasStore();
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

    // 优化的清理方式 - 回收路径到对象池而不是删除
    const existingPaths = gridLayer.children.slice(); // 复制数组避免修改过程中的问题
    existingPaths.forEach((child) => {
      if (child instanceof paper.Path && !child.data?.isAxis) {
        // 将网格对象回收到对应的对象池，但不要remove
        child.visible = false;
        child.remove(); // 从图层中移除，但不销毁对象
        
        if (child.data?.type === 'grid-dot' && child instanceof paper.Path.Circle) {
          // 根据点的类型回收到不同的对象池
          if (child.data?.isMainGrid) {
            if (dotPoolMainRef.current.length < 500) {
              dotPoolMainRef.current.push(child as paper.Path.Circle);
            }
          } else {
            if (dotPoolMinorRef.current.length < 2000) {
              dotPoolMinorRef.current.push(child as paper.Path.Circle);
            }
          }
        } else if (pathPoolRef.current.length < 100 && !(child instanceof paper.Path.Circle)) {
          // 回收线条到线条对象池 - 确保不是圆形对象
          pathPoolRef.current.push(child as paper.Path);
        }
      } else if (child.data?.isAxis) {
        // 保留坐标轴，只是隐藏
        child.visible = false;
      }
    });

    gridLayer.activate();

    // 如果网格和坐标轴都关闭，则不显示任何内容
    if (!showGrid && !showAxis) {
      return;
    }

    // 获取世界坐标系中的可视边界
    const viewBounds = paper.view.bounds;

    // 计算网格边界，扩展一点确保完全覆盖
    const padding = currentGridSize * 2;
    const minX = Math.floor((viewBounds.left - padding) / currentGridSize) * currentGridSize;
    const maxX = Math.ceil((viewBounds.right + padding) / currentGridSize) * currentGridSize;
    const minY = Math.floor((viewBounds.top - padding) / currentGridSize) * currentGridSize;
    const maxY = Math.ceil((viewBounds.bottom + padding) / currentGridSize) * currentGridSize;

    // 创建或更新坐标轴（如果启用）- 固定在Paper.js (0,0)点
    if (showAxis) {
      // Y轴（蓝色竖直线） - 复用现有轴或创建新的
      if (!axisPathsRef.current.yAxis || !axisPathsRef.current.yAxis.project) {
        axisPathsRef.current.yAxis = new paper.Path.Line({
          from: [0, viewBounds.top - padding],
          to: [0, viewBounds.bottom + padding],
          strokeColor: new paper.Color(0.2, 0.4, 0.8, 1.0), // 蓝色Y轴
          strokeWidth: 1.5,
          data: { isAxis: true, axis: 'Y', isHelper: true }
        });
        gridLayer.addChild(axisPathsRef.current.yAxis);
      } else {
        // 更新现有Y轴的位置
        axisPathsRef.current.yAxis.segments[0].point = new paper.Point(0, viewBounds.top - padding);
        axisPathsRef.current.yAxis.segments[1].point = new paper.Point(0, viewBounds.bottom + padding);
        axisPathsRef.current.yAxis.visible = true;
        if (axisPathsRef.current.yAxis.parent !== gridLayer) {
          gridLayer.addChild(axisPathsRef.current.yAxis);
        }
      }

      // X轴（红色水平线） - 复用现有轴或创建新的
      if (!axisPathsRef.current.xAxis || !axisPathsRef.current.xAxis.project) {
        axisPathsRef.current.xAxis = new paper.Path.Line({
          from: [viewBounds.left - padding, 0],
          to: [viewBounds.right + padding, 0],
          strokeColor: new paper.Color(0.8, 0.2, 0.2, 1.0), // 红色X轴
          strokeWidth: 1.5,
          data: { isAxis: true, axis: 'X', isHelper: true }
        });
        gridLayer.addChild(axisPathsRef.current.xAxis);
      } else {
        // 更新现有X轴的位置
        axisPathsRef.current.xAxis.segments[0].point = new paper.Point(viewBounds.left - padding, 0);
        axisPathsRef.current.xAxis.segments[1].point = new paper.Point(viewBounds.right + padding, 0);
        axisPathsRef.current.xAxis.visible = true;
        if (axisPathsRef.current.xAxis.parent !== gridLayer) {
          gridLayer.addChild(axisPathsRef.current.xAxis);
        }
      }
    }

    // 创建网格（如果启用）- 根据样式选择线条或点阵
    if (showGrid) {
      if (gridStyle === GridStyle.DOTS) {
        // 创建点阵网格
        createDotGrid(currentGridSize, minX, maxX, minY, maxY, zoom, gridLayer);
      } else {
        // 创建线条网格（默认） - 保持原有逻辑
      // 计算副网格显示阈值 - 当缩放小于30%时隐藏副网格
      const shouldShowMinorGrid = zoom >= 0.3;

      // 创建垂直网格线
      for (let x = minX; x <= maxX; x += currentGridSize) {
        // 跳过轴线位置（如果显示轴线）
        if (showAxis && x === 0) continue;

        // 计算是否为主网格线（每5条线）
        const gridIndex = Math.round(x / currentGridSize);
        const isMainGrid = gridIndex % 5 === 0;

        // 如果是副网格且缩放过小，则跳过
        if (!isMainGrid && !shouldShowMinorGrid) continue;

        // 从对象池获取路径或创建新的
        let line = pathPoolRef.current.pop();
        if (line && !(line instanceof paper.Path.Circle)) {
          // 复用现有路径 - 确保正确重置
          line.segments[0].point = new paper.Point(x, minY);
          line.segments[1].point = new paper.Point(x, maxY);
          line.strokeColor = new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15);
          line.strokeWidth = isMainGrid ? 0.8 : 0.3;
          line.visible = true;
          line.data = { isHelper: true, type: 'grid' }; // 重置data
        } else {
          // 如果取出的是圆形对象，放回对象池
          if (line instanceof paper.Path.Circle) {
            pathPoolRef.current.push(line);
          }
          // 创建新路径
          line = new paper.Path.Line({
            from: [x, minY],
            to: [x, maxY],
            strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
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

        // 从对象池获取路径或创建新的
        let line = pathPoolRef.current.pop();
        if (line && !(line instanceof paper.Path.Circle)) {
          // 复用现有路径 - 确保正确重置
          line.segments[0].point = new paper.Point(minX, y);
          line.segments[1].point = new paper.Point(maxX, y);
          line.strokeColor = new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15);
          line.strokeWidth = isMainGrid ? 0.8 : 0.3;
          line.visible = true;
          line.data = { isHelper: true, type: 'grid' }; // 重置data
        } else {
          // 如果取出的是圆形对象，放回对象池
          if (line instanceof paper.Path.Circle) {
            pathPoolRef.current.push(line);
          }
          // 创建新路径
          line = new paper.Path.Line({
            from: [minX, y],
            to: [maxX, y],
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

  // 优化后的点阵网格创建函数 - 大幅提升性能
  const createDotGrid = (currentGridSize: number, minX: number, maxX: number, minY: number, maxY: number, zoom: number, gridLayer: paper.Layer) => {
    // 计算副网格显示阈值 - 当缩放小于30%时隐藏副网格
    const shouldShowMinorGrid = zoom >= 0.3;

    // 性能优化：限制最大网格数量，避免创建过多对象
    const maxDotsPerAxis = Math.max(100, Math.min(500, Math.ceil(1000 / zoom)));
    const actualGridSize = Math.max(currentGridSize, (maxX - minX) / maxDotsPerAxis);

    // 预计算常用值
    const mainGridOpacity = 0.4;
    const minorGridOpacity = 0.3;
    const mainDotRadius = 1.2;
    const minorDotRadius = 0.8;

    // 创建点阵网格 - 优化的双循环
    for (let x = minX; x <= maxX; x += actualGridSize) {
      for (let y = minY; y <= maxY; y += actualGridSize) {
        // 跳过轴线位置（如果显示轴线）
        if ((showAxis && Math.abs(x) < actualGridSize/2) || (showAxis && Math.abs(y) < actualGridSize/2)) continue;

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
          // 复用现有圆点 - 避免缩放操作，直接设置属性
          dot.position = new paper.Point(x, y);
          dot.fillColor = new paper.Color(0, 0, 0, isMainGrid ? mainGridOpacity : minorGridOpacity);
          dot.visible = true;
          
          // 只在半径不匹配时才调整大小
          const expectedRadius = isMainGrid ? mainDotRadius : minorDotRadius;
          const currentRadius = dot.bounds.width / 2;
          if (Math.abs(currentRadius - expectedRadius) > 0.1) {
            const scaleFactor = expectedRadius / currentRadius;
            dot.scale(scaleFactor);
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
        const timeoutId = setTimeout(() => createGrid(gridSize), 32); // 点阵使用较长防抖
        return () => clearTimeout(timeoutId);
      } else {
        // 线条网格直接重绘，保持触控板响应性
        createGrid(gridSize);
      }
    }
  }, [isPaperInitialized, showGrid, showAxis, gridSize, gridStyle, zoom, panX, panY]);

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
    };
  }, []); // 空依赖数组确保只在组件卸载时执行

  return null; // 这个组件不渲染任何DOM
};

export default GridRenderer;