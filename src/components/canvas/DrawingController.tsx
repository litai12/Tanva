import React, { useEffect, useRef, useCallback } from 'react';
import paper from 'paper';
import { useToolStore, useCanvasStore } from '@/stores';

interface DrawingControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const DrawingController: React.FC<DrawingControllerProps> = ({ canvasRef }) => {
  const { drawMode, currentColor, strokeWidth, isEraser } = useToolStore();
  const { zoom } = useCanvasStore();
  const pathRef = useRef<paper.Path | null>(null);
  const isDrawingRef = useRef(false);
  const drawingLayerRef = useRef<paper.Layer | null>(null);

  // 确保绘图图层存在并激活
  const ensureDrawingLayer = useCallback(() => {
    let drawingLayer = drawingLayerRef.current;
    
    // 如果图层不存在或已被删除，创建新的绘图图层
    if (!drawingLayer || (drawingLayer as any).isDeleted) {
      drawingLayer = new paper.Layer();
      drawingLayer.name = "drawing";
      drawingLayerRef.current = drawingLayer;
      
      // 确保绘图图层在网格图层之上
      const gridLayer = paper.project.layers.find(layer => layer.name === "grid");
      if (gridLayer) {
        drawingLayer.insertAbove(gridLayer);
      }
    }
    
    // 激活绘图图层
    drawingLayer.activate();
    return drawingLayer;
  }, []);

  // 开始自由绘制
  const startFreeDraw = useCallback((point: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    pathRef.current = new paper.Path();
    
    if (isEraser) {
      // 橡皮擦模式：红色虚线表示擦除轨迹
      pathRef.current.strokeColor = new paper.Color('#ff6b6b');
      pathRef.current.strokeWidth = strokeWidth * 1.5; // 稍微粗一点
      pathRef.current.dashArray = [5, 5]; // 虚线效果
      pathRef.current.opacity = 0.7;
    } else {
      // 普通绘制模式
      pathRef.current.strokeColor = new paper.Color(currentColor);
      pathRef.current.strokeWidth = strokeWidth;
    }
    
    pathRef.current.strokeCap = 'round';
    pathRef.current.strokeJoin = 'round';
    pathRef.current.add(point);
  }, [ensureDrawingLayer, currentColor, strokeWidth, isEraser]);

  // 继续自由绘制
  const continueFreeDraw = useCallback((point: paper.Point) => {
    if (pathRef.current) {
      // 优化：只有当新点与最后一个点距离足够远时才添加
      const lastSegment = pathRef.current.lastSegment;
      if (lastSegment) {
        const distance = lastSegment.point.getDistance(point);
        // 距离阈值：避免添加过于接近的点
        const minDistance = Math.max(1, strokeWidth * 0.5);
        if (distance < minDistance) {
          return; // 跳过过于接近的点
        }
      }
      
      pathRef.current.add(point);
      // 移除实时平滑，避免端头残缺
      // pathRef.current.smooth();
    }
  }, [strokeWidth]);

  // 开始绘制矩形
  const startRectDraw = useCallback((point: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    // 创建一个最小的矩形，使用 Rectangle 构造函数
    const rectangle = new paper.Rectangle(point, point.add(new paper.Point(1, 1)));
    pathRef.current = new paper.Path.Rectangle(rectangle);
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;
    pathRef.current.fillColor = null; // 确保不填充
    
    // 保存起始点用于后续更新
    (pathRef.current as any).startPoint = point;
  }, [ensureDrawingLayer, currentColor, strokeWidth]);

  // 更新矩形绘制
  const updateRectDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      const rectangle = new paper.Rectangle(startPoint, point);
      
      // 移除旧的矩形并创建新的
      pathRef.current.remove();
      pathRef.current = new paper.Path.Rectangle(rectangle);
      pathRef.current.strokeColor = new paper.Color(currentColor);
      pathRef.current.strokeWidth = strokeWidth;
      pathRef.current.fillColor = null;
      
      // 保持起始点引用
      (pathRef.current as any).startPoint = startPoint;
    }
  }, [currentColor, strokeWidth]);

  // 开始绘制圆形
  const startCircleDraw = useCallback((point: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    pathRef.current = new paper.Path.Circle({
      center: point,
      radius: 1,
    });
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;
    pathRef.current.fillColor = null; // 确保不填充
    
    // 保存起始点用于后续更新
    (pathRef.current as any).startPoint = point;
  }, [ensureDrawingLayer, currentColor, strokeWidth]);

  // 更新圆形绘制
  const updateCircleDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      const radius = startPoint.getDistance(point);
      
      // 移除旧的圆形并创建新的
      pathRef.current.remove();
      pathRef.current = new paper.Path.Circle({
        center: startPoint,
        radius: radius,
      });
      pathRef.current.strokeColor = new paper.Color(currentColor);
      pathRef.current.strokeWidth = strokeWidth;
      pathRef.current.fillColor = null;
      
      // 保持起始点引用
      (pathRef.current as any).startPoint = startPoint;
    }
  }, [currentColor, strokeWidth]);

  // 橡皮擦功能 - 删除与橡皮擦路径相交的绘图内容
  const performErase = useCallback((eraserPath: paper.Path) => {
    const drawingLayer = drawingLayerRef.current;
    if (!drawingLayer) return;

    // 获取橡皮擦路径的边界
    const eraserBounds = eraserPath.bounds;
    const tolerance = strokeWidth + 5; // 橡皮擦容差

    // 遍历绘图图层中的所有路径
    const itemsToRemove: paper.Item[] = [];
    drawingLayer.children.forEach((item) => {
      if (item instanceof paper.Path && item !== eraserPath) {
        // 检查路径是否与橡皮擦区域相交
        if (item.bounds.intersects(eraserBounds)) {
          // 更精确的相交检测
          const intersections = item.getIntersections(eraserPath);
          if (intersections.length > 0) {
            itemsToRemove.push(item);
          } else {
            // 检查路径上的点是否在橡皮擦容差范围内
            for (const segment of item.segments) {
              const distance = eraserPath.getNearestLocation(segment.point)?.distance || Infinity;
              if (distance < tolerance) {
                itemsToRemove.push(item);
                break;
              }
            }
          }
        }
      }
    });

    // 删除相交的路径
    itemsToRemove.forEach(item => item.remove());
    
    console.log(`🧹 橡皮擦删除了 ${itemsToRemove.length} 个路径`);
  }, [strokeWidth]);

  // 完成绘制
  const finishDraw = useCallback(() => {
    if (pathRef.current) {
      // 如果是橡皮擦模式，执行擦除操作然后删除橡皮擦路径
      if (isEraser) {
        performErase(pathRef.current);
        pathRef.current.remove(); // 删除橡皮擦路径本身
      } else {
        // 普通绘制模式：在绘制完成时进行一次平滑处理
        if (drawMode === 'free' && pathRef.current.segments && pathRef.current.segments.length > 2) {
          pathRef.current.smooth({ type: 'geometric', factor: 0.4 });
        }
      }
      
      // 清理临时引用
      delete (pathRef.current as any).startPoint;
      
      console.log(`✅ 绘制完成: ${isEraser ? '橡皮擦操作' : '普通绘制'}`);
      pathRef.current = null;
    }
  }, [isEraser, performErase, drawMode]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;

    // 鼠标按下事件处理
    const handleMouseDown = (event: MouseEvent) => {
      // 只在绘图模式下响应左键点击
      if (event.button !== 0 || drawMode === 'select') return;

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      // 转换为 Paper.js 坐标系 - 使用 paper.view.viewToProject 进行正确的坐标转换
      const point = paper.view.viewToProject(new paper.Point(x, y));

      console.log(`🎨 开始绘制: 模式=${drawMode}, 坐标=(${x.toFixed(1)}, ${y.toFixed(1)})`);

      if (drawMode === 'free') {
        // 开始自由绘制
        startFreeDraw(point);
      } else if (drawMode === 'rect') {
        // 开始绘制矩形
        startRectDraw(point);
      } else if (drawMode === 'circle') {
        // 开始绘制圆形
        startCircleDraw(point);
      }

      isDrawingRef.current = true;
    };

    // 鼠标移动事件处理
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDrawingRef.current || !pathRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const point = paper.view.viewToProject(new paper.Point(x, y));

      if (drawMode === 'free') {
        // 继续自由绘制
        continueFreeDraw(point);
      } else if (drawMode === 'rect') {
        // 更新矩形
        updateRectDraw(point);
      } else if (drawMode === 'circle') {
        // 更新圆形
        updateCircleDraw(point);
      }
    };

    // 鼠标抬起事件处理
    const handleMouseUp = () => {
      if (isDrawingRef.current) {
        console.log(`🎨 结束绘制: 模式=${drawMode}`);
        finishDraw();
      }
      isDrawingRef.current = false;
    };

    // 绑定事件监听器
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp); // 鼠标离开也结束绘制

    return () => {
      // 清理事件监听器
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [canvasRef, drawMode, currentColor, strokeWidth, isEraser, zoom, startFreeDraw, continueFreeDraw, startRectDraw, updateRectDraw, startCircleDraw, updateCircleDraw, finishDraw]);

  // 这个组件不渲染任何内容，只是处理绘图逻辑
  return null;
};

export default DrawingController;