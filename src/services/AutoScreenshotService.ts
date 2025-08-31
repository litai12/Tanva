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
}

export interface ScreenshotResult {
  success: boolean;
  dataUrl?: string;
  blob?: Blob;
  error?: string;
  bounds?: ContentBounds;
  filename?: string;
}

export class AutoScreenshotService {
  private static readonly DEFAULT_OPTIONS: Required<ScreenshotOptions> = {
    format: 'png',
    quality: 0.92,
    scale: 2, // 2x分辨率，提高清晰度
    padding: 50,
    includeBackground: true,
    backgroundColor: '#ffffff',
    autoDownload: true,
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

      // 3. 绘制背景
      if (opts.includeBackground) {
        ctx.fillStyle = opts.backgroundColor;
        ctx.fillRect(0, 0, contentBounds.width, contentBounds.height);
      }

      // 4. 绘制Paper.js内容
      await this.drawPaperJSContent(ctx, contentBounds);

      // 5. 绘制图片内容
      await this.drawImageInstances(ctx, contentBounds, imageInstances);

      // 6. 绘制3D模型内容
      await this.draw3DModelInstances(ctx, contentBounds, model3DInstances);

      // 7. 生成最终结果
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
   * 绘制Paper.js路径
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

    // 构建路径
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
   * 绘制Paper.js组
   */
  private static drawPaperGroup(ctx: CanvasRenderingContext2D, group: paper.Group): void {
    for (const child of group.children) {
      if (!child.visible) continue;

      if (child instanceof paper.Path) {
        this.drawPaperPath(ctx, child);
      } else if (child instanceof paper.Raster && !child.data?.isHelper) {
        this.drawPaperRaster(ctx, child);
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