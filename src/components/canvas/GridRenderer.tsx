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

    // 创建网格（如果启用）- 暂时禁用点阵，只支持线条和纯色
    if (showGrid) {
      if (gridStyle === GridStyle.SOLID) {
        // 创建纯色背景
        createSolidBackground(minX, maxX, minY, maxY, gridLayer);
      } else if (gridStyle === GridStyle.DOTS) {
        // 点阵暂时禁用，回退到线条网格
        console.warn('点阵模式已暂时禁用，回退到线条网格');
        // 创建线条网格（回退）
        createLineGrid(currentGridSize, minX, maxX, minY, maxY, zoom, gridLayer);
      } else {
        // 创建线条网格（默认）
        createLineGrid(currentGridSize, minX, maxX, minY, maxY, zoom, gridLayer);
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
  const createLineGrid = (currentGridSize: number, minX: number, maxX: number, minY: number, maxY: number, zoom: number, gridLayer: paper.Layer) => {
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

      // 从对象池获取路径或创建新的 - 垂直线
      let line: paper.Path;
      const poolItem = pathPoolRef.current.pop();

      if (poolItem && poolItem.segments && poolItem.segments.length === 2) {
        // 复用现有路径
        line = poolItem;
        line.segments[0].point = new paper.Point(x, minY);
        line.segments[1].point = new paper.Point(x, maxY);
        line.strokeColor = new paper.Color(0, 0, 0, isMainGrid ? 0.13 : 0.10);
        line.strokeWidth = isMainGrid ? 0.8 : 0.3;
        line.visible = true;
      } else {
        // 创建新路径
        line = new paper.Path.Line({
          from: [x, minY],
          to: [x, maxY],
          strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.13 : 0.10),
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
        line.strokeColor = new paper.Color(0, 0, 0, isMainGrid ? 0.13 : 0.10);
        line.strokeWidth = isMainGrid ? 0.8 : 0.3;
        line.visible = true;
      } else {
        // 创建新路径
        line = new paper.Path.Line({
          from: [minX, y],
          to: [maxX, y],
          strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.13 : 0.10),
          strokeWidth: isMainGrid ? 0.8 : 0.3,
          data: { isHelper: true, type: 'grid' }
        });
      }
      gridLayer.addChild(line);
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
    const backgroundRect = new paper.Path.Rectangle({
      from: [minX, minY],
      to: [maxX, maxY],
      fillColor: new paper.Color(0.95, 0.95, 0.95, 1.0), // 淡淡的灰色背景
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