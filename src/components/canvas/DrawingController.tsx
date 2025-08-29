import React, { useEffect, useRef, useCallback, useState } from 'react';
import paper from 'paper';
import { useToolStore, useCanvasStore, useLayerStore } from '@/stores';
import ImageUploadComponent from './ImageUploadComponent';
import ImageContainer from './ImageContainer';
import Model3DUploadComponent from './Model3DUploadComponent';
import Model3DContainer from './Model3DContainer';
import { DrawingLayerManager } from './drawing/DrawingLayerManager';
import type { Model3DData } from '@/services/model3DUploadService';

interface DrawingControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const DrawingController: React.FC<DrawingControllerProps> = ({ canvasRef }) => {
  const { drawMode, currentColor, strokeWidth, isEraser, setDrawMode } = useToolStore();
  const { zoom } = useCanvasStore();
  const { layers } = useLayerStore();
  const pathRef = useRef<paper.Path | null>(null);
  const isDrawingRef = useRef(false);
  const drawingLayerManagerRef = useRef<DrawingLayerManager | null>(null);
  
  // 拖拽检测相关状态
  const initialClickPointRef = useRef<paper.Point | null>(null);
  const hasMovedRef = useRef(false);
  const DRAG_THRESHOLD = 3; // 3像素的拖拽阈值

  // 图片相关状态
  const [triggerImageUpload, setTriggerImageUpload] = useState(false);
  const currentPlaceholderRef = useRef<paper.Group | null>(null);
  const [imageInstances, setImageInstances] = useState<Array<{
    id: string;
    imageData: { id: string; src: string; fileName?: string };
    bounds: { x: number; y: number; width: number; height: number };
    isSelected: boolean;
    visible: boolean;
    layerId?: string;
    selectionRect?: paper.Path;
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
    visible: boolean;
    selectionRect?: paper.Path;
  }>>([]);
  const [, setSelectedModel3DId] = useState<string | null>(null);

  // 选择工具状态
  const [selectedPath, setSelectedPath] = useState<paper.Path | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<paper.Path[]>([]);
  const [isSelectionDragging, setIsSelectionDragging] = useState(false);
  const [selectionStartPoint, setSelectionStartPoint] = useState<paper.Point | null>(null);
  const selectionBoxRef = useRef<paper.Path | null>(null);

  // 路径编辑状态
  const [isPathDragging, setIsPathDragging] = useState(false);
  const [isSegmentDragging, setIsSegmentDragging] = useState(false);
  const [dragStartPoint, setDragStartPoint] = useState<paper.Point | null>(null);
  const [draggedSegment, setDraggedSegment] = useState<paper.Segment | null>(null);
  const [draggedPath, setDraggedPath] = useState<paper.Path | null>(null);
  
  // 图像调整大小状态
  const [isImageResizing, setIsImageResizing] = useState(false);
  const [resizeImageId, setResizeImageId] = useState<string | null>(null);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [resizeStartBounds, setResizeStartBounds] = useState<paper.Rectangle | null>(null);
  const [resizeStartPoint, setResizeStartPoint] = useState<paper.Point | null>(null);
  
  // 图像拖拽状态
  const [isImageDragging, setIsImageDragging] = useState(false);
  const [dragImageId, setDragImageId] = useState<string | null>(null);
  const [imageDragStartPoint, setImageDragStartPoint] = useState<paper.Point | null>(null);
  const [imageDragStartBounds, setImageDragStartBounds] = useState<{ x: number; y: number } | null>(null);

  // 初始化图层管理器
  useEffect(() => {
    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }
    return () => {
      if (drawingLayerManagerRef.current) {
        drawingLayerManagerRef.current.cleanup();
        drawingLayerManagerRef.current = null;
      }
    };
  }, []);

  // 确保绘图图层存在并激活
  const ensureDrawingLayer = useCallback(() => {
    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }
    return drawingLayerManagerRef.current.ensureDrawingLayer();
  }, []);

  // 开始自由绘制
  const startFreeDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，而是等待用户开始移动
    // 只记录初始点击位置
    initialClickPointRef.current = point;
    hasMovedRef.current = false;
    // 暂时不创建pathRef.current，等待移动后再创建
  }, []);

  // 实际创建图元（当确认用户在拖拽时）
  const createFreeDrawPath = useCallback((startPoint: paper.Point) => {
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
    pathRef.current.add(startPoint);
  }, [ensureDrawingLayer, currentColor, strokeWidth, isEraser]);

  // 继续自由绘制
  const continueFreeDraw = useCallback((point: paper.Point) => {
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && initialClickPointRef.current && !hasMovedRef.current) {
      const distance = initialClickPointRef.current.getDistance(point);
      
      if (distance >= DRAG_THRESHOLD) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true;
        createFreeDrawPath(initialClickPointRef.current);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

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

      // 触发 Paper.js 的 change 事件以更新图层面板
      if (paper.project) {
        paper.project.emit('change');
      }
    }
  }, [strokeWidth, createFreeDrawPath]);

  // 开始绘制矩形
  const startRectDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，等待用户开始移动
    initialClickPointRef.current = point;
    hasMovedRef.current = false;
  }, []);

  // 实际创建矩形图元（当确认用户在拖拽时）
  const createRectPath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    // 创建一个最小的矩形，使用 Rectangle 构造函数
    const rectangle = new paper.Rectangle(startPoint, startPoint.add(new paper.Point(1, 1)));
    pathRef.current = new paper.Path.Rectangle(rectangle);
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;
    pathRef.current.fillColor = null; // 确保不填充

    // 保存起始点用于后续更新
    (pathRef.current as any).startPoint = startPoint;
  }, [ensureDrawingLayer, currentColor, strokeWidth]);

  // 更新矩形绘制
  const updateRectDraw = useCallback((point: paper.Point) => {
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && initialClickPointRef.current && !hasMovedRef.current) {
      const distance = initialClickPointRef.current.getDistance(point);
      
      if (distance >= DRAG_THRESHOLD) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true;
        createRectPath(initialClickPointRef.current);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

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
  }, [currentColor, strokeWidth, createRectPath]);

  // 开始绘制圆形
  const startCircleDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，等待用户开始移动
    initialClickPointRef.current = point;
    hasMovedRef.current = false;
  }, []);

  // 实际创建圆形图元（当确认用户在拖拽时）
  const createCirclePath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    pathRef.current = new paper.Path.Circle({
      center: startPoint,
      radius: 1,
    });
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;
    pathRef.current.fillColor = null; // 确保不填充

    // 保存起始点用于后续更新
    (pathRef.current as any).startPoint = startPoint;
  }, [ensureDrawingLayer, currentColor, strokeWidth]);

  // 更新圆形绘制
  const updateCircleDraw = useCallback((point: paper.Point) => {
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && initialClickPointRef.current && !hasMovedRef.current) {
      const distance = initialClickPointRef.current.getDistance(point);
      
      if (distance >= DRAG_THRESHOLD) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true;
        createCirclePath(initialClickPointRef.current);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

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
  }, [currentColor, strokeWidth, createCirclePath]);

  // 创建直线路径（延迟创建）
  const createLinePath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    pathRef.current = new paper.Path.Line({
      from: startPoint,
      to: startPoint.add(new paper.Point(1, 0)), // 初始创建一个极短的线段
    });
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;

    // 保存起始点用于后续更新
    (pathRef.current as any).startPoint = startPoint;
    console.log('创建直线路径');
  }, [ensureDrawingLayer, currentColor, strokeWidth]);

  // 开始绘制直线（仅记录起始位置）
  const startLineDraw = useCallback((_point: paper.Point) => {
    // 仅记录起始位置，不立即创建路径
    console.log('直线工具激活，等待拖拽');
  }, []);

  // 更新直线绘制（鼠标移动时跟随）
  const updateLineDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;

      // 更新直线的终点
      pathRef.current.segments[1].point = point;

      // 保持起始点引用和样式
      (pathRef.current as any).startPoint = startPoint;
    }
  }, []);

  // 完成直线绘制（第二次点击）
  const finishLineDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && (pathRef.current as any).startPoint) {
      // 设置最终的终点
      pathRef.current.segments[1].point = point;

      // 清理临时引用
      delete (pathRef.current as any).startPoint;

      console.log('完成直线绘制');
      pathRef.current = null;

      // 触发 Paper.js 的 change 事件
      if (paper.project) {
        paper.project.emit('change');
      }
    }
  }, []);

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
      rectangle: new paper.Rectangle(center.subtract([finalWidth / 2, finalHeight / 2]), [finalWidth, finalHeight]),
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
      rectangle: new paper.Rectangle(center.subtract([buttonSize / 2, buttonHeight / 2]), [buttonSize, buttonHeight]),
      fillColor: new paper.Color('#3b82f6'), // 更现代的蓝色
      strokeColor: new paper.Color('#2563eb'), // 深蓝色边框
      strokeWidth: 1.5
    });

    // 创建"+"图标（更粗更圆润）
    const iconSize = Math.min(14, buttonHeight * 0.35);
    const hLine = new paper.Path.Line({
      from: center.subtract([iconSize / 2, 0]),
      to: center.add([iconSize / 2, 0]),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 3,
      strokeCap: 'round'
    });
    const vLine = new paper.Path.Line({
      from: center.subtract([0, iconSize / 2]),
      to: center.add([0, iconSize / 2]),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 3,
      strokeCap: 'round'
    });

    // 创建提示文字 - 调整位置，在按钮下方留出适当间距
    const textY = Math.round(center.y + buttonHeight / 2 + 20); // 对齐到像素边界
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
      bounds: { x: center.x - finalWidth / 2, y: center.y - finalHeight / 2, width: finalWidth, height: finalHeight },
      isHelper: true  // 标记为辅助元素，不显示在图层列表中
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
  const handleImageUploaded = useCallback((imageData: string, fileName?: string) => {
    const placeholder = currentPlaceholderRef.current;
    if (!placeholder || !placeholder.data?.bounds) {
      console.error('❌ 没有找到图片占位框');
      return;
    }

    console.log('✅ 图片上传成功，创建图片实例');

    const paperBounds = placeholder.data.bounds;
    const imageId = `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log('📍 图片使用Paper.js坐标:', paperBounds);

    // 在Paper.js中创建图片的代表组
    ensureDrawingLayer();

    // 创建Paper.js的Raster对象来显示图片
    const raster = new paper.Raster({
      source: imageData
    });

    // 等待图片加载完成后设置位置
    raster.onLoad = () => {
      // 存储原始尺寸信息
      const originalWidth = raster.width;
      const originalHeight = raster.height;
      const aspectRatio = originalWidth / originalHeight;
      
      raster.data = {
        originalWidth: originalWidth,
        originalHeight: originalHeight,
        aspectRatio: aspectRatio
      };
      
      // 根据占位框和图片比例，计算保持比例的实际大小
      const boxAspectRatio = paperBounds.width / paperBounds.height;
      let finalBounds;
      
      if (aspectRatio > boxAspectRatio) {
        // 图片更宽，以宽度为准
        const newWidth = paperBounds.width;
        const newHeight = newWidth / aspectRatio;
        const yOffset = (paperBounds.height - newHeight) / 2;
        
        finalBounds = new paper.Rectangle(
          paperBounds.x,
          paperBounds.y + yOffset,
          newWidth,
          newHeight
        );
      } else {
        // 图片更高，以高度为准
        const newHeight = paperBounds.height;
        const newWidth = newHeight * aspectRatio;
        const xOffset = (paperBounds.width - newWidth) / 2;
        
        finalBounds = new paper.Rectangle(
          paperBounds.x + xOffset,
          paperBounds.y,
          newWidth,
          newHeight
        );
      }
      
      // 设置图片边界（保持比例）
      raster.bounds = finalBounds;
      
      // 更新交互矩形以匹配实际图片边界
      const parentGroup = raster.parent;
      if (parentGroup && parentGroup instanceof paper.Group) {
        parentGroup.children.forEach(child => {
          if (child instanceof paper.Path && !child.data?.isSelectionBorder && !child.data?.isResizeHandle) {
            child.bounds = finalBounds;
          }
        });
      }
      
      // 更新图片实例的边界信息
      setImageInstances(prev => prev.map(img => {
        if (img.id === imageId) {
          return {
            ...img,
            bounds: {
              x: finalBounds.x,
              y: finalBounds.y,
              width: finalBounds.width,
              height: finalBounds.height
            }
          };
        }
        return img;
      }));
      
      // 图片加载完成后，为选中的图片添加选择框和控制点
      if (parentGroup && parentGroup instanceof paper.Group) {
        // 添加选择框
        const selectionBorder = new paper.Path.Rectangle({
          rectangle: finalBounds,
          strokeColor: new paper.Color('#3b82f6'),
          strokeWidth: 2,
          fillColor: null,
          selected: false
        });
        selectionBorder.data = { isSelectionBorder: true };
        parentGroup.addChild(selectionBorder);
        
        // 添加四个角的调整控制点
        const handleSize = 8;
        const handleColor = new paper.Color('#3b82f6');
        
        // 左上角
        const nwHandle = new paper.Path.Rectangle({
          point: [finalBounds.left - handleSize/2, finalBounds.top - handleSize/2],
          size: [handleSize, handleSize],
          fillColor: handleColor,
          strokeColor: 'white',
          strokeWidth: 1,
          selected: false
        });
        nwHandle.data = { isResizeHandle: true, direction: 'nw', imageId: imageId };
        parentGroup.addChild(nwHandle);
        
        // 右上角
        const neHandle = new paper.Path.Rectangle({
          point: [finalBounds.right - handleSize/2, finalBounds.top - handleSize/2],
          size: [handleSize, handleSize],
          fillColor: handleColor,
          strokeColor: 'white',
          strokeWidth: 1,
          selected: false
        });
        neHandle.data = { isResizeHandle: true, direction: 'ne', imageId: imageId };
        parentGroup.addChild(neHandle);
        
        // 左下角
        const swHandle = new paper.Path.Rectangle({
          point: [finalBounds.left - handleSize/2, finalBounds.bottom - handleSize/2],
          size: [handleSize, handleSize],
          fillColor: handleColor,
          strokeColor: 'white',
          strokeWidth: 1,
          selected: false
        });
        swHandle.data = { isResizeHandle: true, direction: 'sw', imageId: imageId };
        parentGroup.addChild(swHandle);
        
        // 右下角
        const seHandle = new paper.Path.Rectangle({
          point: [finalBounds.right - handleSize/2, finalBounds.bottom - handleSize/2],
          size: [handleSize, handleSize],
          fillColor: handleColor,
          strokeColor: 'white',
          strokeWidth: 1,
          selected: false
        });
        seHandle.data = { isResizeHandle: true, direction: 'se', imageId: imageId };
        parentGroup.addChild(seHandle);
      }
      
      paper.view.update();
    };

    // 创建一个透明矩形用于交互（选择、拖拽等）
    // 初始使用占位框大小，等图片加载后再更新
    const imageRect = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(
        paperBounds.x,
        paperBounds.y,
        paperBounds.width,
        paperBounds.height
      ),
      fillColor: new paper.Color(1, 1, 1, 0.01), // 几乎透明，但仍然可以被选中
      strokeColor: null,
      visible: true
    });

    // 创建图片组，包含栅格图像和交互矩形
    const imageGroup = new paper.Group([raster, imageRect]);
    
    // 强制Paper.js重新渲染
    paper.view.update();
    imageGroup.data = {
      type: 'image',
      imageId: imageId,
      customName: (() => {
        // 计算现有图片数量，用于自动编号
        const existingImages = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image'
          )
        );
        const nextNumber = existingImages.length + 1;

        // 优先使用传递的原始文件名（去除扩展名）
        if (fileName) {
          const nameFromFile = fileName.split('.')[0]; // 移除扩展名
          if (nameFromFile && nameFromFile.length > 0) {
            return nameFromFile;
          }
        }

        // 如果没有有效文件名，使用自动编号
        return `图片 ${nextNumber}`;
      })(), // 使用文件名或自动编号
      isHelper: false  // 不是辅助元素，显示在图层列表中
    };

    // 创建透明的选择区域（用于交互）
    const selectionRect = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(
        paperBounds.x,
        paperBounds.y,
        paperBounds.width,
        paperBounds.height
      ),
      fillColor: new paper.Color(0, 0, 0, 0), // 完全透明
      strokeColor: null,
      visible: false // 初始不可见，避免影响其他操作
    });

    // 标记为图片选择区域，并设置为不响应事件
    selectionRect.data = {
      type: 'image-selection-area',
      imageId: imageId,
      isHelper: true  // 标记为辅助元素，不显示在图层列表中
    };

    // 设置为不响应鼠标事件，避免阻挡其他操作
    selectionRect.locked = true;

    // 获取图片所属的图层ID（从Paper.js图像组的图层名称中提取）
    const getLayerIdFromGroup = () => {
      const layer = imageGroup.layer;
      if (layer && layer.name && layer.name.startsWith('layer_')) {
        return layer.name.replace('layer_', '');
      }
      return undefined;
    };

    // 创建图片实例 - 直接使用Paper.js坐标
    const newImage = {
      id: imageId,
      imageData: {
        id: imageId,
        src: imageData,
        fileName: fileName || 'uploaded-image'
      },
      bounds: paperBounds, // 存储Paper.js坐标
      isSelected: true,
      visible: true, // 默认可见
      layerId: getLayerIdFromGroup(), // 关联到所属图层
      selectionRect: selectionRect // 存储对应的Paper.js选择区域
    };

    // 先清除其他图片的选择状态
    setImageInstances(prev => prev.map(img => ({ ...img, isSelected: false })));
    setSelectedImageId(null);
    
    // 清除Paper.js中的所有选择框和控制点
    paper.project?.layers?.forEach(layer => {
      const itemsToRemove: paper.Item[] = [];
      layer.children.forEach(child => {
        if (child.data?.type === 'image' && child instanceof paper.Group) {
          child.children.forEach(subChild => {
            if (subChild.data?.isSelectionBorder || subChild.data?.isResizeHandle) {
              itemsToRemove.push(subChild);
            }
          });
        }
      });
      itemsToRemove.forEach(item => item.remove());
    });
    
    // 添加到图片实例数组
    setImageInstances(prev => [...prev, newImage]);
    setSelectedImageId(imageId);
    
    // 注意：选择框和控制点将在图片加载完成后在 raster.onLoad 回调中添加

    // 删除占位框
    placeholder.remove();
    currentPlaceholderRef.current = null;

    // 自动切换回选择模式
    setDrawMode('select');

    console.log('✅ 图片添加到画布成功，已切换到选择模式并选中');
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
      rectangle: new paper.Rectangle(center.subtract([finalWidth / 2, finalHeight / 2]), [finalWidth, finalHeight]),
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
      rectangle: new paper.Rectangle(center.subtract([buttonSize / 2, buttonHeight / 2]), [buttonSize, buttonHeight]),
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
        center.subtract([iconSize / 2, iconSize / 2]),
        [iconSize, iconSize]
      ),
      fillColor: new paper.Color('#fff'),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 1
    });

    // 立方体顶面
    const topFace = new paper.Path([
      center.add([-iconSize / 2, -iconSize / 2]),
      center.add([iconSize / 2, -iconSize / 2]),
      center.add([iconSize / 2 + cubeOffset, -iconSize / 2 - cubeOffset]),
      center.add([-iconSize / 2 + cubeOffset, -iconSize / 2 - cubeOffset])
    ]);
    topFace.fillColor = new paper.Color('#e5e7eb');
    topFace.strokeColor = new paper.Color('#fff');
    topFace.strokeWidth = 1;

    // 立方体右侧面
    const rightFace = new paper.Path([
      center.add([iconSize / 2, -iconSize / 2]),
      center.add([iconSize / 2, iconSize / 2]),
      center.add([iconSize / 2 + cubeOffset, iconSize / 2 - cubeOffset]),
      center.add([iconSize / 2 + cubeOffset, -iconSize / 2 - cubeOffset])
    ]);
    rightFace.fillColor = new paper.Color('#d1d5db');
    rightFace.strokeColor = new paper.Color('#fff');
    rightFace.strokeWidth = 1;

    // 创建提示文字 - 调整位置，在按钮下方留出适当间距
    const textY = Math.round(center.y + buttonHeight / 2 + 25);
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
      bounds: { x: center.x - finalWidth / 2, y: center.y - finalHeight / 2, width: finalWidth, height: finalHeight },
      isHelper: true  // 标记为辅助元素，不显示在图层列表中
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

    // 在Paper.js中创建3D模型的代表组
    ensureDrawingLayer();

    // 创建一个矩形表示3D模型边界（用于显示在图层中）
    const modelRect = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(
        paperBounds.x,
        paperBounds.y,
        paperBounds.width,
        paperBounds.height
      ),
      fillColor: new paper.Color(1, 1, 1, 0.01), // 几乎透明，但仍然可以被选中
      strokeColor: null,
      visible: true
    });

    // 创建3D模型组
    const modelGroup = new paper.Group([modelRect]);
    modelGroup.data = {
      type: '3d-model',
      modelId: modelId,
      customName: (() => {
        const nameFromFile = modelData.fileName?.split('.')[0];
        if (nameFromFile && nameFromFile.length > 0) {
          return nameFromFile;
        }

        // 如果没有有效文件名，使用自动编号
        const existingModels = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === '3d-model' &&
            child.data?.customName?.match(/^3D模型\s*\d*$/)
          )
        );
        const nextNumber = existingModels.length + 1;
        return `3D模型 ${nextNumber}`;
      })(), // 使用文件名或自动编号
      isHelper: false  // 不是辅助元素，显示在图层列表中
    };

    // 创建透明的选择区域（用于交互）
    const selectionRect = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(
        paperBounds.x,
        paperBounds.y,
        paperBounds.width,
        paperBounds.height
      ),
      fillColor: new paper.Color(0, 0, 0, 0), // 完全透明
      strokeColor: null,
      visible: false // 初始不可见，避免影响其他操作
    });

    // 标记为3D模型选择区域，并设置为不响应事件
    selectionRect.data = {
      type: '3d-model-selection-area',
      modelId: modelId,
      isHelper: true  // 标记为辅助元素，不显示在图层列表中
    };

    // 设置为不响应鼠标事件，避免阻挡其他操作
    selectionRect.locked = true;

    // 创建3D模型实例 - 直接使用Paper.js坐标
    const newModel3D = {
      id: modelId,
      modelData: modelData,
      bounds: paperBounds, // 存储Paper.js坐标
      isSelected: true,
      visible: true, // 默认可见
      selectionRect: selectionRect // 存储对应的Paper.js选择区域
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
    
    // 移除所有图像的选择框和控制点
    paper.project?.layers?.forEach(layer => {
      // 创建一个要删除的项目列表
      const itemsToRemove: paper.Item[] = [];
      
      // 遍历所有子元素
      layer.children.forEach(child => {
        // 处理图像组
        if (child.data?.type === 'image' && child instanceof paper.Group) {
          // 遍历图像组的所有子元素
          child.children.forEach(subChild => {
            if (subChild.data?.isSelectionBorder || subChild.data?.isResizeHandle) {
              itemsToRemove.push(subChild);
            }
          });
        }
        // 也检查是否有孤立的控制点（可能因为某些原因未被正确分组）
        else if (child.data?.isResizeHandle) {
          itemsToRemove.push(child);
        }
      });
      
      // 删除所有标记的项目
      itemsToRemove.forEach(item => {
        item.remove();
      });
    });
    
    // 强制Paper.js更新视图
    paper.view?.update();
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
    
    // 在Paper.js中为选中的图像添加选择框和控制点
    const imageGroup = paper.project.layers.flatMap(layer =>
      layer.children.filter(child =>
        child.data?.type === 'image' && child.data?.imageId === imageId
      )
    )[0];
    
    if (imageGroup && imageGroup instanceof paper.Group) {
      // 移除之前的选择框和控制点
      imageGroup.children.forEach(child => {
        if (child.data?.isSelectionBorder || child.data?.isResizeHandle) {
          child.remove();
        }
      });
      
      // 计算实际的图像边界（排除控制点和选择框）
      let imageBounds = null;
      imageGroup.children.forEach(child => {
        if (child instanceof paper.Raster || 
            (child instanceof paper.Path && !child.data?.isSelectionBorder && !child.data?.isResizeHandle)) {
          if (!imageBounds) {
            imageBounds = child.bounds.clone();
          } else {
            imageBounds = imageBounds.unite(child.bounds);
          }
        }
      });
      
      if (!imageBounds) {
        imageBounds = imageGroup.bounds;
      }
      
      // 添加新的选择框
      const selectionBorder = new paper.Path.Rectangle({
        rectangle: imageBounds,
        strokeColor: new paper.Color('#3b82f6'),
        strokeWidth: 2,
        fillColor: null,
        selected: false
      });
      selectionBorder.data = { isSelectionBorder: true };
      imageGroup.addChild(selectionBorder);
      
      // 添加四个角的调整控制点
      const handleSize = 8;
      const handleColor = new paper.Color('#3b82f6');
      const bounds = imageBounds;
      
      // 左上角
      const nwHandle = new paper.Path.Rectangle({
        point: [bounds.left - handleSize/2, bounds.top - handleSize/2],
        size: [handleSize, handleSize],
        fillColor: handleColor,
        strokeColor: 'white',
        strokeWidth: 1,
        selected: false
      });
      nwHandle.data = { isResizeHandle: true, direction: 'nw', imageId: imageId };
      imageGroup.addChild(nwHandle);
      
      // 右上角
      const neHandle = new paper.Path.Rectangle({
        point: [bounds.right - handleSize/2, bounds.top - handleSize/2],
        size: [handleSize, handleSize],
        fillColor: handleColor,
        strokeColor: 'white',
        strokeWidth: 1,
        selected: false
      });
      neHandle.data = { isResizeHandle: true, direction: 'ne', imageId: imageId };
      imageGroup.addChild(neHandle);
      
      // 左下角
      const swHandle = new paper.Path.Rectangle({
        point: [bounds.left - handleSize/2, bounds.bottom - handleSize/2],
        size: [handleSize, handleSize],
        fillColor: handleColor,
        strokeColor: 'white',
        strokeWidth: 1,
        selected: false
      });
      swHandle.data = { isResizeHandle: true, direction: 'sw', imageId: imageId };
      imageGroup.addChild(swHandle);
      
      // 右下角
      const seHandle = new paper.Path.Rectangle({
        point: [bounds.right - handleSize/2, bounds.bottom - handleSize/2],
        size: [handleSize, handleSize],
        fillColor: handleColor,
        strokeColor: 'white',
        strokeWidth: 1,
        selected: false
      });
      seHandle.data = { isResizeHandle: true, direction: 'se', imageId: imageId };
      imageGroup.addChild(seHandle);
    }
    
    // 取消3D模型选中
    handleModel3DDeselect();
  }, [handleModel3DDeselect]);

  // 选择路径并启用编辑模式
  const handlePathSelect = useCallback((path: paper.Path) => {
    // 取消之前选中的路径
    if (selectedPath && selectedPath !== path) {
      selectedPath.selected = false;
      selectedPath.fullySelected = false;
      // 恢复原始样式
      if ((selectedPath as any).originalStrokeWidth) {
        selectedPath.strokeWidth = (selectedPath as any).originalStrokeWidth;
      }
    }

    // 选中新路径并启用编辑模式
    path.selected = true;
    path.fullySelected = true; // 显示所有控制点

    // 保存原始线宽并增加选中时的线宽  
    if (!(path as any).originalStrokeWidth) {
      (path as any).originalStrokeWidth = path.strokeWidth;
    }
    path.strokeWidth = (path as any).originalStrokeWidth + 1; // 稍微加粗但不太明显

    setSelectedPath(path);
    console.log('选择路径并启用编辑模式:', path);
    console.log('路径段数:', path.segments.length);
  }, [selectedPath]);

  // 取消路径选择
  const handlePathDeselect = useCallback(() => {
    if (selectedPath) {
      selectedPath.selected = false;
      selectedPath.fullySelected = false;
      // 恢复原始线宽
      if ((selectedPath as any).originalStrokeWidth) {
        selectedPath.strokeWidth = (selectedPath as any).originalStrokeWidth;
      }
      setSelectedPath(null);
      console.log('取消路径选择');
    }
  }, [selectedPath]);

  // 开始选择框绘制
  const startSelectionBox = useCallback((point: paper.Point) => {
    setIsSelectionDragging(true);
    setSelectionStartPoint(point);

    // 创建选择框
    const rect = new paper.Rectangle(point, point);
    selectionBoxRef.current = new paper.Path.Rectangle(rect);
    selectionBoxRef.current.strokeColor = new paper.Color('#007AFF');
    selectionBoxRef.current.strokeWidth = 1;
    selectionBoxRef.current.dashArray = [5, 5];
    selectionBoxRef.current.fillColor = new paper.Color(0, 122, 255, 0.1); // 半透明蓝色
    // 标记为辅助元素，不显示在图层列表中
    selectionBoxRef.current.data = { isHelper: true, type: 'selection-box' };

    console.log('开始选择框拖拽');
  }, []);

  // 更新选择框
  const updateSelectionBox = useCallback((currentPoint: paper.Point) => {
    if (!isSelectionDragging || !selectionStartPoint || !selectionBoxRef.current) return;

    // 更新选择框大小
    const rect = new paper.Rectangle(selectionStartPoint, currentPoint);
    selectionBoxRef.current.remove();
    selectionBoxRef.current = new paper.Path.Rectangle(rect);
    selectionBoxRef.current.strokeColor = new paper.Color('#007AFF');
    selectionBoxRef.current.strokeWidth = 1;
    selectionBoxRef.current.dashArray = [5, 5];
    selectionBoxRef.current.fillColor = new paper.Color(0, 122, 255, 0.1);
    // 标记为辅助元素，不显示在图层列表中
    selectionBoxRef.current.data = { isHelper: true, type: 'selection-box' };
  }, [isSelectionDragging, selectionStartPoint]);

  // 完成选择框并选择框内对象
  const finishSelectionBox = useCallback((endPoint: paper.Point) => {
    if (!isSelectionDragging || !selectionStartPoint) return;

    // 清除选择框
    if (selectionBoxRef.current) {
      selectionBoxRef.current.remove();
      selectionBoxRef.current = null;
    }

    // 创建选择区域
    const selectionRect = new paper.Rectangle(selectionStartPoint, endPoint);
    const selectedPathsInBox: paper.Path[] = [];

    // 收集要选择的对象
    const selectedImages: string[] = [];
    const selectedModels: string[] = [];

    // 检查图片实例是否与选择框相交
    for (const image of imageInstances) {
      const imageBounds = new paper.Rectangle(image.bounds.x, image.bounds.y, image.bounds.width, image.bounds.height);
      if (selectionRect.intersects(imageBounds)) {
        selectedImages.push(image.id);
        console.log('选择框收集图片:', image.id);
      }
    }

    // 检查3D模型实例是否与选择框相交
    for (const model of model3DInstances) {
      const modelBounds = new paper.Rectangle(model.bounds.x, model.bounds.y, model.bounds.width, model.bounds.height);
      if (selectionRect.intersects(modelBounds)) {
        selectedModels.push(model.id);
        console.log('选择框收集3D模型:', model.id);
      }
    }

    // 遍历绘图图层中的所有路径
    const drawingLayer = paper.project.layers.find(layer => layer.name === "drawing");
    if (drawingLayer) {
      drawingLayer.children.forEach((item) => {
        if (item instanceof paper.Path) {
          // 检查路径是否在选择框内
          if (selectionRect.contains(item.bounds)) {
            // 跳过选择区域对象，只处理实际绘制的路径
            if (item.data && (item.data.type === 'image-selection-area' || item.data.type === '3d-model-selection-area')) {
              return; // 跳过选择区域对象
            }

            // 检查是否属于占位符组（2D图片或3D模型占位符）
            let isPlaceholder = false;
            let currentItem: paper.Item = item;

            // 向上遍历父级查找占位符组
            while (currentItem && currentItem.parent) {
              const parent = currentItem.parent;
              if (parent instanceof paper.Group && parent.data) {
                const parentData = parent.data;
                if (parentData.type === 'image-placeholder' || parentData.type === '3d-model-placeholder') {
                  isPlaceholder = true;
                  break;
                }
              }
              currentItem = parent as paper.Item;
            }

            // 只选择非占位符的路径
            if (!isPlaceholder) {
              selectedPathsInBox.push(item);
            }
          }
        }
      });
    }

    // 更新选择状态
    if (selectedPathsInBox.length > 0) {
      // 清除之前的选择
      selectedPaths.forEach(path => {
        path.selected = false;
        if ((path as any).originalStrokeWidth) {
          path.strokeWidth = (path as any).originalStrokeWidth;
        }
      });

      // 选择框内的所有路径，启用编辑模式
      selectedPathsInBox.forEach(path => {
        path.selected = true;
        path.fullySelected = true; // 显示所有控制点
        if (!(path as any).originalStrokeWidth) {
          (path as any).originalStrokeWidth = path.strokeWidth;
        }
        path.strokeWidth = (path as any).originalStrokeWidth + 1;
      });

      setSelectedPaths(selectedPathsInBox);
      setSelectedPath(null); // 清除单个选择
      console.log(`选择了${selectedPathsInBox.length}个路径`);
    }

    // 处理图片和3D模型的选择（在选择框完成后）
    if (selectedImages.length > 0) {
      // 目前只支持选择单个图片，取第一个
      handleImageSelect(selectedImages[0]);
      console.log(`选择框选中图片: ${selectedImages[0]}`);
    } else if (selectedModels.length > 0) {
      // 目前只支持选择单个3D模型，取第一个
      handleModel3DSelect(selectedModels[0]);
      console.log(`选择框选中3D模型: ${selectedModels[0]}`);
    }

    // 重置状态
    setIsSelectionDragging(false);
    setSelectionStartPoint(null);
  }, [isSelectionDragging, selectionStartPoint, selectedPaths, handleImageSelect, handleModel3DSelect, imageInstances, model3DInstances]);

  // 清除所有选择
  const clearAllSelections = useCallback(() => {
    // 清除单个路径选择
    handlePathDeselect();

    // 清除多个路径选择
    selectedPaths.forEach(path => {
      path.selected = false;
      path.fullySelected = false;
      if ((path as any).originalStrokeWidth) {
        path.strokeWidth = (path as any).originalStrokeWidth;
      }
    });
    setSelectedPaths([]);

    // 清除其他选择
    handleModel3DDeselect();
    handleImageDeselect();
  }, [selectedPaths, handlePathDeselect, handleModel3DDeselect, handleImageDeselect]);

  // 检测鼠标位置是否在控制点上
  const getSegmentAt = useCallback((point: paper.Point, path: paper.Path): paper.Segment | null => {
    if (!path.segments) return null;

    const tolerance = 8 / zoom; // 根据缩放调整容差

    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i];
      const distance = segment.point.getDistance(point);
      if (distance <= tolerance) {
        return segment;
      }
    }
    return null;
  }, [zoom]);

  // 开始拖拽控制点
  const startSegmentDrag = useCallback((segment: paper.Segment, startPoint: paper.Point) => {
    setIsSegmentDragging(true);
    setDraggedSegment(segment);
    setDragStartPoint(startPoint);
    console.log('开始拖拽控制点');
  }, []);

  // 更新控制点位置
  const updateSegmentDrag = useCallback((currentPoint: paper.Point) => {
    if (!isSegmentDragging || !draggedSegment) return;

    draggedSegment.point = currentPoint;
    console.log('更新控制点位置:', currentPoint);
  }, [isSegmentDragging, draggedSegment]);

  // 结束控制点拖拽
  const finishSegmentDrag = useCallback(() => {
    if (isSegmentDragging) {
      setIsSegmentDragging(false);
      setDraggedSegment(null);
      setDragStartPoint(null);
      console.log('结束控制点拖拽');
    }
  }, [isSegmentDragging]);

  // 开始拖拽整个路径
  const startPathDrag = useCallback((path: paper.Path, startPoint: paper.Point) => {
    setIsPathDragging(true);
    setDraggedPath(path);
    setDragStartPoint(startPoint);
    console.log('开始拖拽路径');
  }, []);

  // 更新路径位置
  const updatePathDrag = useCallback((currentPoint: paper.Point) => {
    if (!isPathDragging || !draggedPath || !dragStartPoint) return;

    const delta = currentPoint.subtract(dragStartPoint);
    draggedPath.translate(delta);
    setDragStartPoint(currentPoint);
    console.log('更新路径位置');
  }, [isPathDragging, draggedPath, dragStartPoint]);

  // 结束路径拖拽
  const finishPathDrag = useCallback(() => {
    if (isPathDragging) {
      setIsPathDragging(false);
      setDraggedPath(null);
      setDragStartPoint(null);
      console.log('结束路径拖拽');
    }
  }, [isPathDragging]);

  // 同步图片和3D模型的可见性状态
  const syncVisibilityStates = useCallback(() => {
    // 同步图片可见性
    setImageInstances(prev => prev.map(image => {
      const paperGroup = paper.project.layers.flatMap(layer =>
        layer.children.filter(child =>
          child.data?.type === 'image' && child.data?.imageId === image.id
        )
      )[0];

      if (paperGroup) {
        return { ...image, visible: paperGroup.visible };
      }
      return image;
    }));

    // 同步3D模型可见性
    setModel3DInstances(prev => prev.map(model => {
      const paperGroup = paper.project.layers.flatMap(layer =>
        layer.children.filter(child =>
          child.data?.type === '3d-model' && child.data?.modelId === model.id
        )
      )[0];

      if (paperGroup) {
        return { ...model, visible: paperGroup.visible };
      }
      return model;
    }));
  }, []);

  // 监听图层可见性变化事件
  useEffect(() => {
    const handleVisibilitySync = () => {
      syncVisibilityStates();
    };

    window.addEventListener('layerVisibilityChanged', handleVisibilitySync);

    return () => {
      window.removeEventListener('layerVisibilityChanged', handleVisibilitySync);
    };
  }, [syncVisibilityStates]);

  // 将图片和3D模型实例暴露给图层面板使用
  useEffect(() => {
    (window as any).tanvaImageInstances = imageInstances;
    (window as any).tanvaModel3DInstances = model3DInstances;
  }, [imageInstances, model3DInstances]);

  // 监听图层顺序变化并更新图像的layerId
  useEffect(() => {
    // 更新所有图像实例的layerId（如果它们的Paper.js组在不同图层）
    const updateImageLayerIds = () => {
      setImageInstances(prev => prev.map(image => {
        // 查找对应的Paper.js图像组
        const imageGroup = paper.project?.layers?.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && 
            child.data?.imageId === image.id
          )
        )[0];

        if (imageGroup && imageGroup.layer) {
          const layerName = imageGroup.layer.name;
          if (layerName && layerName.startsWith('layer_')) {
            const newLayerId = layerName.replace('layer_', '');
            if (newLayerId !== image.layerId) {
              return { ...image, layerId: newLayerId };
            }
          }
        }
        return image;
      }));
    };

    // 监听图层变化事件
    const handleLayerOrderChanged = () => {
      updateImageLayerIds();
    };

    window.addEventListener('layerOrderChanged', handleLayerOrderChanged);

    // 也定期检查以确保同步
    const intervalId = setInterval(updateImageLayerIds, 1000);

    return () => {
      window.removeEventListener('layerOrderChanged', handleLayerOrderChanged);
      clearInterval(intervalId);
    };
  }, []);

  // 处理图片移动
  const handleImageMove = useCallback((imageId: string, newPosition: { x: number; y: number }) => {
    setImageInstances(prev => prev.map(image => {
      if (image.id === imageId) {
        const newBounds = { ...image.bounds, x: newPosition.x, y: newPosition.y };

        // 更新对应的Paper.js图片组
        const imageGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId === imageId
          )
        )[0];

        if (imageGroup && imageGroup instanceof paper.Group) {
          // 直接设置组的新位置，所有子元素会一起移动
          imageGroup.position = new paper.Point(
            newPosition.x + image.bounds.width / 2,
            newPosition.y + image.bounds.height / 2
          );
        }

        // 更新对应的Paper.js选择区域
        if (image.selectionRect) {
          image.selectionRect.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        }

        return { ...image, bounds: newBounds };
      }
      return image;
    }));
  }, []);

  // 处理图片调整大小
  const handleImageResize = useCallback((imageId: string, newBounds: { x: number; y: number; width: number; height: number }) => {
    setImageInstances(prev => prev.map(image => {
      if (image.id === imageId) {
        // 更新对应的Paper.js图片组
        const imageGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId === imageId
          )
        )[0];

        if (imageGroup && imageGroup instanceof paper.Group) {
          // 找到所有需要更新的子元素
          const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster;
          const interactRect = imageGroup.children.find(child => 
            child instanceof paper.Path && !child.data?.isSelectionBorder && !child.data?.isResizeHandle
          ) as paper.Path;
          const selectionBorder = imageGroup.children.find(child => 
            child.data?.isSelectionBorder
          ) as paper.Path;
          const resizeHandles = imageGroup.children.filter(child => 
            child.data?.isResizeHandle
          ) as paper.Path[];
          
          // 直接更新各个元素的位置，不依赖Group的自动管理
          if (raster) {
            raster.bounds = new paper.Rectangle(
              newBounds.x,
              newBounds.y,
              newBounds.width,
              newBounds.height
            );
          }
          
          if (interactRect) {
            interactRect.bounds = new paper.Rectangle(
              newBounds.x,
              newBounds.y,
              newBounds.width,
              newBounds.height
            );
          }
          
          if (selectionBorder) {
            selectionBorder.bounds = new paper.Rectangle(
              newBounds.x,
              newBounds.y,
              newBounds.width,
              newBounds.height
            );
          }
          
          // 更新控制点位置
          const handleSize = 8;
          resizeHandles.forEach(handle => {
            const direction = handle.data?.direction;
            if (direction === 'nw') {
              handle.position = new paper.Point(
                newBounds.x,
                newBounds.y
              );
            } else if (direction === 'ne') {
              handle.position = new paper.Point(
                newBounds.x + newBounds.width,
                newBounds.y
              );
            } else if (direction === 'sw') {
              handle.position = new paper.Point(
                newBounds.x,
                newBounds.y + newBounds.height
              );
            } else if (direction === 'se') {
              handle.position = new paper.Point(
                newBounds.x + newBounds.width,
                newBounds.y + newBounds.height
              );
            }
          });
        }

        // 更新对应的Paper.js选择区域
        if (image.selectionRect) {
          image.selectionRect.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        }

        return { ...image, bounds: newBounds };
      }
      return image;
    }));
  }, []);

  // 处理3D模型移动
  const handleModel3DMove = useCallback((modelId: string, newPosition: { x: number; y: number }) => {
    setModel3DInstances(prev => prev.map(model => {
      if (model.id === modelId) {
        const newBounds = { ...model.bounds, x: newPosition.x, y: newPosition.y };

        // 更新对应的Paper.js模型组
        const modelGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === '3d-model' && child.data?.modelId === modelId
          )
        )[0];

        if (modelGroup) {
          modelGroup.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        }

        // 更新对应的Paper.js选择区域
        if (model.selectionRect) {
          model.selectionRect.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        }

        return { ...model, bounds: newBounds };
      }
      return model;
    }));
  }, []);

  // 处理3D模型调整大小
  const handleModel3DResize = useCallback((modelId: string, newBounds: { x: number; y: number; width: number; height: number }) => {
    setModel3DInstances(prev => prev.map(model => {
      if (model.id === modelId) {
        // 更新对应的Paper.js模型组
        const modelGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === '3d-model' && child.data?.modelId === modelId
          )
        )[0];

        if (modelGroup) {
          modelGroup.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        }

        // 更新对应的Paper.js选择区域
        if (model.selectionRect) {
          model.selectionRect.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        }

        return { ...model, bounds: newBounds };
      }
      return model;
    }));
  }, []);

  // 橡皮擦功能 - 删除与橡皮擦路径相交的绘图内容
  const performErase = useCallback((eraserPath: paper.Path) => {
    const drawingLayer = ensureDrawingLayer();
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
  }, [strokeWidth, ensureDrawingLayer]);

  // 完成绘制
  const finishDraw = useCallback(() => {
    // 处理画线类工具的特殊情况：如果用户只是点击而没有拖拽，清理状态
    if ((drawMode === 'free' || drawMode === 'rect' || drawMode === 'circle') && !pathRef.current && initialClickPointRef.current) {
      // 用户只是点击了但没有拖拽，清理状态
      initialClickPointRef.current = null;
      hasMovedRef.current = false;
      isDrawingRef.current = false;
      return;
    }

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

      // 触发 Paper.js 的 change 事件，确保图层面板更新
      if (paper.project) {
        paper.project.emit('change');
      }
    }

    // 清理所有绘制状态
    isDrawingRef.current = false;
    initialClickPointRef.current = null;
    hasMovedRef.current = false;
  }, [isEraser, performErase, drawMode, createImagePlaceholder, create3DModelPlaceholder, setDrawMode]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;

    // 鼠标按下事件处理
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return; // 只响应左键点击

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // 转换为 Paper.js 坐标系
      const point = paper.view.viewToProject(new paper.Point(x, y));

      // 在选择模式下进行点击检测
      if (drawMode === 'select') {
        // 首先检查是否点击在图像的调整控制点上
        const resizeHandleHit = paper.project.hitTest(point, {
          fill: true,
          tolerance: 5 / zoom
        });
        
        if (resizeHandleHit && resizeHandleHit.item.data?.isResizeHandle) {
          // 开始图像调整大小
          const imageId = resizeHandleHit.item.data.imageId;
          const direction = resizeHandleHit.item.data.direction;
          
          // 获取图像组
          const imageGroup = paper.project.layers.flatMap(layer =>
            layer.children.filter(child =>
              child.data?.type === 'image' && child.data?.imageId === imageId
            )
          )[0];
          
          if (imageGroup) {
            // 获取实际的图片边界（Raster的边界），而不是整个组的边界
            const raster = imageGroup.children.find(child => child instanceof paper.Raster);
            const actualBounds = raster ? raster.bounds.clone() : imageGroup.bounds.clone();
            
            setIsImageResizing(true);
            setResizeImageId(imageId);
            setResizeDirection(direction);
            setResizeStartBounds(actualBounds);
            setResizeStartPoint(point);
          }
          return;
        }
        
        // 如果有选中的路径，检查是否点击在控制点上
        if (selectedPath) {
          const segment = getSegmentAt(point, selectedPath);
          if (segment) {
            // 点击在控制点上，开始控制点拖拽
            startSegmentDrag(segment, point);
            return;
          }

          // 检查是否点击在路径本身上（非控制点）
          const pathHitResult = paper.project.hitTest(point, {
            stroke: true,
            tolerance: 5 / zoom
          });

          if (pathHitResult && pathHitResult.item === selectedPath) {
            // 点击在路径上，开始路径拖拽
            startPathDrag(selectedPath, point);
            return;
          }
        }

        // 使用Paper.js的hitTest进行点击检测
        const hitResult = paper.project.hitTest(point, {
          segments: true,
          stroke: true,
          fill: true,
          tolerance: 5 / zoom // 根据缩放调整容差
        });

        // 首先检查是否点击在图片或3D模型区域内
        let imageClicked = null;
        let modelClicked = null;

        // 检查图片实例
        for (const image of imageInstances) {
          if (point.x >= image.bounds.x &&
            point.x <= image.bounds.x + image.bounds.width &&
            point.y >= image.bounds.y &&
            point.y <= image.bounds.y + image.bounds.height) {
            imageClicked = image.id;
            // 如果点击的是已选中的图像，准备开始拖拽
            if (image.isSelected) {
              setIsImageDragging(true);
              setDragImageId(image.id);
              setImageDragStartPoint(point);
              setImageDragStartBounds({ x: image.bounds.x, y: image.bounds.y });
            }
            break;
          }
        }

        // 如果没有点击图片，检查3D模型实例
        if (!imageClicked) {
          for (const model of model3DInstances) {
            if (point.x >= model.bounds.x &&
              point.x <= model.bounds.x + model.bounds.width &&
              point.y >= model.bounds.y &&
              point.y <= model.bounds.y + model.bounds.height) {
              modelClicked = model.id;
              break;
            }
          }
        }

        if (imageClicked) {
          // 如果图片未选中，先选中它
          const clickedImage = imageInstances.find(img => img.id === imageClicked);
          if (!clickedImage?.isSelected) {
            clearAllSelections();
            handleImageSelect(imageClicked);
            console.log('选中图片:', imageClicked);
          }
          // 如果已经选中，拖拽状态已经在上面设置
        } else if (modelClicked) {
          // 选中3D模型
          clearAllSelections();
          handleModel3DSelect(modelClicked);
          console.log('选中3D模型:', modelClicked);
        } else if (hitResult && hitResult.item instanceof paper.Path) {
          // 检查路径是否在网格图层或其他背景图层中，如果是则不选择
          const path = hitResult.item as paper.Path;
          const pathLayer = path.layer;

          if (pathLayer && (pathLayer.name === "grid" || pathLayer.name === "background")) {
            console.log('忽略背景/网格图层中的对象');
            // 取消所有选择
            clearAllSelections();
            // 开始选择框拖拽
            startSelectionBox(point);
          } else {
            // 检查是否属于占位符组（2D图片或3D模型占位符）
            let isPlaceholder = false;
            let currentItem: paper.Item = hitResult.item;

            // 向上遍历父级查找占位符组
            while (currentItem && currentItem.parent) {
              const parent = currentItem.parent;
              if (parent instanceof paper.Group && parent.data) {
                const parentData = parent.data;
                if (parentData.type === 'image-placeholder' || parentData.type === '3d-model-placeholder') {
                  isPlaceholder = true;
                  console.log('忽略占位符中的对象:', parentData.type);
                  break;
                }
              }
              currentItem = parent as paper.Item;
            }

            if (isPlaceholder) {
              // 取消所有选择，开始选择框拖拽
              clearAllSelections();
              startSelectionBox(point);
            } else {
              // 点击到了有效路径，选择它
              clearAllSelections(); // 先清除之前的选择
              handlePathSelect(path);
              console.log('选中路径:', path);
            }
          }
        } else {
          // 点击空白区域，先取消所有选择
          clearAllSelections();
          console.log('点击空白区域，取消所有选择');

          // 然后开始选择框拖拽
          startSelectionBox(point);
        }
        return;
      }

      console.log(`🎨 开始绘制: 模式=${drawMode}, 坐标=(${x.toFixed(1)}, ${y.toFixed(1)})`);

      if (drawMode === 'free') {
        // 开始自由绘制
        startFreeDraw(point);
      } else if (drawMode === 'line') {
        // 直线绘制模式：第一次点击开始，第二次点击完成
        if (!pathRef.current || !(pathRef.current as any).startPoint) {
          // 第一次点击：开始绘制直线（仅记录起始位置）
          initialClickPointRef.current = point;
          hasMovedRef.current = false;
          startLineDraw(point);
          // 直线模式使用拖拽检测机制
        } else {
          // 第二次点击：完成直线绘制
          finishLineDraw(point);
        }
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
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const point = paper.view.viewToProject(new paper.Point(x, y));

      // 在选择模式下处理各种拖拽
      if (drawMode === 'select') {
        // 处理控制点拖拽
        if (isSegmentDragging) {
          updateSegmentDrag(point);
          return;
        }

        // 处理路径拖拽
        if (isPathDragging) {
          updatePathDrag(point);
          return;
        }
        
        // 处理图像拖拽
        if (isImageDragging && dragImageId && imageDragStartPoint && imageDragStartBounds) {
          const deltaX = point.x - imageDragStartPoint.x;
          const deltaY = point.y - imageDragStartPoint.y;
          
          // 更新图像位置
          handleImageMove(dragImageId, {
            x: imageDragStartBounds.x + deltaX,
            y: imageDragStartBounds.y + deltaY
          });
          
          // 强制Paper.js重新渲染
          paper.view.update();
          return;
        }
        
        // 处理图像调整大小
        if (isImageResizing && resizeImageId && resizeDirection && resizeStartBounds && resizeStartPoint) {
          // 获取原始宽高比
          const aspectRatio = resizeStartBounds.width / resizeStartBounds.height;
          
          let newBounds = resizeStartBounds.clone();
          
          // 根据拖拽方向调整边界，保持宽高比
          // 使用更精确的方式：让控制点跟随鼠标，同时保持宽高比
          
          if (resizeDirection === 'se') {
            // 右下角：计算鼠标到左上角的向量
            const dx = point.x - resizeStartBounds.x;
            const dy = point.y - resizeStartBounds.y;
            
            // 将鼠标位置投影到保持宽高比的对角线上
            // 对角线方向向量: (1, 1/aspectRatio)
            const diagonalX = 1;
            const diagonalY = 1 / aspectRatio;
            
            // 计算投影长度
            const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);
            
            // 计算新的宽高
            newBounds.width = Math.max(50, projectionLength * diagonalX);
            newBounds.height = newBounds.width / aspectRatio;
            
          } else if (resizeDirection === 'nw') {
            // 左上角：计算鼠标到右下角的向量
            const dx = resizeStartBounds.right - point.x;
            const dy = resizeStartBounds.bottom - point.y;
            
            // 将鼠标位置投影到保持宽高比的对角线上
            const diagonalX = 1;
            const diagonalY = 1 / aspectRatio;
            
            // 计算投影长度
            const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);
            
            // 计算新的宽高
            newBounds.width = Math.max(50, projectionLength * diagonalX);
            newBounds.height = newBounds.width / aspectRatio;
            newBounds.x = resizeStartBounds.right - newBounds.width;
            newBounds.y = resizeStartBounds.bottom - newBounds.height;
            
          } else if (resizeDirection === 'ne') {
            // 右上角：计算鼠标到左下角的向量
            const dx = point.x - resizeStartBounds.x;
            const dy = resizeStartBounds.bottom - point.y;
            
            // 将鼠标位置投影到保持宽高比的对角线上
            const diagonalX = 1;
            const diagonalY = 1 / aspectRatio;
            
            // 计算投影长度
            const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);
            
            // 计算新的宽高
            newBounds.width = Math.max(50, projectionLength * diagonalX);
            newBounds.height = newBounds.width / aspectRatio;
            newBounds.y = resizeStartBounds.bottom - newBounds.height;
            
          } else if (resizeDirection === 'sw') {
            // 左下角：计算鼠标到右上角的向量
            const dx = resizeStartBounds.right - point.x;
            const dy = point.y - resizeStartBounds.y;
            
            // 将鼠标位置投影到保持宽高比的对角线上
            const diagonalX = 1;
            const diagonalY = 1 / aspectRatio;
            
            // 计算投影长度
            const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);
            
            // 计算新的宽高
            newBounds.width = Math.max(50, projectionLength * diagonalX);
            newBounds.height = newBounds.width / aspectRatio;
            newBounds.x = resizeStartBounds.right - newBounds.width;
          }
          
          // 更新图像边界
          handleImageResize(resizeImageId, {
            x: newBounds.x,
            y: newBounds.y,
            width: newBounds.width,
            height: newBounds.height
          });
          
          // 强制Paper.js重新渲染
          paper.view.update();
          
          return;
        }

        // 处理选择框拖拽
        if (isSelectionDragging) {
          updateSelectionBox(point);
          return;
        }

        // 鼠标悬停时更改光标样式
        // 首先检查是否悬停在图像调整控制点上
        const hoverHit = paper.project.hitTest(point, {
          fill: true,
          tolerance: 5 / zoom
        });
        
        if (hoverHit && hoverHit.item.data?.isResizeHandle) {
          const direction = hoverHit.item.data.direction;
          if (direction === 'nw' || direction === 'se') {
            canvas.style.cursor = 'nwse-resize';
          } else if (direction === 'ne' || direction === 'sw') {
            canvas.style.cursor = 'nesw-resize';
          }
          return;
        }
        
        // 检查是否悬停在已选中的图像上
        for (const image of imageInstances) {
          if (image.isSelected &&
              point.x >= image.bounds.x &&
              point.x <= image.bounds.x + image.bounds.width &&
              point.y >= image.bounds.y &&
              point.y <= image.bounds.y + image.bounds.height) {
            canvas.style.cursor = 'move';
            return;
          }
        }
        
        if (selectedPath) {
          const segment = getSegmentAt(point, selectedPath);
          if (segment) {
            canvas.style.cursor = 'crosshair'; // 控制点上显示十字光标
            return;
          }

          const hitResult = paper.project.hitTest(point, {
            stroke: true,
            tolerance: 5 / zoom
          });

          if (hitResult && hitResult.item === selectedPath) {
            canvas.style.cursor = 'move'; // 路径上显示移动光标
            return;
          }
        }

        canvas.style.cursor = 'default'; // 默认光标
        return;
      }

      // 直线模式：检查拖拽阈值或跟随鼠标
      if (drawMode === 'line') {
        // 如果有初始点击位置且未移动，检查阈值
        if (initialClickPointRef.current && !hasMovedRef.current) {
          const distance = initialClickPointRef.current.getDistance(point);
          if (distance >= DRAG_THRESHOLD) {
            hasMovedRef.current = true;
            createLinePath(initialClickPointRef.current);
          }
        }
        // 如果正在绘制直线，跟随鼠标
        if (pathRef.current && (pathRef.current as any).startPoint) {
          updateLineDraw(point);
        }
        return;
      }

      // 检查是否正在绘制
      if (!isDrawingRef.current) return;

      // 对于自由绘制模式，pathRef.current 可能还未创建（延迟创建机制）
      if (drawMode === 'free') {
        // 继续自由绘制
        continueFreeDraw(point);
      } else if (drawMode === 'rect') {
        // 更新矩形
        updateRectDraw(point);
      } else if (drawMode === 'circle') {
        // 更新圆形
        updateCircleDraw(point);
      } else if (drawMode === 'image' && pathRef.current) {
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
      } else if (drawMode === '3d-model' && pathRef.current) {
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
    const handleMouseUp = (event: MouseEvent) => {
      // 在选择模式下处理各种拖拽结束
      if (drawMode === 'select') {
        // 处理控制点拖拽结束
        if (isSegmentDragging) {
          finishSegmentDrag();
          return;
        }

        // 处理路径拖拽结束
        if (isPathDragging) {
          finishPathDrag();
          return;
        }
        
        // 处理图像拖拽结束
        if (isImageDragging) {
          setIsImageDragging(false);
          setDragImageId(null);
          setImageDragStartPoint(null);
          setImageDragStartBounds(null);
          return;
        }
        
        // 处理图像调整大小结束
        if (isImageResizing) {
          setIsImageResizing(false);
          setResizeImageId(null);
          setResizeDirection(null);
          setResizeStartBounds(null);
          setResizeStartPoint(null);
          // 不需要重新选择，控制点已经在拖动过程中更新了
          return;
        }

        // 处理选择框完成
        if (isSelectionDragging) {
          const rect = canvas.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const point = paper.view.viewToProject(new paper.Point(x, y));
          finishSelectionBox(point);
          return;
        }
      }

      // 直线模式：如果只是点击没有拖拽，重置状态
      if (drawMode === 'line' && initialClickPointRef.current && !hasMovedRef.current) {
        initialClickPointRef.current = null;
        hasMovedRef.current = false;
        return;
      }

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
  }, [canvasRef, drawMode, currentColor, strokeWidth, isEraser, zoom, startFreeDraw, continueFreeDraw, createFreeDrawPath, startLineDraw, updateLineDraw, finishLineDraw, createLinePath, startRectDraw, updateRectDraw, createRectPath, startCircleDraw, updateCircleDraw, createCirclePath, finishDraw, handleModel3DDeselect, handleImageDeselect, handlePathSelect, handlePathDeselect, startSelectionBox, updateSelectionBox, finishSelectionBox, clearAllSelections, isSelectionDragging, getSegmentAt, startSegmentDrag, updateSegmentDrag, finishSegmentDrag, startPathDrag, updatePathDrag, finishPathDrag, isSegmentDragging, isPathDragging, selectedPath, imageInstances, model3DInstances, handleImageSelect, handleModel3DSelect, isImageDragging, dragImageId, imageDragStartPoint, imageDragStartBounds, handleImageMove, handleImageResize, isImageResizing, resizeImageId, resizeDirection, resizeStartBounds, resizeStartPoint]);

  // 监听图层面板的选择事件
  useEffect(() => {
    const handleLayerItemSelected = (event: CustomEvent) => {
      const { item, type, itemId } = event.detail;
      
      console.log('收到图层面板选择事件:', type, itemId);
      
      // 清除之前的所有选择
      clearAllSelections();
      
      // 根据类型进行相应的选择处理
      if (type === 'image') {
        // 对于图片，查找对应的imageId并选择
        const imageData = item.data;
        if (imageData?.imageId) {
          handleImageSelect(imageData.imageId);
        }
      } else if (type === 'model3d') {
        // 对于3D模型，查找对应的modelId并选择
        const modelData = item.data;
        if (modelData?.modelId) {
          handleModel3DSelect(modelData.modelId);
        }
      } else if (item instanceof paper.Path) {
        // 对于路径，使用统一的路径选择逻辑
        handlePathSelect(item);
      }
    };

    // 添加事件监听器
    window.addEventListener('layerItemSelected', handleLayerItemSelected as EventListener);

    return () => {
      // 清理事件监听器
      window.removeEventListener('layerItemSelected', handleLayerItemSelected as EventListener);
    };
  }, [clearAllSelections, handleImageSelect, handleModel3DSelect, handlePathSelect]);

  return (
    <>
      {/* 图片上传组件 */}
      <ImageUploadComponent
        onImageUploaded={handleImageUploaded}
        onUploadError={handleImageUploadError}
        trigger={triggerImageUpload}
        onTriggerHandled={handleUploadTriggerHandled}
      />

      {/* 图片现在完全在Paper.js中渲染和管理，不再需要React组件 */}

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
          modelId={model.id}
          bounds={model.bounds}
          isSelected={model.isSelected}
          visible={model.visible}
          drawMode={drawMode}
          isSelectionDragging={isSelectionDragging}
          onSelect={() => handleModel3DSelect(model.id)}
          onMove={(newPosition) => handleModel3DMove(model.id, newPosition)}
          onResize={(newBounds) => handleModel3DResize(model.id, newBounds)}
        />
      ))}
    </>
  );
};

export default DrawingController;