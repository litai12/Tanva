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

  // 开始自由绘制
  const startFreeDraw = useCallback((point: paper.Point) => {
    pathRef.current = new paper.Path();
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;
    pathRef.current.strokeCap = 'round';
    pathRef.current.strokeJoin = 'round';
    pathRef.current.add(point);
  }, [currentColor, strokeWidth]);

  // 继续自由绘制
  const continueFreeDraw = useCallback((point: paper.Point) => {
    if (pathRef.current) {
      pathRef.current.add(point);
      pathRef.current.smooth();
    }
  }, []);

  // 开始绘制矩形
  const startRectDraw = useCallback((point: paper.Point) => {
    pathRef.current = new paper.Path.Rectangle({
      from: point,
      to: point,
      strokeColor: new paper.Color(currentColor),
      strokeWidth: strokeWidth,
    });
  }, [currentColor, strokeWidth]);

  // 更新矩形绘制
  const updateRectDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && pathRef.current.segments.length >= 4) {
      const startPoint = pathRef.current.segments[0].point;
      const rectangle = new paper.Rectangle(startPoint, point);
      pathRef.current.remove();
      pathRef.current = new paper.Path.Rectangle({
        rectangle: rectangle,
        strokeColor: new paper.Color(currentColor),
        strokeWidth: strokeWidth,
      });
    }
  }, [currentColor, strokeWidth]);

  // 开始绘制圆形
  const startCircleDraw = useCallback((point: paper.Point) => {
    pathRef.current = new paper.Path.Circle({
      center: point,
      radius: 1,
      strokeColor: new paper.Color(currentColor),
      strokeWidth: strokeWidth,
    });
  }, [currentColor, strokeWidth]);

  // 更新圆形绘制
  const updateCircleDraw = useCallback((point: paper.Point) => {
    if (pathRef.current) {
      const startPoint = pathRef.current.position;
      const radius = startPoint.getDistance(point);
      pathRef.current.remove();
      pathRef.current = new paper.Path.Circle({
        center: startPoint,
        radius: radius,
        strokeColor: new paper.Color(currentColor),
        strokeWidth: strokeWidth,
      });
    }
  }, [currentColor, strokeWidth]);

  // 完成绘制
  const finishDraw = useCallback(() => {
    if (pathRef.current) {
      // 如果是橡皮擦模式，设置混合模式为destination-out
      if (isEraser) {
        pathRef.current.blendMode = 'destination-out';
      }
      
      console.log(`✅ 绘制完成: 路径包含 ${pathRef.current.segments?.length || 0} 个点`);
      pathRef.current = null;
    }
  }, [isEraser]);

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