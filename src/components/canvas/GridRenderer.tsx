import { useEffect, useRef } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore } from '@/stores';

interface GridRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isPaperInitialized: boolean;
}

const GridRenderer: React.FC<GridRendererProps> = ({ canvasRef, isPaperInitialized }) => {
  const { gridSize, zoom, panX, panY } = useCanvasStore();
  const { showGrid, showAxis } = useUIStore();
  const gridLayerRef = useRef<paper.Layer | null>(null);

  // 直接监听状态变化并重绘网格
  useEffect(() => {
    if (!isPaperInitialized || !canvasRef.current) return;
    
    // 专业版网格系统 - 支持视口裁剪的无限网格，固定间距
    const createGrid = (baseGridSize: number = 20) => {
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

      // 清空现有网格
      gridLayer.removeChildren();
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

      // 创建坐标轴（如果启用）- 固定在Paper.js (0,0)点
      if (showAxis) {
        // Y轴（蓝色竖直线）
        const yAxisLine = new paper.Path.Line({
          from: [0, viewBounds.top - padding],
          to: [0, viewBounds.bottom + padding],
          strokeColor: new paper.Color(0.2, 0.4, 0.8, 1.0), // 蓝色Y轴
          strokeWidth: 1.5,
          data: { isAxis: true, axis: 'Y' }
        });
        gridLayer.addChild(yAxisLine);

        // X轴（红色水平线）
        const xAxisLine = new paper.Path.Line({
          from: [viewBounds.left - padding, 0],
          to: [viewBounds.right + padding, 0],
          strokeColor: new paper.Color(0.8, 0.2, 0.2, 1.0), // 红色X轴
          strokeWidth: 1.5,
          data: { isAxis: true, axis: 'X' }
        });
        gridLayer.addChild(xAxisLine);
      }

      // 创建网格线（如果启用）- 只绘制可视区域内的网格线
      if (showGrid) {
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

          const line = new paper.Path.Line({
            from: [x, minY],
            to: [x, maxY],
            strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
            strokeWidth: isMainGrid ? 0.8 : 0.3
          });
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

          const line = new paper.Path.Line({
            from: [minX, y],
            to: [maxX, y],
            strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
            strokeWidth: isMainGrid ? 0.8 : 0.3
          });
          gridLayer.addChild(line);
        }
      }

      // 将网格层移到最底部
      gridLayer.sendToBack();

      // 恢复之前的活动图层
      if (previousActiveLayer && previousActiveLayer.name &&
          previousActiveLayer.name.startsWith('layer_')) {
        previousActiveLayer.activate();
      }
    };

    if (showGrid || showAxis) {
      // 暂时关闭防抖，直接重绘提升触控板响应性
      createGrid(gridSize);
      // TODO: 如需要可重新启用防抖机制
      // const timeoutId = setTimeout(() => createGrid(gridSize), 16);
      // return () => clearTimeout(timeoutId);
    }
  }, [isPaperInitialized, showGrid, showAxis, gridSize, panX, panY, zoom, canvasRef]);

  // 清理函数
  useEffect(() => {
    return () => {
      // 清理我们创建的网格图层
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