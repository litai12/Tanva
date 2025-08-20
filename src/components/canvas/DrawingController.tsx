import React, { useEffect, useRef, useCallback, useState } from 'react';
import paper from 'paper';
import { useToolStore, useCanvasStore } from '@/stores';
import ImageUploadComponent from './ImageUploadComponent';
import ImageContainer from './ImageContainer';
import Model3DUploadComponent from './Model3DUploadComponent';
import Model3DContainer from './Model3DContainer';
import type { Model3DData } from '@/services/model3DUploadService';

interface DrawingControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const DrawingController: React.FC<DrawingControllerProps> = ({ canvasRef }) => {
  const { drawMode, currentColor, strokeWidth, isEraser, setDrawMode } = useToolStore();
  const { zoom } = useCanvasStore();
  const pathRef = useRef<paper.Path | null>(null);
  const isDrawingRef = useRef(false);
  const drawingLayerRef = useRef<paper.Layer | null>(null);
  
  // 图片相关状态
  const [triggerImageUpload, setTriggerImageUpload] = useState(false);
  const currentPlaceholderRef = useRef<paper.Group | null>(null);
  const [imageInstances, setImageInstances] = useState<Array<{
    id: string;
    imageData: { id: string; src: string; fileName?: string };
    bounds: { x: number; y: number; width: number; height: number };
    isSelected: boolean;
  }>>([]);
  const [, setSelectedImageId] = useState<string | null>(null);
  
  // 3D模型相关状态
  const [triggerModel3DUpload, setTriggerModel3DUpload] = useState(false);
  const currentModel3DPlaceholderRef = useRef<paper.Group | null>(null);
  const [model3DInstances, setModel3DInstances] = useState<Array<{
    id: string;
    modelData: Model3DData;
    bounds: { x: number; y: number; width: number; height: number };
    isSelected: boolean;
  }>>([]);
  const [, setSelectedModel3DId] = useState<string | null>(null);

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
      
      // 优化：更新现有矩形而不是重新创建
      if (pathRef.current instanceof paper.Path.Rectangle) {
        // 直接更新矩形的边界
        pathRef.current.bounds = rectangle;
      } else {
        // 如果类型不匹配，才重新创建
        pathRef.current.remove();
        pathRef.current = new paper.Path.Rectangle(rectangle);
      }
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
      
      // 优化：更新现有圆形而不是重新创建
      if (pathRef.current instanceof paper.Path.Circle) {
        // 直接更新圆形的中心和半径
        pathRef.current.position = startPoint;
        pathRef.current.bounds = new paper.Rectangle(
          startPoint.x - radius, 
          startPoint.y - radius, 
          radius * 2, 
          radius * 2
        );
      } else {
        // 如果类型不匹配，才重新创建
        pathRef.current.remove();
        pathRef.current = new paper.Path.Circle({
          center: startPoint,
          radius: radius,
        });
      }
      pathRef.current.strokeColor = new paper.Color(currentColor);
      pathRef.current.strokeWidth = strokeWidth;
      pathRef.current.fillColor = null;
      
      // 保持起始点引用
      (pathRef.current as any).startPoint = startPoint;
    }
  }, [currentColor, strokeWidth]);

  // 创建图片占位框
  const createImagePlaceholder = useCallback((startPoint: paper.Point, endPoint: paper.Point) => {
    ensureDrawingLayer();
    
    // 计算占位框矩形
    const rect = new paper.Rectangle(startPoint, endPoint);
    const center = rect.center;
    const width = Math.abs(rect.width);
    const height = Math.abs(rect.height);
    
    // 最小尺寸限制
    const minSize = 50;
    const finalWidth = Math.max(width, minSize);
    const finalHeight = Math.max(height, minSize);
    
    // 创建占位框边框（虚线矩形）
    const placeholder = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(center.subtract([finalWidth/2, finalHeight/2]), [finalWidth, finalHeight]),
      strokeColor: new paper.Color('#60a5fa'), // 更柔和的蓝色边框
      strokeWidth: 2,
      dashArray: [8, 6],
      fillColor: new paper.Color(0.94, 0.97, 1, 0.8) // 淡蓝色半透明背景
    });
    
    // 创建上传按钮背景（圆角矩形）
    const buttonSize = Math.min(finalWidth * 0.5, finalHeight * 0.25, 120);
    const buttonHeight = Math.min(40, finalHeight * 0.2);
    
    // 创建按钮背景
    const buttonBg = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(center.subtract([buttonSize/2, buttonHeight/2]), [buttonSize, buttonHeight]),
      fillColor: new paper.Color('#3b82f6'), // 更现代的蓝色
      strokeColor: new paper.Color('#2563eb'), // 深蓝色边框
      strokeWidth: 1.5
    });
    
    // 创建"+"图标（更粗更圆润）
    const iconSize = Math.min(14, buttonHeight * 0.35);
    const hLine = new paper.Path.Line({
      from: center.subtract([iconSize/2, 0]),
      to: center.add([iconSize/2, 0]),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 3,
      strokeCap: 'round'
    });
    const vLine = new paper.Path.Line({
      from: center.subtract([0, iconSize/2]),
      to: center.add([0, iconSize/2]),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 3,
      strokeCap: 'round'
    });
    
    // 创建提示文字 - 调整位置，在按钮下方留出适当间距
    const textY = Math.round(center.y + buttonHeight/2 + 20); // 对齐到像素边界
    const fontSize = Math.round(Math.min(14, finalWidth * 0.06, finalHeight * 0.08)); // 确保字体大小为整数
    const text = new paper.PointText({
      point: new paper.Point(Math.round(center.x), textY),
      content: '点击上传图片',
      fontSize: fontSize,
      fillColor: new paper.Color('#1e40af'), // 深蓝色文字，与按钮呼应
      justification: 'center'
    });
    
    // 创建组合
    const group = new paper.Group([placeholder, buttonBg, hLine, vLine, text]);
    group.data = {
      type: 'image-placeholder',
      bounds: { x: center.x - finalWidth/2, y: center.y - finalHeight/2, width: finalWidth, height: finalHeight }
    };
    
    // 添加点击事件
    group.onClick = () => {
      console.log('📸 点击图片占位框，触发上传');
      currentPlaceholderRef.current = group;
      setTriggerImageUpload(true);
    };
    
    return group;
  }, [ensureDrawingLayer]);

  // 处理图片上传成功
  const handleImageUploaded = useCallback((imageData: string) => {
    const placeholder = currentPlaceholderRef.current;
    if (!placeholder || !placeholder.data?.bounds) {
      console.error('❌ 没有找到图片占位框');
      return;
    }
    
    console.log('✅ 图片上传成功，创建图片实例');
    
    const paperBounds = placeholder.data.bounds;
    const imageId = `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('📍 图片使用Paper.js坐标:', paperBounds);
    
    // 创建图片实例 - 直接使用Paper.js坐标
    const newImage = {
      id: imageId,
      imageData: {
        id: imageId,
        src: imageData,
        fileName: 'uploaded-image'
      },
      bounds: paperBounds, // 存储Paper.js坐标
      isSelected: true
    };
    
    // 添加到图片实例数组
    setImageInstances(prev => [...prev, newImage]);
    setSelectedImageId(imageId);
    
    // 删除占位框
    placeholder.remove();
    currentPlaceholderRef.current = null;
    
    // 自动切换回选择模式
    setDrawMode('select');
    
    console.log('✅ 图片添加到画布成功，已切换到选择模式');
  }, [setDrawMode, canvasRef]);

  // 处理图片上传错误
  const handleImageUploadError = useCallback((error: string) => {
    console.error('❌ 图片上传失败:', error);
    // 这里可以显示错误提示给用户
    alert(`图片上传失败: ${error}`);
    currentPlaceholderRef.current = null;
  }, []);

  // 处理上传触发完成
  const handleUploadTriggerHandled = useCallback(() => {
    setTriggerImageUpload(false);
  }, []);

  // 创建3D模型占位框
  const create3DModelPlaceholder = useCallback((startPoint: paper.Point, endPoint: paper.Point) => {
    ensureDrawingLayer();
    
    // 计算占位框矩形
    const rect = new paper.Rectangle(startPoint, endPoint);
    const center = rect.center;
    const width = Math.abs(rect.width);
    const height = Math.abs(rect.height);
    
    // 最小尺寸限制（3D模型需要更大的空间）
    const minSize = 80;
    const finalWidth = Math.max(width, minSize);
    const finalHeight = Math.max(height, minSize);
    
    // 创建占位框边框（虚线矩形）
    const placeholder = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(center.subtract([finalWidth/2, finalHeight/2]), [finalWidth, finalHeight]),
      strokeColor: new paper.Color('#8b5cf6'),
      strokeWidth: 2,
      dashArray: [8, 4],
      fillColor: new paper.Color(0.95, 0.9, 1, 0.6) // 淡紫色背景
    });
    
    // 创建上传按钮背景（圆角矩形）
    const buttonSize = Math.min(finalWidth * 0.6, finalHeight * 0.3, 140);
    const buttonHeight = Math.min(45, finalHeight * 0.25);
    
    // 创建按钮背景
    const buttonBg = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(center.subtract([buttonSize/2, buttonHeight/2]), [buttonSize, buttonHeight]),
      fillColor: new paper.Color('#7c3aed'),
      strokeColor: new paper.Color('#6d28d9'),
      strokeWidth: 1.5
    });
    
    // 创建3D立方体图标
    const iconSize = Math.min(16, buttonHeight * 0.4);
    const cubeOffset = iconSize * 0.3;
    
    // 立方体前面
    const frontFace = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(
        center.subtract([iconSize/2, iconSize/2]),
        [iconSize, iconSize]
      ),
      fillColor: new paper.Color('#fff'),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 1
    });
    
    // 立方体顶面
    const topFace = new paper.Path([
      center.add([-iconSize/2, -iconSize/2]),
      center.add([iconSize/2, -iconSize/2]),
      center.add([iconSize/2 + cubeOffset, -iconSize/2 - cubeOffset]),
      center.add([-iconSize/2 + cubeOffset, -iconSize/2 - cubeOffset])
    ]);
    topFace.fillColor = new paper.Color('#e5e7eb');
    topFace.strokeColor = new paper.Color('#fff');
    topFace.strokeWidth = 1;
    
    // 立方体右侧面
    const rightFace = new paper.Path([
      center.add([iconSize/2, -iconSize/2]),
      center.add([iconSize/2, iconSize/2]),
      center.add([iconSize/2 + cubeOffset, iconSize/2 - cubeOffset]),
      center.add([iconSize/2 + cubeOffset, -iconSize/2 - cubeOffset])
    ]);
    rightFace.fillColor = new paper.Color('#d1d5db');
    rightFace.strokeColor = new paper.Color('#fff');
    rightFace.strokeWidth = 1;
    
    // 创建提示文字 - 调整位置，在按钮下方留出适当间距
    const textY = Math.round(center.y + buttonHeight/2 + 25);
    const fontSize = Math.round(Math.min(14, finalWidth * 0.06, finalHeight * 0.08));
    const text = new paper.PointText({
      point: new paper.Point(Math.round(center.x), textY),
      content: '点击上传3D模型',
      fontSize: fontSize,
      fillColor: new paper.Color('#6b21a8'),
      justification: 'center'
    });
    
    // 创建组合
    const group = new paper.Group([placeholder, buttonBg, frontFace, topFace, rightFace, text]);
    group.data = {
      type: '3d-model-placeholder',
      bounds: { x: center.x - finalWidth/2, y: center.y - finalHeight/2, width: finalWidth, height: finalHeight }
    };
    
    // 添加点击事件
    group.onClick = () => {
      console.log('🎲 点击3D模型占位框，触发上传');
      currentModel3DPlaceholderRef.current = group;
      setTriggerModel3DUpload(true);
    };
    
    return group;
  }, [ensureDrawingLayer]);

  // 处理3D模型上传成功
  const handleModel3DUploaded = useCallback((modelData: Model3DData) => {
    const placeholder = currentModel3DPlaceholderRef.current;
    if (!placeholder || !placeholder.data?.bounds) {
      console.error('❌ 没有找到3D模型占位框');
      return;
    }
    
    console.log('✅ 3D模型上传成功，创建3D渲染实例:', modelData.fileName);
    
    const paperBounds = placeholder.data.bounds;
    const modelId = `model3d_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('📍 3D模型使用Paper.js坐标:', paperBounds);
    
    // 创建3D模型实例 - 直接使用Paper.js坐标
    const newModel3D = {
      id: modelId,
      modelData: modelData,
      bounds: paperBounds, // 存储Paper.js坐标
      isSelected: true
    };
    
    // 添加到3D模型实例数组
    setModel3DInstances(prev => [...prev, newModel3D]);
    setSelectedModel3DId(modelId);
    
    // 删除占位框
    placeholder.remove();
    currentModel3DPlaceholderRef.current = null;
    
    // 自动切换回选择模式
    setDrawMode('select');
    
    console.log('✅ 3D模型添加到画布成功，已切换到选择模式');
  }, [setDrawMode, canvasRef]);

  // 处理3D模型上传错误
  const handleModel3DUploadError = useCallback((error: string) => {
    console.error('❌ 3D模型上传失败:', error);
    alert(`3D模型上传失败: ${error}`);
    currentModel3DPlaceholderRef.current = null;
  }, []);

  // 处理3D模型上传触发完成
  const handleModel3DUploadTriggerHandled = useCallback(() => {
    setTriggerModel3DUpload(false);
  }, []);

  // 处理3D模型取消选中
  const handleModel3DDeselect = useCallback(() => {
    setSelectedModel3DId(null);
    setModel3DInstances(prev => prev.map(model => ({
      ...model,
      isSelected: false
    })));
  }, []);

  // 处理图片取消选中
  const handleImageDeselect = useCallback(() => {
    setSelectedImageId(null);
    setImageInstances(prev => prev.map(image => ({
      ...image,
      isSelected: false
    })));
  }, []);

  // 处理3D模型选中
  const handleModel3DSelect = useCallback((modelId: string) => {
    setSelectedModel3DId(modelId);
    setModel3DInstances(prev => prev.map(model => ({
      ...model,
      isSelected: model.id === modelId
    })));
    // 取消图片选中
    handleImageDeselect();
  }, [handleImageDeselect]);

  // 处理图片选中
  const handleImageSelect = useCallback((imageId: string) => {
    setSelectedImageId(imageId);
    setImageInstances(prev => prev.map(image => ({
      ...image,
      isSelected: image.id === imageId
    })));
    // 取消3D模型选中
    handleModel3DDeselect();
  }, [handleModel3DDeselect]);

  // 处理图片移动
  const handleImageMove = useCallback((imageId: string, newPosition: { x: number; y: number }) => {
    setImageInstances(prev => prev.map(image => 
      image.id === imageId 
        ? { ...image, bounds: { ...image.bounds, x: newPosition.x, y: newPosition.y } }
        : image
    ));
  }, []);

  // 处理图片调整大小
  const handleImageResize = useCallback((imageId: string, newBounds: { x: number; y: number; width: number; height: number }) => {
    setImageInstances(prev => prev.map(image => 
      image.id === imageId 
        ? { ...image, bounds: newBounds }
        : image
    ));
  }, []);

  // 处理3D模型移动
  const handleModel3DMove = useCallback((modelId: string, newPosition: { x: number; y: number }) => {
    setModel3DInstances(prev => prev.map(model => 
      model.id === modelId 
        ? { ...model, bounds: { ...model.bounds, x: newPosition.x, y: newPosition.y } }
        : model
    ));
  }, []);

  // 处理3D模型调整大小
  const handleModel3DResize = useCallback((modelId: string, newBounds: { x: number; y: number; width: number; height: number }) => {
    setModel3DInstances(prev => prev.map(model => 
      model.id === modelId 
        ? { ...model, bounds: newBounds }
        : model
    ));
  }, []);

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
      } else if (drawMode === 'image') {
        // 图片模式：创建占位框
        const startPoint = (pathRef.current as any).startPoint;
        if (startPoint) {
          const endPoint = new paper.Point(
            pathRef.current.bounds.x + pathRef.current.bounds.width,
            pathRef.current.bounds.y + pathRef.current.bounds.height
          );
          
          // 删除临时绘制的矩形
          pathRef.current.remove();
          
          // 创建图片占位框
          createImagePlaceholder(startPoint, endPoint);
          
          // 自动切换到选择模式
          setDrawMode('select');
        }
      } else if (drawMode === '3d-model') {
        // 3D模型模式：创建占位框
        const startPoint = (pathRef.current as any).startPoint;
        if (startPoint) {
          const endPoint = new paper.Point(
            pathRef.current.bounds.x + pathRef.current.bounds.width,
            pathRef.current.bounds.y + pathRef.current.bounds.height
          );
          
          // 删除临时绘制的矩形
          pathRef.current.remove();
          
          // 创建3D模型占位框
          create3DModelPlaceholder(startPoint, endPoint);
          
          // 自动切换到选择模式
          setDrawMode('select');
        }
      } else {
        // 普通绘制模式：在绘制完成时进行一次平滑处理
        if (drawMode === 'free' && pathRef.current.segments && pathRef.current.segments.length > 2) {
          pathRef.current.smooth({ type: 'geometric', factor: 0.4 });
        }
      }
      
      // 清理临时引用
      delete (pathRef.current as any).startPoint;
      
      console.log(`✅ 绘制完成: ${isEraser ? '橡皮擦操作' : drawMode === 'image' ? '图片占位框，已切换到选择模式' : drawMode === '3d-model' ? '3D模型占位框，已切换到选择模式' : '普通绘制'}`);
      pathRef.current = null;
    }
  }, [isEraser, performErase, drawMode, createImagePlaceholder, create3DModelPlaceholder, setDrawMode]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;

    // 鼠标按下事件处理
    const handleMouseDown = (event: MouseEvent) => {
      // 在选择模式下，点击空白区域取消所有选中
      if (drawMode === 'select' && event.button === 0) {
        handleModel3DDeselect();
        handleImageDeselect();
        return;
      }
      
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
      } else if (drawMode === 'image') {
        // 开始创建图片占位框
        const rect = new paper.Rectangle(point, point.add(new paper.Point(1, 1)));
        pathRef.current = new paper.Path.Rectangle(rect);
        pathRef.current.strokeColor = new paper.Color('#999');
        pathRef.current.strokeWidth = 1;
        pathRef.current.dashArray = [5, 5];
        pathRef.current.fillColor = null;
        (pathRef.current as any).startPoint = point;
      } else if (drawMode === '3d-model') {
        // 开始创建3D模型占位框
        const rect = new paper.Rectangle(point, point.add(new paper.Point(1, 1)));
        pathRef.current = new paper.Path.Rectangle(rect);
        pathRef.current.strokeColor = new paper.Color('#8b5cf6');
        pathRef.current.strokeWidth = 2;
        pathRef.current.dashArray = [8, 4];
        pathRef.current.fillColor = null;
        (pathRef.current as any).startPoint = point;
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
      } else if (drawMode === 'image') {
        // 更新图片占位框
        if (pathRef.current && (pathRef.current as any).startPoint) {
          const startPoint = (pathRef.current as any).startPoint;
          const rectangle = new paper.Rectangle(startPoint, point);
          
          // 移除旧的矩形并创建新的
          pathRef.current.remove();
          pathRef.current = new paper.Path.Rectangle(rectangle);
          pathRef.current.strokeColor = new paper.Color('#999');
          pathRef.current.strokeWidth = 1;
          pathRef.current.dashArray = [5, 5];
          pathRef.current.fillColor = null;
          
          // 保持起始点引用
          (pathRef.current as any).startPoint = startPoint;
        }
      } else if (drawMode === '3d-model') {
        // 更新3D模型占位框
        if (pathRef.current && (pathRef.current as any).startPoint) {
          const startPoint = (pathRef.current as any).startPoint;
          const rectangle = new paper.Rectangle(startPoint, point);
          
          // 移除旧的矩形并创建新的
          pathRef.current.remove();
          pathRef.current = new paper.Path.Rectangle(rectangle);
          pathRef.current.strokeColor = new paper.Color('#8b5cf6');
          pathRef.current.strokeWidth = 2;
          pathRef.current.dashArray = [8, 4];
          pathRef.current.fillColor = null;
          
          // 保持起始点引用
          (pathRef.current as any).startPoint = startPoint;
        }
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
  }, [canvasRef, drawMode, currentColor, strokeWidth, isEraser, zoom, startFreeDraw, continueFreeDraw, startRectDraw, updateRectDraw, startCircleDraw, updateCircleDraw, finishDraw, handleModel3DDeselect, handleImageDeselect]);

  return (
    <>
      {/* 图片上传组件 */}
      <ImageUploadComponent
        onImageUploaded={handleImageUploaded}
        onUploadError={handleImageUploadError}
        trigger={triggerImageUpload}
        onTriggerHandled={handleUploadTriggerHandled}
      />

      {/* 图片渲染实例 */}
      {imageInstances.map((image) => (
        <ImageContainer
          key={image.id}
          imageData={image.imageData}
          bounds={image.bounds}
          isSelected={image.isSelected}
          onSelect={() => handleImageSelect(image.id)}
          onMove={(newPosition) => handleImageMove(image.id, newPosition)}
          onResize={(newBounds) => handleImageResize(image.id, newBounds)}
        />
      ))}
      
      {/* 3D模型上传组件 */}
      <Model3DUploadComponent
        onModel3DUploaded={handleModel3DUploaded}
        onUploadError={handleModel3DUploadError}
        trigger={triggerModel3DUpload}
        onTriggerHandled={handleModel3DUploadTriggerHandled}
      />

      {/* 3D模型渲染实例 */}
      {model3DInstances.map((model) => (
        <Model3DContainer
          key={model.id}
          modelData={model.modelData}
          bounds={model.bounds}
          isSelected={model.isSelected}
          onSelect={() => handleModel3DSelect(model.id)}
          onMove={(newPosition) => handleModel3DMove(model.id, newPosition)}
          onResize={(newBounds) => handleModel3DResize(model.id, newBounds)}
        />
      ))}
    </>
  );
};

export default DrawingController;