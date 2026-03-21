// @ts-nocheck
/**
 * 自动截图服务
 * 提供一键截图功能，自动计算所有元素边界并生成高质量截图
 */

import paper from 'paper';
import * as THREE from 'three';
import { BoundsCalculator, type ContentBounds } from '@/utils/BoundsCalculator';
import { trimTransparentPng } from '@/utils/imageHelper';
import type { ImageInstance, Model3DInstance } from '@/types/canvas';
import { logger } from '@/utils/logger';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { toRenderableImageSrc } from '@/utils/imageSource';
import { canvasToBlob, canvasToDataUrl, dataUrlToBlob } from '@/utils/imageConcurrency';

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
  /** 外部传入的选中状态（优先于自动检测） */
  selection?: {
    paperItems?: paper.Item[];
    imageIds?: string[];
    modelIds?: string[];
  };
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

interface SelectionState {
  hasSelection: boolean;
  selectedImages: ImageInstance[];
  selectedModels: Model3DInstance[];
  selectedPaperItems: paper.Item[];
  selectedImageIds: Set<string>;
  selectedModelIds: Set<string>;
  selectedPaperItemsSet: Set<paper.Item>;
}

interface Model3DFrameCaptureResult {
  success: boolean;
  frameDataUrl?: string;
}

export class AutoScreenshotService {
  private static readonly DEFAULT_OPTIONS: Required<ScreenshotOptions> = {
    format: 'png',
    quality: 0.92,
    scale: 2, // 2x分辨率，提高清晰度
    padding: 0, // 移除默认边距，使截图尺寸与内容完全匹配
    includeBackground: false, // PNG 默认不绘制背景，便于透明裁剪
    backgroundColor: '#ffffff',
    autoDownload: false, // 改为默认不自动下载，改为传入AI对话框
    filename: 'artboard-screenshot'
  };
  private static currentImageOrderMap: Map<string, number> | null = null;
  private static currentModelOrderMap: Map<string, number> | null = null;

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
    
    let restoreSelectionVisuals: (() => void) | null = null;
    let restoreFlowHandles: (() => void) | null = null;
    this.currentImageOrderMap = new Map(
      imageInstances.map((img, index) => [img.id, index])
    );
    this.currentModelOrderMap = new Map(
      model3DInstances.map((model, index) => [model.id, index])
    );

    try {
      logger.debug('🖼️ 开始自动截图...');
      restoreFlowHandles = this.hideReactFlowHandles();
      
      let selectionState = this.detectSelection(imageInstances, model3DInstances);

      if (opts.selection) {
        const manualPaperItems = opts.selection.paperItems?.filter((item): item is paper.Item => !!item) ?? [];
        const manualImageIds = new Set(opts.selection.imageIds ?? []);
        const manualModelIds = new Set(opts.selection.modelIds ?? []);

        const selectedImages = imageInstances.filter((img) => manualImageIds.has(img.id));
        const selectedModels = model3DInstances.filter((model) => manualModelIds.has(model.id));
        const selectedPaperItems = manualPaperItems.filter((item) => item.visible && !(item.data as any)?.isHelper);

        selectionState = {
          hasSelection:
            selectedImages.length > 0 ||
            selectedModels.length > 0 ||
            selectedPaperItems.length > 0,
          selectedImages,
          selectedModels,
          selectedPaperItems,
          selectedImageIds: manualImageIds,
          selectedModelIds: manualModelIds,
          selectedPaperItemsSet: new Set(selectedPaperItems),
        };
      }
      restoreSelectionVisuals = this.temporarilySuppressSelectionVisuals(selectionState);
      let restrictToSelection = selectionState.hasSelection;

      if (selectionState.hasSelection) {
        logger.debug('🎯 检测到选中元素，尝试局部截图', {
          selectedImages: selectionState.selectedImages.length,
          selectedModels: selectionState.selectedModels.length,
          selectedPaperItems: selectionState.selectedPaperItems.length
        });
      } else {
        logger.debug('📸 未检测到选中元素，执行全量截图');
      }

      // 1. 计算内容边界
      let contentBounds: ContentBounds;

      if (selectionState.hasSelection) {
        const selectionBounds = BoundsCalculator.calculateSelectionBounds(
          selectionState.selectedImages,
          selectionState.selectedModels,
          selectionState.selectedPaperItems,
          opts.padding
        );

        if (!selectionBounds.isEmpty) {
          contentBounds = selectionBounds;
        } else {
          logger.debug('⚠️ 选中元素未生成有效边界，回退为全量截图');
          restrictToSelection = false;
          contentBounds = BoundsCalculator.calculateContentBounds(
            imageInstances,
            model3DInstances,
            opts.padding
          );
        }
      } else {
        contentBounds = BoundsCalculator.calculateContentBounds(
          imageInstances,
          model3DInstances,
          opts.padding
        );
      }

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
      logger.debug(`🔲 设置裁剪区域: 0,0 ${contentBounds.width}x${contentBounds.height}`);

      // 4. 绘制背景
      if (opts.includeBackground) {
        ctx.fillStyle = opts.backgroundColor;
        ctx.fillRect(0, 0, contentBounds.width, contentBounds.height);
      }

      // 5. 收集并按层级排序所有元素
      const sortedElements = this.collectAndSortAllElements(
        imageInstances,
        model3DInstances,
        restrictToSelection ? selectionState : undefined
      );
      
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
    } finally {
      this.currentImageOrderMap = null;
      this.currentModelOrderMap = null;
      try {
        restoreSelectionVisuals?.();
      } catch (restoreError) {
        logger.warn('恢复选中样式失败:', restoreError);
      }
      try {
        restoreFlowHandles?.();
      } catch (restoreHandlesError) {
        logger.warn('恢复Flow句柄可见性失败:', restoreHandlesError);
      }
    }
  }

  /**
   * 收集并按层级排序所有可绘制元素
   */
  private static collectAndSortAllElements(
    imageInstances: ImageInstance[],
    model3DInstances: Model3DInstance[],
    selection?: SelectionState
  ): DrawableElement[] {
    const elements: DrawableElement[] = [];
    const selectedOnly = selection?.hasSelection ?? false;
    const selectedImageIds = selection?.selectedImageIds ?? new Set<string>();
    const selectedModelIds = selection?.selectedModelIds ?? new Set<string>();

    // 如果只针对选中元素，则走简化路径，避免收集非选中内容
    if (selectedOnly && selection) {
      return this.collectElementsForSelection(selection);
    }

    // 1. 收集Paper.js元素
    logger.debug('🔍 开始收集Paper.js元素...');
    
    if (paper.project && paper.project.layers) {
      logger.debug(`📋 Paper.js项目信息: 找到 ${paper.project.layers.length} 个图层`);
      
      for (const layer of paper.project.layers) {
        const layerIndex = paper.project.layers.indexOf(layer);
        
        logger.debug(`📊 检查图层 ${layerIndex}: ${layer.name || '未命名'} (可见: ${layer.visible}, 子元素数: ${layer.children.length})`);
        
        if (!layer.visible) {
          logger.debug(`⏭️ 跳过不可见图层: ${layerIndex}`);
          continue;
        }
        
        logger.debug(`✨ 处理可见图层 ${layerIndex}: 开始遍历 ${layer.children.length} 个子元素`);
        
        for (let itemIndex = 0; itemIndex < layer.children.length; itemIndex++) {
          const item = layer.children[itemIndex];
          
          // 跳过辅助元素
          if (item.data?.isHelper) continue;
          if (!item.visible) continue;

          // 记录所有遍历的元素（调试信息）
          logger.debug(`🔍 检查元素: ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`, {
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
              if (selectedOnly && !this.shouldIncludePaperItem(item, selection!)) {
                logger.debug(`⏭️ 跳过未选中的Paper元素: ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`);
                continue;
              }
              // 精确计算层级：图层索引 * 1000 + 元素在图层中的索引
              const preciseLayerIndex = layerIndex * 1000 + itemIndex;

              if (selectedOnly && item instanceof paper.Group && !selection!.selectedPaperItemsSet.has(item)) {
                this.collectGroupChildrenForSelection(item, preciseLayerIndex, selection!, elements);
                continue;
              }
              const itemRect = (item as any)?.strokeBounds || item.bounds;
              if (!itemRect) {
                logger.debug(`⚠️ 跳过无有效边界的Paper.js元素: ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`);
                continue;
              }
              
              logger.debug(`✅ 收集Paper.js元素: ${item.className} (layer: ${preciseLayerIndex})`, {
                bounds: `${Math.round(itemRect.x)},${Math.round(itemRect.y)} ${Math.round(itemRect.width)}x${Math.round(itemRect.height)}`,
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
                  x: itemRect.x,
                  y: itemRect.y,
                  width: Math.max(itemRect.width ?? 0, 1),
                  height: Math.max(itemRect.height ?? 0, 1)
                },
                data: item
              });
            } else {
              if (selectedOnly && !this.shouldIncludePaperItem(item, selection!)) {
                logger.debug(`⏭️ 跳过未选中的Paper元素(无边界): ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`);
                continue;
              }
              logger.debug(`⚠️ 跳过无边界的Paper.js元素: ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`);
            }
          } else {
            logger.debug(`⏭️ 跳过非内容元素: ${item.className} (layer: ${layerIndex}, item: ${itemIndex})`, {
              reason: item instanceof paper.Path ? 
                (!item.segments ? '无segments' : item.segments.length === 0 ? 'segments为空' : '通过Path检查') :
                item instanceof paper.Group ? '不是Group' : 
                item instanceof paper.Raster ? (item.data?.isHelper ? '是辅助元素' : '通过Raster检查') :
                '不匹配任何类型'
            });
          }
        }
        
        logger.debug(`✅ 图层 ${layerIndex} 处理完成`);
      }
      
      logger.debug('✅ Paper.js元素收集完成');
    } else {
      logger.warn('⚠️ 未找到Paper.js项目或图层');
    }

    // 2. 不再单独收集图片实例，直接依赖 Paper.Raster；避免“实例边界未更新”导致裁切异常

    // 3. 收集3D模型实例
    const visibleModels = model3DInstances.filter(model => model.visible);
    logger.debug(`🎭 收集3D模型实例: 找到 ${visibleModels.length} 个可见模型`);
    
    for (const model of visibleModels) {
      if (selectedOnly && !selectedModelIds.has(model.id)) {
        logger.debug(`⏭️ 跳过未选中的3D模型实例: ${model.id}`);
        continue;
      }

      // 3D模型在截图中默认置于最上层，避免被2D线条遮挡
      // 采用一个远高于Paper层的权重，必要时可改为读取显式zIndex
      const modelLayerIndex = 1_000_000_000; // always on top
      
      logger.debug(`✅ 收集3D模型实例: ${model.id} (layer: ${modelLayerIndex})`, {
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

    // 3. 按层级排序（从底层到顶层）
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
    
    logger.debug('📈 元素收集统计:', stats);
    
    logger.debug('📋 收集到的元素排序结果:', elements.map(el => ({
      type: el.type,
      layerIndex: el.layerIndex,
      className: el.data.className || el.data.constructor?.name || 'unknown',
      id: el.data.id || 'unknown',
      bounds: `${Math.round(el.bounds.x)},${Math.round(el.bounds.y)} ${Math.round(el.bounds.width)}x${Math.round(el.bounds.height)}`,
      segments: el.data instanceof paper.Path ? el.data.segments?.length : 'N/A',
      strokeColor: el.data instanceof paper.Path && el.data.strokeColor ? el.data.strokeColor.toCSS() : 'N/A'
    })));
    
    logger.debug('🎯 截图元素绘制顺序:', elements.map((el, index) => 
      `${index + 1}. [${el.type}] Layer:${el.layerIndex} ${el.data.className || el.data.constructor?.name} ID:${el.data.id || 'unknown'} Segments:${el.data instanceof paper.Path ? el.data.segments?.length || 0 : 'N/A'}`
    ).join('\n'));

    return elements;
  }

  private static collectGroupChildrenForSelection(
    group: paper.Group,
    baseLayerIndex: number,
    selection: SelectionState,
    elements: DrawableElement[]
  ): void {
    if (!group || !group.children) return;

    group.children.forEach((child, childIndex) => {
      if (!child || !child.visible || child.data?.isHelper) return;
      if (!this.shouldIncludePaperItem(child, selection)) return;

      const childLayerIndex = baseLayerIndex + (childIndex + 1) / 1000;

      if (child instanceof paper.Group) {
        this.collectGroupChildrenForSelection(child, childLayerIndex, selection, elements);
        return;
      }

      const rect = (child as any)?.strokeBounds || child.bounds;
      if (!rect) return;
      const width = rect.width ?? 0;
      const height = rect.height ?? 0;
      if (width <= 0 && height <= 0) return;

      elements.push({
        type: 'paper',
        layerIndex: childLayerIndex,
        bounds: {
          x: rect.x,
          y: rect.y,
          width: Math.max(width, 1),
          height: Math.max(height, 1)
        },
        data: child,
      });
    });
  }

  private static collectElementsForSelection(
    selection: SelectionState,
  ): DrawableElement[] {
    const elements: DrawableElement[] = [];
    const seenPaper = new Set<paper.Item>();

    const pushPaperItem = (item: paper.Item) => {
      if (!item || !item.visible) return;
      if ((item.data as any)?.isHelper) return;
      if (seenPaper.has(item)) return;
      seenPaper.add(item);

      const rect = (item as any)?.strokeBounds || item.bounds;
      if (!rect) return;
      const width = rect.width ?? 0;
      const height = rect.height ?? 0;
      if (width <= 0 && height <= 0) return;

      elements.push({
        type: 'paper',
        layerIndex: this.computeLayerOrder(item),
        bounds: {
          x: rect.x,
          y: rect.y,
          width: Math.max(width, 1),
          height: Math.max(height, 1),
        },
        data: item,
      });
    };

    selection.selectedPaperItems.forEach((item) => {
      if (!item) return;
      if (item instanceof paper.Group) {
        item.getItems({ match: (child) => child instanceof paper.Path || child instanceof paper.PointText || child instanceof paper.Raster })
          .forEach((child) => pushPaperItem(child as paper.Item));
      }
      pushPaperItem(item);
    });

    // 选中的图片（使用 selection.selectedImages）
    selection.selectedImages.forEach((image) => {
      if (!image.visible) return;
      const layerIndex = this.computeImageLayerIndex(image, elements.length);
      elements.push({
        type: 'image',
        layerIndex,
        bounds: {
          x: image.bounds.x,
          y: image.bounds.y,
          width: Math.max(image.bounds.width, 1),
          height: Math.max(image.bounds.height, 1),
        },
        data: image,
      });
    });

    // 选中的3D模型
    selection.selectedModels.forEach((model) => {
      if (!model.visible) return;
      const layerIndex = this.computeModelLayerIndex(model, elements.length);
      elements.push({
        type: 'model3d',
        layerIndex,
        bounds: {
          x: model.bounds.x,
          y: model.bounds.y,
          width: Math.max(model.bounds.width, 1),
          height: Math.max(model.bounds.height, 1),
        },
        data: model,
      });
    });

    elements.sort((a, b) => a.layerIndex - b.layerIndex);
    return elements;
  }

  private static computeLayerOrder(item: paper.Item): number {
    const layerIndex = item.layer ? item.layer.index : 0;
    let order = 0;
    let multiplier = 1;
    let current: paper.Item | null = item;

    while (current) {
      const idx = typeof current.index === 'number' ? current.index : 0;
      order += idx * multiplier;
      multiplier *= 100;
      current = current.parent;
    }

    return layerIndex * 1_000_000 + order;
  }

  private static computeImageLayerIndex(image: ImageInstance, fallbackIndex: number): number {
    const group = this.findImageGroup(image.id);
    if (group) {
      return this.computeLayerOrder(group);
    }
    const mapIndex = this.currentImageOrderMap?.get(image.id);
    return 500_000 + (typeof mapIndex === 'number' ? mapIndex : fallbackIndex);
  }

  private static computeModelLayerIndex(model: Model3DInstance, fallbackIndex: number): number {
    const group = this.findModelGroup(model.id);
    if (group) {
      return this.computeLayerOrder(group);
    }
    const mapIndex = this.currentModelOrderMap?.get(model.id);
    return 1_000_000_000 + (typeof mapIndex === 'number' ? mapIndex : fallbackIndex);
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
    const drawFromElement = (
      element: CanvasImageSource,
      sourceBounds: { x: number; y: number; width: number; height: number }
    ) => {
      const relativeX = sourceBounds.x - bounds.x;
      const relativeY = sourceBounds.y - bounds.y;
      ctx.drawImage(
        element,
        relativeX,
        relativeY,
        sourceBounds.width,
        sourceBounds.height
      );
    };

    const sourceCandidates = [
      imageInstance.imageData.localDataUrl,
      imageInstance.imageData.src,
      imageInstance.imageData.url,
    ].filter((value): value is string => Boolean(value));

    let lastError: unknown = null;

    for (const source of sourceCandidates) {
      try {
        const img = await this.loadImageFromSrc(source);
        drawFromElement(img, imageInstance.bounds);
        return;
      } catch (error) {
        lastError = error;
        logger.warn?.('⚠️ 缩略图截图: 图片加载失败，尝试备用来源', {
          imageId: imageInstance.id,
          source,
          error,
        });
      }
    }

    // 尝试从Paper.js中获取已加载的Raster（避免重新请求跨域资源）
    const raster = this.findRasterByImageId(imageInstance.id);
    if (raster?.canvas) {
      try {
        drawFromElement(raster.canvas, {
          x: raster.bounds.x,
          y: raster.bounds.y,
          width: raster.bounds.width,
          height: raster.bounds.height,
        });
        return;
      } catch (error) {
        lastError = error;
        logger.warn?.('⚠️ 缩略图截图: 通过Raster绘制失败', {
          imageId: imageInstance.id,
          error,
        });
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('无法绘制图片实例');
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

    const captureResult = await this.requestModel3DFrameCapture(modelInstance.id);
    if (captureResult.frameDataUrl) {
      try {
        const frameImage = await this.loadImageFromSrc(captureResult.frameDataUrl);
        ctx.drawImage(
          frameImage,
          relativeX,
          relativeY,
          modelInstance.bounds.width,
          modelInstance.bounds.height
        );
        return;
      } catch (error) {
        logger.warn(`使用3D实时帧数据绘制失败 (${modelInstance.id}):`, error);
      }
    }

    // 优先使用 runtime 缓存帧，规避 WebGL drawing buffer 在 demand 模式下被清空导致白图
    const cachedFrame = this.find3DSnapshotImage(modelInstance.id);
    if (cachedFrame) {
      ctx.drawImage(
        cachedFrame,
        relativeX,
        relativeY,
        modelInstance.bounds.width,
        modelInstance.bounds.height
      );
      return;
    }

    // 兜底：直接读取 WebGL canvas
    const modelCanvas = this.find3DCanvas(modelInstance.id);
    if (!modelCanvas) {
      logger.warn(`无法找到3D模型 ${modelInstance.id} 的Canvas元素`);
      return;
    }

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    if (this.isLikelyBlankCanvas(modelCanvas)) {
      logger.warn(`3D模型 ${modelInstance.id} 的WebGL canvas 看起来是空白帧，跳过绘制以避免白图`);
      return;
    }

    ctx.drawImage(
      modelCanvas,
      relativeX,
      relativeY,
      modelInstance.bounds.width,
      modelInstance.bounds.height
    );
  }

  private static requestModel3DFrameCapture(
    modelId: string,
    timeoutMs = 520
  ): Promise<Model3DFrameCaptureResult> {
    if (typeof window === 'undefined') {
      return Promise.resolve({ success: false });
    }
    return new Promise<Model3DFrameCaptureResult>((resolve) => {
      let finished = false;
      let timerId: number | null = null;

      const cleanup = () => {
        window.removeEventListener(
          'tanva:model3d-frame-captured',
          handleCaptured as EventListener
        );
        if (timerId != null) {
          window.clearTimeout(timerId);
          timerId = null;
        }
      };

      const finalize = (result: Model3DFrameCaptureResult) => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(result);
      };

      const handleCaptured = (event: Event) => {
        const customEvent = event as CustomEvent<{
          modelId?: string;
          success?: boolean;
          frameDataUrl?: string;
        }>;
        if (customEvent.detail?.modelId !== modelId) return;
        finalize({
          success: customEvent.detail?.success === true,
          frameDataUrl: customEvent.detail?.frameDataUrl,
        });
      };

      window.addEventListener(
        'tanva:model3d-frame-captured',
        handleCaptured as EventListener
      );

      timerId = window.setTimeout(() => finalize({ success: false }), timeoutMs);

      try {
        window.dispatchEvent(
          new CustomEvent('tanva:model3d-capture-frame', {
            detail: { modelId },
          })
        );
      } catch (error) {
        logger.warn(`请求3D模型帧缓存失败 (${modelId}):`, error);
        finalize({ success: false });
      }
    });
  }

  private static isLikelyBlankCanvas(canvas: HTMLCanvasElement): boolean {
    try {
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return true;
      const sample = document.createElement('canvas');
      sample.width = 24;
      sample.height = 24;
      const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
      if (!sampleCtx) return false;
      sampleCtx.drawImage(canvas, 0, 0, sample.width, sample.height);
      const pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;

      let opaqueCount = 0;
      let nonWhiteCount = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        if (a <= 10) continue;
        opaqueCount += 1;
        if (r < 245 || g < 245 || b < 245) {
          nonWhiteCount += 1;
        }
      }

      if (opaqueCount === 0) return true;
      return nonWhiteCount / opaqueCount < 0.001;
    } catch {
      return false;
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
    if ((path.data as any)?.isHelper) return;
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

    // 对闭合路径补上首尾段，避免圆形被直线闭合
    if (path.closed && path.segments.length > 1) {
      const lastSegment = path.segments[path.segments.length - 1];
      if (lastSegment.handleOut.length > 0 || firstSegment.handleIn.length > 0) {
        ctx.bezierCurveTo(
          lastSegment.point.x + lastSegment.handleOut.x,
          lastSegment.point.y + lastSegment.handleOut.y,
          firstSegment.point.x + firstSegment.handleIn.x,
          firstSegment.point.y + firstSegment.handleIn.y,
          firstSegment.point.x,
          firstSegment.point.y
        );
      } else {
        ctx.lineTo(firstSegment.point.x, firstSegment.point.y);
      }
      ctx.closePath();
    } else if (path.closed) {
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
    if ((text.data as any)?.isHelper) return;

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
    if ((group.data as any)?.isHelper) return;

    for (const child of group.children) {
      if (!child.visible) continue;
      if ((child.data as any)?.isHelper) continue;

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
   * 注意：需要处理跨域图片，避免污染 canvas
   */
  private static async drawPaperRaster(ctx: CanvasRenderingContext2D, raster: paper.Raster): Promise<void> {
    if (!raster.image || !raster.bounds) return;

    try {
      ctx.save();
      
      // 检查是否是跨域图片，如果是则重新加载以设置 crossOrigin
      let imageToDraw: CanvasImageSource = raster.image;
      
      // 如果 raster.image 是 HTMLImageElement 且是跨域图片，需要重新加载
      if (raster.image instanceof HTMLImageElement) {
        const imgSrc = raster.image.src;
        // 检查是否是跨域 URL（不是 data: 或 blob:）
        if (imgSrc && !/^data:/i.test(imgSrc) && !/^blob:/i.test(imgSrc)) {
          // 仅当“确实跨域”且未设置 crossOrigin 时才需要重载；同源（含 /api/assets/proxy）无需重载。
          const failedLoad = raster.image.complete && raster.image.naturalWidth === 0;
          let isCrossOrigin = true;
          try {
            const base =
              typeof window !== 'undefined' && window.location?.origin
                ? window.location.origin
                : '';
            if (base) {
              const normalized = new URL(imgSrc, base);
              isCrossOrigin = normalized.origin !== base;
            }
          } catch {
            isCrossOrigin = true;
          }

          const needsReload = failedLoad || (isCrossOrigin && !raster.image.crossOrigin);
          
          if (needsReload) {
            try {
              // 尝试使用代理 URL 重新加载图片，确保设置 crossOrigin
              const proxiedSrc = toRenderableImageSrc(imgSrc) || proxifyRemoteAssetUrl(imgSrc);
              const cleanImg = await this.loadImageFromSrc(proxiedSrc);
              imageToDraw = cleanImg;
              logger.debug('✅ 跨域图片已重新加载（设置 crossOrigin）', { src: imgSrc });
            } catch (loadError) {
              // 如果重新加载失败，记录警告但继续使用原图片
              // 这可能会导致 canvas 被污染，但至少不会完全失败
              logger.warn('⚠️ 跨域图片重新加载失败，使用原图片（可能导致截图失败）:', {
                src: imgSrc,
                error: loadError
              });
              imageToDraw = raster.image;
            }
          }
        }
      }
      
      // 绘制图像到指定边界
      ctx.drawImage(
        imageToDraw,
        raster.bounds.x,
        raster.bounds.y,
        raster.bounds.width,
        raster.bounds.height
      );
      
      ctx.restore();
    } catch (error) {
      logger.warn('绘制Paper.js光栅图像失败:', error);
      // 不抛出错误，继续处理其他元素
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

  private static temporarilySuppressSelectionVisuals(selection: SelectionState): (() => void) | null {
    if (!selection.hasSelection) return null;
    if (!paper.project || !paper.view || !paper.settings) return null;

    const prevHandleSize = typeof paper.settings.handleSize === 'number' ? paper.settings.handleSize : undefined;
    const prevSelectionColor = paper.settings.selectionColor ? paper.settings.selectionColor.clone?.() ?? paper.settings.selectionColor : null;

    const paperItemStates = selection.selectedPaperItems.map((item) => ({
      item,
      wasSelected: item.selected === true,
      wasFullySelected: Boolean((item as any)?.fullySelected),
      strokeWidth: item instanceof paper.Path ? item.strokeWidth : undefined,
      originalStrokeWidth: item instanceof paper.Path && typeof (item as any)?.originalStrokeWidth === 'number'
        ? (item as any).originalStrokeWidth as number
        : undefined,
    }));

    try {
      paper.settings.handleSize = 0;
      if (paper.settings.selectionColor) {
        paper.settings.selectionColor = new paper.Color(0, 0, 0, 0);
      }
    } catch (error) {
      logger.warn('隐藏选中控制点时设置Paper配置失败:', error);
    }

    for (const state of paperItemStates) {
      const { item, originalStrokeWidth } = state;
      if (item instanceof paper.Path && typeof originalStrokeWidth === 'number') {
        try {
          item.strokeWidth = originalStrokeWidth;
        } catch (err) {
          logger.warn('恢复路径原始线宽失败:', err);
        }
      }

      if (typeof (item as any)?.fullySelected === 'boolean') {
        (item as any).fullySelected = false;
      }
    }

    try { paper.view.update(); } catch {}

    return () => {
      for (const state of paperItemStates) {
        const { item, wasSelected, wasFullySelected, strokeWidth } = state;

        if (item instanceof paper.Path && typeof strokeWidth === 'number') {
          try {
            item.strokeWidth = strokeWidth;
          } catch (err) {
            logger.warn('恢复路径选中线宽失败:', err);
          }
        }

        if (typeof (item as any)?.fullySelected === 'boolean') {
          (item as any).fullySelected = wasFullySelected;
        }

        if (typeof wasSelected === 'boolean') {
          item.selected = wasSelected;
        }
      }

      try {
        if (typeof prevHandleSize === 'number') {
          paper.settings.handleSize = prevHandleSize;
        } else {
          delete paper.settings.handleSize;
        }
        if (prevSelectionColor) {
          paper.settings.selectionColor = prevSelectionColor;
        } else {
          delete paper.settings.selectionColor;
        }
      } catch (error) {
        logger.warn('恢复Paper选中配置失败:', error);
      }

      try { paper.view.update(); } catch {}
    };
  }

  /**
   * 检测当前画布上被选中的元素
   */
  private static detectSelection(
    imageInstances: ImageInstance[],
    model3DInstances: Model3DInstance[]
  ): SelectionState {
    const selectedImages = imageInstances.filter(img => img.isSelected);
    const selectedModels = model3DInstances.filter(model => model.isSelected);
    const selectedPaperItems = this.collectSelectedPaperItems();

    const hasSelection =
      selectedImages.length > 0 ||
      selectedModels.length > 0 ||
      selectedPaperItems.length > 0;

    return {
      hasSelection,
      selectedImages,
      selectedModels,
      selectedPaperItems,
      selectedImageIds: new Set(selectedImages.map(img => img.id)),
      selectedModelIds: new Set(selectedModels.map(model => model.id)),
      selectedPaperItemsSet: new Set(selectedPaperItems),
    };
  }

  /**
   * 收集所有被选中的Paper元素（排除辅助元素）
   */
  private static collectSelectedPaperItems(): paper.Item[] {
    const result = new Set<paper.Item>();

    if (!paper.project || !paper.project.layers) {
      return [];
    }

    const addIfValid = (item: paper.Item | null | undefined) => {
      if (!item) return;
      if ((item.data as any)?.isHelper) return;
      if (!item.visible) return;
      result.add(item);
    };

    try {
      const selected = paper.project.getSelectedItems?.() ?? [];
      selected.forEach(item => addIfValid(item));
    } catch (error) {
      logger.warn('获取Paper选中元素失败:', error);
    }

    const traverse = (item: paper.Item | null | undefined) => {
      if (!item || !item.visible) return;

      if (item.selected && !(item.data as any)?.isHelper) {
        result.add(item);
      }

      if (item instanceof paper.Group) {
        for (const child of item.children) {
          traverse(child);
        }
      }
    };

    for (const layer of paper.project.layers) {
      if (!layer.visible) continue;
      traverse(layer);
    }

    return Array.from(result);
  }

  /**
   * 判断Paper元素是否应包含在截图中
   */
  private static shouldIncludePaperItem(item: paper.Item, selection: SelectionState): boolean {
    if (!selection.hasSelection) return true;
    if (!item || !item.visible) return false;
    if ((item.data as any)?.isHelper) return false;

    if (this.isItemSelectedOrRelated(item, selection, new Set())) {
      return true;
    }

    return false;
  }

  private static isItemSelectedOrRelated(
    item: paper.Item,
    selection: SelectionState,
    visited: Set<paper.Item>
  ): boolean {
    if (!item || visited.has(item)) return false;
    visited.add(item);

    if (selection.selectedPaperItemsSet.has(item)) return true;

    const imageId = this.extractImageIdFromItem(item);
    if (imageId && selection.selectedImageIds.has(imageId)) return true;

    let parent = item.parent;
    while (parent) {
      if (selection.selectedPaperItemsSet.has(parent)) return true;

      const parentImageId = this.extractImageIdFromItem(parent);
      if (parentImageId && selection.selectedImageIds.has(parentImageId)) return true;
      parent = parent.parent;
    }

    if (item instanceof paper.Group) {
      for (const child of item.children) {
        if (this.isItemSelectedOrRelated(child, selection, visited)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 暂时隐藏 React Flow 句柄，避免截图时出现黑色圆点
   */
  private static hideReactFlowHandles(): () => void {
    if (typeof document === 'undefined') {
      return () => {};
    }

    const selectors = [
      '.react-flow__handle',
      '.react-flow__node-resizer-handle',
      '.react-flow__resize-control'
    ];

    const originalStates: Array<{
      el: HTMLElement;
      visibility: string;
      opacity: string;
      pointerEvents: string;
    }> = [];

    try {
      selectors.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((node) => {
          const el = node as HTMLElement | null;
          if (!el || !el.style) return;
          originalStates.push({
            el,
            visibility: el.style.visibility,
            opacity: el.style.opacity,
            pointerEvents: el.style.pointerEvents,
          });
          el.style.visibility = 'hidden';
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        });
      });
    } catch (error) {
      logger.warn('隐藏React Flow句柄失败:', error);
    }

    return () => {
      for (const state of originalStates) {
        const { el } = state;
        if (!el || !el.style) continue;
        el.style.visibility = state.visibility;
        el.style.opacity = state.opacity;
        el.style.pointerEvents = state.pointerEvents;
      }
    };
  }

  private static extractImageIdFromItem(item: paper.Item): string | null {
    const data = item?.data as any;
    if (!data) return null;

    if (typeof data.imageId === 'string') {
      return data.imageId;
    }

    if (data.type === 'image' && typeof data.imageId === 'string') {
      return data.imageId;
    }

    return null;
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
        const src = imageInstance.imageData.url || imageInstance.imageData.src;
        if (!src) continue;
        const img = await this.loadImageFromSrc(src);
        
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

  private static find3DSnapshotImage(modelId: string): HTMLImageElement | null {
    try {
      const containerElement = document.querySelector(`[data-model-id="${modelId}"]`);
      if (!containerElement) return null;

      const snapshotImage = containerElement.querySelector(
        'img[data-model3d-snapshot-cache="true"]'
      ) as HTMLImageElement | null;
      if (!snapshotImage) return null;
      if (!snapshotImage.src || !snapshotImage.complete) return null;
      if ((snapshotImage.naturalWidth ?? 0) <= 0 || (snapshotImage.naturalHeight ?? 0) <= 0) {
        return null;
      }
      if (snapshotImage.dataset.model3dSnapshotSource !== 'runtime') {
        return null;
      }
      return snapshotImage;
    } catch (error) {
      logger.warn(`查找3D缓存帧失败 (${modelId}):`, error);
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
      const finalSrc = toRenderableImageSrc(src) || proxifyRemoteAssetUrl(src);
      if (!/^data:/i.test(finalSrc) && !/^blob:/i.test(finalSrc)) {
        img.crossOrigin = 'anonymous';
      }
      img.src = finalSrc;
    });
  }

  private static findRasterByImageId(imageId: string): paper.Raster | null {
    if (!paper.project || !paper.project.layers) return null;

    for (const layer of paper.project.layers) {
      if (!layer.visible) continue;
      for (const item of layer.children) {
        if (!(item instanceof paper.Group)) continue;
        if (item.data?.type !== 'image' || item.data?.imageId !== imageId) continue;

        const raster = item.children.find(
          (child): child is paper.Raster => child instanceof paper.Raster
        );
        if (raster) {
          return raster;
        }
      }
    }

    return null;
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

    const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';

    // 生成数据URL（捕获 SecurityError，通常由跨域图片导致 canvas 被污染引起）
    let dataUrl: string;
    try {
      dataUrl = await canvasToDataUrl(
        canvas,
        mimeType,
        options.format === 'jpeg' ? options.quality : undefined
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        logger.error('❌ 截图生成失败: SecurityError: The operation is insecure.', {
          message: 'Canvas 可能包含跨域图片资源，导致无法导出。请确保所有图片资源都有正确的 CORS 头。',
          error
        });
        throw new Error('SecurityError: The operation is insecure.');
      }
      throw error;
    }

    // 生成Blob（同样需要捕获 SecurityError）
    let blob: Blob;
    try {
      blob = await canvasToBlob(canvas, { type: mimeType, quality: options.quality });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        logger.error('❌ Blob 生成失败: SecurityError: The operation is insecure.', {
          message: 'Canvas 可能包含跨域图片资源，导致无法导出。请确保所有图片资源都有正确的 CORS 头。',
          error
        });
        throw new Error('SecurityError: The operation is insecure.');
      }
      throw error;
    }

    // PNG 才需要透明背景裁剪
    let resultBounds: ContentBounds = { ...bounds };
    if (options.format === 'png') {
      try {
        const trimResult = await trimTransparentPng(dataUrl, { alphaThreshold: 4, padding: 0 });
        if (trimResult?.changed && trimResult.cropBounds.width > 0 && trimResult.cropBounds.height > 0) {
          dataUrl = trimResult.dataUrl;
          const scale = Math.max(1e-6, options.scale);
          resultBounds = {
            x: bounds.x + trimResult.cropBounds.left / scale,
            y: bounds.y + trimResult.cropBounds.top / scale,
            width: trimResult.cropBounds.width / scale,
            height: trimResult.cropBounds.height / scale,
            isEmpty: bounds.isEmpty,
            elementCount: bounds.elementCount
          };

          // 根据裁剪后的 dataURL 重建 Blob
          blob = await dataUrlToBlob(dataUrl);

          logger.debug('🪄 截图自动裁剪透明边框', {
            cropBounds: trimResult.cropBounds,
            originalSize: trimResult.originalSize,
            resultBounds
          });
        }
      } catch (error) {
        logger.warn?.('截图透明边界裁剪失败，使用原始截图', error);
      }
    }

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
      bounds: resultBounds,
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

  private static findImageGroup(imageId: string): paper.Group | null {
    if (!paper.project || !paper.project.layers) return null;
    for (const layer of paper.project.layers) {
      for (const item of layer.children) {
        if (item instanceof paper.Group && item.data?.type === 'image' && item.data?.imageId === imageId) {
          return item;
        }
      }
    }
    return null;
  }

  private static findModelGroup(modelId: string): paper.Group | null {
    if (!paper.project || !paper.project.layers) return null;
    for (const layer of paper.project.layers) {
      for (const item of layer.children) {
        if (item instanceof paper.Group && item.data?.type === '3d-model' && item.data?.modelId === modelId) {
          return item;
        }
      }
    }
    return null;
  }
}
