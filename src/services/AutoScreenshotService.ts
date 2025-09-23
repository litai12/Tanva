/**
 * 自动截图服务
 * 提供一键截图功能，自动计算所有元素边界并生成高质量截图
 */

import paper from 'paper';
import * as THREE from 'three';
import { BoundsCalculator, type ContentBounds } from '@/utils/BoundsCalculator';
import type { ImageInstance, Model3DInstance } from '@/types/canvas';
import { logger } from '@/utils/logger';

export interface ScreenshotOptions {
  /** 输出图片格式 */
  format?: 'png' | 'jpeg' | 'svg';
  /** 图片质量 (0.0-1.0, 仅对jpeg有效) */
  quality?: number;
  /** 输出分辨率倍数 */
  scale?: number;
  /** 自定义边距 */
  padding?: number;
  /** 是否包含背景色 */
  includeBackground?: boolean;
  /** 背景色 */
  backgroundColor?: string;
  /** 是否自动下载 */
  autoDownload?: boolean;
  /** 文件名前缀 */
  filename?: string;
  /** 生成完成后的回调函数，用于自定义处理截图数据 */
  onComplete?: (dataUrl: string, filename: string) => void;
}

export interface ScreenshotResult {
  success: boolean;
  dataUrl?: string;
  blob?: Blob;
  error?: string;
  bounds?: ContentBounds;
  filename?: string;
}

export interface DrawableElement {
  type: 'paper' | 'image' | 'model3d';
  layerIndex: number;
  bounds: { x: number; y: number; width: number; height: number };
  data: any; // Paper.js Item, ImageInstance, or Model3DInstance
}

export class AutoScreenshotService {
  private static readonly DEFAULT_OPTIONS: Required<ScreenshotOptions> = {
    format: 'png',
    quality: 0.92,
    scale: 2, // 2x分辨率，提高清晰度
    padding: 0, // 移除默认边距，使截图尺寸与内容完全匹配
    includeBackground: true,
    backgroundColor: '#ffffff',
    autoDownload: false, // 改为默认不自动下载，改为传入AI对话框
    filename: 'artboard-screenshot'
  };

  /**
   * 执行自动截图
   * @param imageInstances 图片实例
   * @param model3DInstances 3D模型实例
   * @param options 截图选项
   */
  static async captureAutoScreenshot(
    imageInstances: ImageInstance[],
    model3DInstances: Model3DInstance[],
    options: ScreenshotOptions = {}
  ): Promise<ScreenshotResult> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    try {
      logger.debug('🖼️ 开始自动截图...');
      
      // 1. 计算内容边界
      const contentBounds = BoundsCalculator.calculateContentBounds(
        imageInstances,
        model3DInstances,
        opts.padding
      );

      if (contentBounds.isEmpty) {
        return {
          success: false,
          error: '画布中没有可截图的内容'
        };
      }

      logger.debug('📐 计算得到内容边界:', contentBounds);

      // 2. 创建截图画布
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('无法创建Canvas上下文');
      }

      // 设置画布尺寸
      const outputWidth = Math.ceil(contentBounds.width * opts.scale);
      const outputHeight = Math.ceil(contentBounds.height * opts.scale);
      canvas.width = outputWidth;
      canvas.height = outputHeight;

      // 设置高DPI支持
      ctx.scale(opts.scale, opts.scale);

      // 3. 设置裁剪区域，确保所有绘制内容都在截图边界内
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, contentBounds.width, contentBounds.height);
      ctx.clip();
      console.log(`🔲 设置裁剪区域: 0,0 ${contentBounds.width}x${contentBounds.height}`);

      // 4. 绘制背景
      if (opts.includeBackground) {
        ctx.fillStyle = opts.backgroundColor;
        ctx.fillRect(0, 0, contentBounds.width, contentBounds.height);
      }

      // 5. 收集并按层级排序所有元素
      const sortedElements = this.collectAndSortAllElements(imageInstances, model3DInstances);
      
      // 6. 按正确的层级顺序绘制所有元素
      await this.drawElementsByOrder(ctx, contentBounds, sortedElements);
      
      // 7. 恢复裁剪区域
      ctx.restore();

      // 8. 生成最终结果
      const result = await this.generateResult(canvas, opts, contentBounds);
      
      logger.debug('✅ 截图生成完成');
      return result;

    } catch (error) {
      logger.error('❌ 截图生成失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }

  /**
   * 收集并按层级排序所有可绘制元素
   */
  private static collectAndSortAllElements(
    imageInstances: ImageInstance[],
    model3DInstances: Model3DInstance[]
  ): DrawableElement[] {
    const elements: DrawableElement[] = [];

    // 1. 收集Paper.js元素
    console.log('🔍 开始收集Paper.js元素...');
    
    if (paper.project && paper.project.layers) {
      console.log(`📋 Paper.js项目信息: 找到 ${paper.project.layers.length} 个图层`);
      
      for (const layer of paper.project.layers) {
        const layerIndex = paper.project.layers.indexOf(layer);
        
        console.log(`📊 检查图层 ${layerIndex}: ${layer.name || '未命名'} (可见: ${layer.visible}, 子元素数: ${layer.children.length})`);
        
        if (!layer.visible) {
          console.log(`⏭️ 跳过不可见图层: ${layerIndex}`);
          continue;
        }
        
        console.log(`✨ 处理可见图层 ${layerIndex}: 开始遍历 ${layer.children.length} 个子元素`);
        
        for (let itemIndex = 0; itemIndex < layer.children.length; itemIndex++) {
          const item = layer.children[itemIndex];
          
          // 跳过辅助元素
          if (item.data?.isHelper) continue;
          if (!item.visible) continue;

          // 记录所有遍历的元素（调试信息）
          console.log(`🔍 检查元素: ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`, {
            visible: item.visible,
            isHelper: item.data?.isHelper,
            hasSegments: item instanceof paper.Path ? item.segments?.length || 0 : 'N/A',
            hasBounds: !!item.bounds,
            boundsValid: item.bounds ? `${Math.round(item.bounds.x)},${Math.round(item.bounds.y)} ${Math.round(item.bounds.width)}x${Math.round(item.bounds.height)}` : 'N/A'
          });

          // 收集所有有效的内容元素，移除过于严格的边界检查
          if ((item instanceof paper.Path && item.segments && item.segments.length > 0) ||
              (item instanceof paper.Group) ||
              (item instanceof paper.Raster && !item.data?.isHelper) ||
              (item instanceof paper.PointText)) {
            
            // 宽松的边界验证：只要item.bounds存在就收集（移除严格的相交检查）
            if (item.bounds) {
              // 精确计算层级：图层索引 * 1000 + 元素在图层中的索引
              const preciseLayerIndex = layerIndex * 1000 + itemIndex;
              
              console.log(`✅ 收集Paper.js元素: ${item.className} (layer: ${preciseLayerIndex})`, {
                bounds: `${Math.round(item.bounds.x)},${Math.round(item.bounds.y)} ${Math.round(item.bounds.width)}x${Math.round(item.bounds.height)}`,
                segments: item instanceof paper.Path ? item.segments.length : 'N/A',
                strokeColor: item instanceof paper.Path && item.strokeColor ? item.strokeColor.toCSS() : 'N/A',
                strokeWidth: item instanceof paper.Path ? item.strokeWidth : 'N/A',
                isCircle: item instanceof paper.Path.Circle,
                radius: item instanceof paper.Path.Circle ? (item as any).radius : 'N/A'
              });
              
              elements.push({
                type: 'paper',
                layerIndex: preciseLayerIndex,
                bounds: {
                  x: item.bounds.x,
                  y: item.bounds.y,
                  width: item.bounds.width,
                  height: item.bounds.height
                },
                data: item
              });
            } else {
              console.warn(`⚠️ 跳过无边界的Paper.js元素: ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`);
            }
          } else {
            console.log(`⏭️ 跳过非内容元素: ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`, {
              reason: item instanceof paper.Path ? 
                (!item.segments ? '无segments' : item.segments.length === 0 ? 'segments为空' : '通过Path检查') :
                item instanceof paper.Group ? '不是Group' : 
                item instanceof paper.Raster ? (item.data?.isHelper ? '是辅助元素' : '通过Raster检查') :
                '不匹配任何类型'
            });
          }
        }
        
        console.log(`✅ 图层 ${layerIndex} 处理完成`);
      }
      
      console.log('✅ Paper.js元素收集完成');
    } else {
      console.warn('⚠️ 未找到Paper.js项目或图层');
    }

    // 2. 收集图片实例
    const visibleImages = imageInstances.filter(img => img.visible);
    console.log(`🖼️ 收集图片实例: 找到 ${visibleImages.length} 个可见图片`);
    
    for (const image of visibleImages) {
      // 图片实例使用其真实的 layerIndex，乘以1000确保在正确的图层级别
      const imageLayerIndex = (image.layerIndex || 0) * 1000;
      
      console.log(`✅ 收集图片实例: ${image.id} (layer: ${imageLayerIndex})`, {
        bounds: `${Math.round(image.bounds.x)},${Math.round(image.bounds.y)} ${Math.round(image.bounds.width)}x${Math.round(image.bounds.height)}`,
        layerIndex: imageLayerIndex,
        visible: image.visible
      });
      
      elements.push({
        type: 'image',
        layerIndex: imageLayerIndex,
        bounds: image.bounds,
        data: image
      });
    }

    // 3. 收集3D模型实例
    const visibleModels = model3DInstances.filter(model => model.visible);
    console.log(`🎭 收集3D模型实例: 找到 ${visibleModels.length} 个可见模型`);
    
    for (const model of visibleModels) {
      // 3D模型在截图中默认置于最上层，避免被2D线条遮挡
      // 采用一个远高于Paper层的权重，必要时可改为读取显式zIndex
      const modelLayerIndex = 1_000_000_000; // always on top
      
      console.log(`✅ 收集3D模型实例: ${model.id} (layer: ${modelLayerIndex})`, {
        bounds: `${Math.round(model.bounds.x)},${Math.round(model.bounds.y)} ${Math.round(model.bounds.width)}x${Math.round(model.bounds.height)}`,
        layerIndex: modelLayerIndex,
        visible: model.visible
      });
      
      elements.push({
        type: 'model3d',
        layerIndex: modelLayerIndex,
        bounds: model.bounds,
        data: model
      });
    }

    // 4. 按层级排序（从底层到顶层）
    elements.sort((a, b) => a.layerIndex - b.layerIndex);
    
    // 详细的收集统计信息
    const stats = {
      totalElements: elements.length,
      paperElements: elements.filter(el => el.type === 'paper').length,
      imageElements: elements.filter(el => el.type === 'image').length,
      model3dElements: elements.filter(el => el.type === 'model3d').length,
      paperPaths: elements.filter(el => el.type === 'paper' && el.data instanceof paper.Path).length,
      paperGroups: elements.filter(el => el.type === 'paper' && el.data instanceof paper.Group).length,
      paperRasters: elements.filter(el => el.type === 'paper' && el.data instanceof paper.Raster).length
    };
    
    console.log('📈 元素收集统计:', stats);
    
    logger.debug('📋 收集到的元素排序结果:', elements.map(el => ({
      type: el.type,
      layerIndex: el.layerIndex,
      className: el.data.className || el.data.constructor?.name || 'unknown',
      id: el.data.id || 'unknown',
      bounds: `${Math.round(el.bounds.x)},${Math.round(el.bounds.y)} ${Math.round(el.bounds.width)}x${Math.round(el.bounds.height)}`,
      segments: el.data instanceof paper.Path ? el.data.segments?.length : 'N/A',
      strokeColor: el.data instanceof paper.Path && el.data.strokeColor ? el.data.strokeColor.toCSS() : 'N/A'
    })));
    
    console.log('🎯 截图元素绘制顺序:', elements.map((el, index) => 
      `${index + 1}. [${el.type}] Layer:${el.layerIndex} ${el.data.className || el.data.constructor?.name} ID:${el.data.id || 'unknown'} Segments:${el.data instanceof paper.Path ? el.data.segments?.length || 0 : 'N/A'}`
    ).join('\n'));

    return elements;
  }

  /**
   * 按顺序绘制所有元素
   */
  private static async drawElementsByOrder(
    ctx: CanvasRenderingContext2D,
    bounds: ContentBounds,
    elements: DrawableElement[]
  ): Promise<void> {
    logger.debug('🎨 开始按层级顺序绘制元素...');
    
    for (const element of elements) {
      try {
        switch (element.type) {
          case 'paper':
            await this.drawSinglePaperElement(ctx, bounds, element.data);
            break;
          case 'image':
            await this.drawSingleImageInstance(ctx, bounds, element.data);
            break;
          case 'model3d':
            await this.drawSingleModel3DInstance(ctx, bounds, element.data);
            break;
        }
      } catch (error) {
        logger.warn(`绘制元素失败 (${element.type}, layer: ${element.layerIndex}):`, error);
        continue;
      }
    }
    
    logger.debug('✅ 所有元素绘制完成');
  }

  /**
   * 绘制单个Paper.js元素
   */
  private static async drawSinglePaperElement(
    ctx: CanvasRenderingContext2D,
    bounds: ContentBounds,
    item: paper.Item
  ): Promise<void> {
    ctx.save();
    ctx.translate(-bounds.x, -bounds.y);

    try {
      if (item instanceof paper.Path && item.segments && item.segments.length > 0) {
        this.drawPaperPath(ctx, item);
      } else if (item instanceof paper.Group) {
        this.drawPaperGroup(ctx, item);
      } else if (item instanceof paper.Raster && !item.data?.isHelper) {
        await this.drawPaperRaster(ctx, item);
      } else if (item instanceof paper.PointText) {
        this.drawPaperText(ctx, item);
      }
    } finally {
      ctx.restore();
    }
  }

  /**
   * 绘制单个图片实例
   */
  private static async drawSingleImageInstance(
    ctx: CanvasRenderingContext2D,
    bounds: ContentBounds,
    imageInstance: ImageInstance
  ): Promise<void> {
    // 计算图片在截图中的相对位置
    const relativeX = imageInstance.bounds.x - bounds.x;
    const relativeY = imageInstance.bounds.y - bounds.y;

    // 加载图片
    const img = await this.loadImageFromSrc(imageInstance.imageData.src);
    
    // 绘制图片
    ctx.drawImage(
      img,
      relativeX,
      relativeY,
      imageInstance.bounds.width,
      imageInstance.bounds.height
    );
  }

  /**
   * 绘制单个3D模型实例
   */
  private static async drawSingleModel3DInstance(
    ctx: CanvasRenderingContext2D,
    bounds: ContentBounds,
    modelInstance: Model3DInstance
  ): Promise<void> {
    // 计算模型在截图中的相对位置
    const relativeX = modelInstance.bounds.x - bounds.x;
    const relativeY = modelInstance.bounds.y - bounds.y;

    // 查找对应的Canvas元素
    const modelCanvas = this.find3DCanvas(modelInstance.id);
    if (modelCanvas) {
      // 确保Canvas内容是最新的
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });
      
      // 绘制3D模型内容
      ctx.drawImage(
        modelCanvas,
        relativeX,
        relativeY,
        modelInstance.bounds.width,
        modelInstance.bounds.height
      );
    } else {
      logger.warn(`无法找到3D模型 ${modelInstance.id} 的Canvas元素`);
    }
  }

  /**
   * 绘制Paper.js内容到Canvas
   */
  private static async drawPaperJSContent(
    ctx: CanvasRenderingContext2D,
    bounds: ContentBounds
  ): Promise<void> {
    if (!paper.project || !paper.view) {
      logger.warn('Paper.js项目或视图未初始化');
      return;
    }

    try {
      logger.debug('🎨 开始绘制Paper.js内容...');
      
      // 创建临时画布用于离屏渲染，避免影响主视图
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = Math.ceil(bounds.width);
      tempCanvas.height = Math.ceil(bounds.height);
      const tempCtx = tempCanvas.getContext('2d');
      
      if (!tempCtx) {
        throw new Error('无法创建临时画布上下文');
      }

      // 设置变换矩阵，将Paper.js世界坐标映射到临时画布
      tempCtx.save();
      tempCtx.translate(-bounds.x, -bounds.y);

      // 遍历所有图层和元素进行手动绘制
      for (const layer of paper.project.layers) {
        if (!layer.visible) continue;

        for (const item of layer.children) {
          // 跳过辅助元素
          if (item.data?.isHelper) continue;
          if (!item.visible) continue;

          // 检查元素是否在截图边界内
          if (!item.bounds || !this.boundsIntersect(bounds, {
            x: item.bounds.x,
            y: item.bounds.y,
            width: item.bounds.width,
            height: item.bounds.height
          })) {
            continue;
          }

          try {
            // 使用Paper.js的内置绘制方法
            if (item instanceof paper.Path && item.segments && item.segments.length > 0) {
              this.drawPaperPath(tempCtx, item);
            } else if (item instanceof paper.Group) {
              this.drawPaperGroup(tempCtx, item);
            } else if (item instanceof paper.Raster && !item.data?.isHelper) {
              await this.drawPaperRaster(tempCtx, item);
            } else if (item instanceof paper.PointText) {
              this.drawPaperText(tempCtx, item);
            }
          } catch (itemError) {
            logger.warn(`绘制Paper.js元素失败:`, itemError);
            continue;
          }
        }
      }

      tempCtx.restore();

      // 将临时画布内容绘制到主画布
      ctx.drawImage(tempCanvas, 0, 0);
      
      logger.debug('✅ Paper.js内容绘制完成');

    } catch (error) {
      logger.warn('Paper.js内容绘制失败:', error);
      // 继续执行，不阻断整个截图过程
    }
  }

  /**
   * 绘制Paper.js路径（增强版，支持圆形特殊处理）
   */
  private static drawPaperPath(ctx: CanvasRenderingContext2D, path: paper.Path): void {
    if (!path.segments || path.segments.length === 0) return;

    ctx.save();

    // 设置样式
    if (path.strokeColor) {
      ctx.strokeStyle = path.strokeColor.toCSS(true);
      ctx.lineWidth = path.strokeWidth || 1;
      ctx.lineCap = path.strokeCap as CanvasLineCap || 'round';
      ctx.lineJoin = path.strokeJoin as CanvasLineJoin || 'round';
    }

    if (path.fillColor) {
      ctx.fillStyle = path.fillColor.toCSS(true);
    }

    // 增强圆形检测：检查多种可能的圆形标识
    const isCircle = path instanceof paper.Path.Circle || 
                    path.className === 'Path.Circle' ||
                    (path as any).radius !== undefined ||
                    (path as any).isCirclePath === true; // 我们自定义的圆形标识
    
    const isLikelyCircle = path.segments.length === 4 && 
                         path.closed && 
                         Math.abs(path.bounds.width - path.bounds.height) < 1; // 宽高接近相等
    
    // 特殊处理：如果是圆形，使用Canvas原生的arc方法以保证完美的圆形
    if (isCircle || isLikelyCircle) {
      const center = path.position;
      const radius = (path as any).radius || (Math.min(path.bounds.width, path.bounds.height) / 2);
      
      console.log('🔍 检测到圆形，使用arc方法绘制:', {
        center: { x: center.x, y: center.y },
        radius: radius,
        bounds: `${path.bounds.x},${path.bounds.y} ${path.bounds.width}x${path.bounds.height}`,
        className: path.className,
        isCircleInstance: path instanceof paper.Path.Circle,
        hasRadiusProperty: (path as any).radius !== undefined,
        segments: path.segments.length,
        isLikelyCircle: isLikelyCircle
      });
      
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
      
      // 填充和描边
      if (path.fillColor) {
        ctx.fill();
      }
      if (path.strokeColor) {
        ctx.stroke();
      }
      
      ctx.restore();
      return;
    }
    
    // 调试：记录非圆形路径信息
    console.log('🔍 绘制一般路径:', {
      className: path.className,
      isCircle: path instanceof paper.Path.Circle,
      segments: path.segments.length,
      closed: path.closed,
      bounds: `${path.bounds.x},${path.bounds.y} ${path.bounds.width}x${path.bounds.height}`,
      widthHeightRatio: path.bounds.width / path.bounds.height
    });

    // 对于其他路径，使用原有的段绘制方法
    ctx.beginPath();
    
    const firstSegment = path.segments[0];
    ctx.moveTo(firstSegment.point.x, firstSegment.point.y);

    for (let i = 1; i < path.segments.length; i++) {
      const segment = path.segments[i];
      const prevSegment = path.segments[i - 1];

      // 处理贝塞尔曲线
      if (prevSegment.handleOut.length > 0 || segment.handleIn.length > 0) {
        ctx.bezierCurveTo(
          prevSegment.point.x + prevSegment.handleOut.x,
          prevSegment.point.y + prevSegment.handleOut.y,
          segment.point.x + segment.handleIn.x,
          segment.point.y + segment.handleIn.y,
          segment.point.x,
          segment.point.y
        );
      } else {
        ctx.lineTo(segment.point.x, segment.point.y);
      }
    }

    // 如果是闭合路径
    if (path.closed) {
      ctx.closePath();
    }

    // 填充和描边
    if (path.fillColor) {
      ctx.fill();
    }
    if (path.strokeColor) {
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制Paper.js文本（PointText）
   */
  private static drawPaperText(ctx: CanvasRenderingContext2D, text: paper.PointText): void {
    ctx.save();

    // 字体与样式
    const fontSize = (text as any).fontSize || 16;
    const fontFamily = (text as any).fontFamily || 'sans-serif';
    const fontStyle = (text as any).fontStyle || 'normal'; // e.g., italic
    const fontWeight = (text as any).fontWeight || 'normal'; // e.g., bold
    ctx.font = `${fontStyle} ${fontWeight} ${Math.round(fontSize)}px ${fontFamily}`.trim();

    // 对齐
    const justification = (text as any).justification || 'left';
    let align: CanvasTextAlign = 'left';
    if (justification === 'center') align = 'center';
    else if (justification === 'right') align = 'right';
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';

    // 颜色
    if (text.fillColor) {
      ctx.fillStyle = text.fillColor.toCSS(true);
    }
    if (text.strokeColor) {
      ctx.strokeStyle = text.strokeColor.toCSS(true);
      ctx.lineWidth = (text as any).strokeWidth || 1;
    }

    // 位置（Paper 的 point 为基线点）
    const p = (text as any).point || text.point || text.position;
    const x = p?.x ?? text.position.x;
    const y = p?.y ?? text.position.y;

    const content = (text as any).content || '';
    const lines = String(content).split(/\r?\n/);
    const leading = (text as any).leading || Math.round(fontSize * 1.2);

    // 旋转（若有）
    const rotation = (text as any).rotation || 0;
    if (rotation) {
      ctx.translate(x, y);
      ctx.rotate((rotation * Math.PI) / 180);
    }

    // 绘制多行文本
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const dx = rotation ? 0 : 0;
      const dy = i * leading;
      if (text.fillColor) ctx.fillText(line, rotation ? 0 : x + dx, rotation ? 0 + dy : y + dy);
      if (text.strokeColor) ctx.strokeText(line, rotation ? 0 : x + dx, rotation ? 0 + dy : y + dy);
    }

    ctx.restore();
  }

  /**
   * 绘制Paper.js组
   */
  private static drawPaperGroup(ctx: CanvasRenderingContext2D, group: paper.Group): void {
    for (const child of group.children) {
      if (!child.visible) continue;

      if (child instanceof paper.Path) {
        this.drawPaperPath(ctx, child);
      } else if (child instanceof paper.Raster && !child.data?.isHelper) {
        this.drawPaperRaster(ctx, child);
      } else if (child instanceof paper.PointText) {
        this.drawPaperText(ctx, child);
      } else if (child instanceof paper.Group) {
        this.drawPaperGroup(ctx, child);
      }
    }
  }

  /**
   * 绘制Paper.js光栅图像
   */
  private static async drawPaperRaster(ctx: CanvasRenderingContext2D, raster: paper.Raster): Promise<void> {
    if (!raster.image || !raster.bounds) return;

    try {
      ctx.save();
      
      // 绘制图像到指定边界
      ctx.drawImage(
        raster.image,
        raster.bounds.x,
        raster.bounds.y,
        raster.bounds.width,
        raster.bounds.height
      );
      
      ctx.restore();
    } catch (error) {
      logger.warn('绘制Paper.js光栅图像失败:', error);
    }
  }

  /**
   * 检查两个边界是否相交
   */
  private static boundsIntersect(a: ContentBounds, b: { x: number; y: number; width: number; height: number }): boolean {
    return !(
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y
    );
  }

  /**
   * 绘制图片实例到Canvas
   */
  private static async drawImageInstances(
    ctx: CanvasRenderingContext2D,
    bounds: ContentBounds,
    imageInstances: ImageInstance[]
  ): Promise<void> {
    const visibleImages = imageInstances.filter(img => img.visible);
    
    for (const imageInstance of visibleImages) {
      try {
        // 计算图片在截图中的相对位置
        const relativeX = imageInstance.bounds.x - bounds.x;
        const relativeY = imageInstance.bounds.y - bounds.y;

        // 加载图片
        const img = await this.loadImageFromSrc(imageInstance.imageData.src);
        
        // 绘制图片
        ctx.drawImage(
          img,
          relativeX,
          relativeY,
          imageInstance.bounds.width,
          imageInstance.bounds.height
        );

      } catch (error) {
        logger.warn(`图片 ${imageInstance.id} 绘制失败:`, error);
        // 继续处理其他图片
      }
    }
  }

  /**
   * 绘制3D模型实例到Canvas
   */
  private static async draw3DModelInstances(
    ctx: CanvasRenderingContext2D,
    bounds: ContentBounds,
    model3DInstances: Model3DInstance[]
  ): Promise<void> {
    const visibleModels = model3DInstances.filter(model => model.visible);
    
    logger.debug(`开始绘制3D模型，共 ${visibleModels.length} 个可见模型`);

    for (const modelInstance of visibleModels) {
      try {
        // 计算模型在截图中的相对位置
        const relativeX = modelInstance.bounds.x - bounds.x;
        const relativeY = modelInstance.bounds.y - bounds.y;

        logger.debug(`处理3D模型 ${modelInstance.id}:`, {
          bounds: modelInstance.bounds,
          relativePosition: { x: relativeX, y: relativeY }
        });

        // 查找对应的Canvas元素
        const modelCanvas = this.find3DCanvas(modelInstance.id);
        if (modelCanvas) {
          // 确保Canvas内容是最新的
          await new Promise(resolve => {
            // 给Three.js一点时间完成渲染
            requestAnimationFrame(() => {
              requestAnimationFrame(resolve);
            });
          });

          logger.debug(`绘制3D模型 ${modelInstance.id} 到截图`, {
            canvasSize: { width: modelCanvas.width, height: modelCanvas.height },
            targetSize: { width: modelInstance.bounds.width, height: modelInstance.bounds.height },
            position: { x: relativeX, y: relativeY }
          });
          
          // 绘制3D模型内容
          ctx.drawImage(
            modelCanvas,
            relativeX,
            relativeY,
            modelInstance.bounds.width,
            modelInstance.bounds.height
          );
        } else {
          logger.warn(`无法找到3D模型 ${modelInstance.id} 的Canvas元素`);
        }

      } catch (error) {
        logger.warn(`3D模型 ${modelInstance.id} 绘制失败:`, error);
        // 继续处理其他模型
      }
    }
  }

  /**
   * 查找指定3D模型的Canvas元素并直接绘制
   */
  private static find3DCanvas(modelId: string): HTMLCanvasElement | null {
    try {
      // 查找对应的Model3DContainer DOM元素
      const containerElement = document.querySelector(`[data-model-id="${modelId}"]`);
      if (!containerElement) {
        logger.warn(`找不到3D模型容器: ${modelId}`);
        return null;
      }

      // 查找其中的Canvas元素
      const canvasElement = containerElement.querySelector('canvas');
      if (!canvasElement) {
        logger.warn(`找不到3D模型Canvas: ${modelId}`);
        return null;
      }

      logger.debug(`找到3D模型Canvas: ${modelId}`, {
        width: canvasElement.width,
        height: canvasElement.height
      });

      return canvasElement as HTMLCanvasElement;
    } catch (error) {
      logger.warn(`查找3D Canvas失败 (${modelId}):`, error);
      return null;
    }
  }

  /**
   * 从src加载图片
   */
  private static loadImageFromSrc(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.crossOrigin = 'anonymous'; // 处理跨域图片
      img.src = src;
    });
  }

  /**
   * 生成最终截图结果
   */
  private static async generateResult(
    canvas: HTMLCanvasElement,
    options: Required<ScreenshotOptions>,
    bounds: ContentBounds
  ): Promise<ScreenshotResult> {
    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${options.filename}-${timestamp}.${options.format}`;

    // 生成数据URL
    const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = options.format === 'jpeg' 
      ? canvas.toDataURL(mimeType, options.quality)
      : canvas.toDataURL(mimeType);

    // 生成Blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('无法生成Blob'));
        }
      }, mimeType, options.quality);
    });

    // 自动下载
    if (options.autoDownload && blob) {
      this.downloadBlob(blob, filename);
    }
    
    // 调用完成回调（如果提供）
    if (options.onComplete) {
      options.onComplete(dataUrl, filename);
    }

    return {
      success: true,
      dataUrl,
      blob,
      bounds,
      filename
    };
  }

  /**
   * 下载Blob为文件
   */
  private static downloadBlob(blob: Blob, filename: string): void {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      logger.debug(`📁 截图已保存: ${filename}`);
    } catch (error) {
      logger.error('下载截图失败:', error);
    }
  }

  /**
   * 快速截图（使用默认设置）
   */
  static async quickScreenshot(
    imageInstances: ImageInstance[],
    model3DInstances: Model3DInstance[]
  ): Promise<ScreenshotResult> {
    return this.captureAutoScreenshot(imageInstances, model3DInstances);
  }
}
