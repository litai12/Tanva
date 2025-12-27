/**
 * 边界计算工具
 * 用于计算画布中所有元素的联合边界，支持自动截图功能
 */

import paper from 'paper';
import { isRaster, isPath, isPointText } from '@/utils/paperCoords';
import type { ImageInstance, Model3DInstance } from '@/types/canvas';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContentBounds extends Bounds {
  isEmpty: boolean;
  elementCount: number;
}

export class BoundsCalculator {
  /**
   * 计算截图边界（以图片为基础，包含其上的绘制内容）
   * @param imageInstances 图片实例数组（作为主要边界基础）
   * @param model3DInstances 3D模型实例数组
   * @param padding 边距（Paper.js坐标单位）
   * @returns 以图片为基础的截图边界
   */
  static calculateContentBounds(
    imageInstances: ImageInstance[],
    model3DInstances: Model3DInstance[],
    padding: number = 0
  ): ContentBounds {
    
    // 第一步：收集所有可见3D模型作为基础边界（图片以 Paper.Raster 为准，避免重复统计）
    const baseBounds: Bounds[] = [];
    
    // 1. 收集可见3D模型实例
    const visibleModels = model3DInstances.filter(model => model.visible);

    for (const model of visibleModels) {
      if (this.isValidBounds(model.bounds)) {
        baseBounds.push(model.bounds);
      }
    }
    
    // 第二步：无论是否存在3D模型，都合并 2D 绘制内容的边界（包含图片的 Paper.Raster）
    const paperDrawingBounds = this.getPaperDrawingBounds();
    const allBounds: Bounds[] = baseBounds.concat(paperDrawingBounds);

    // 第三步：计算最终边界
    if (allBounds.length === 0) {
      return {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        isEmpty: true,
        elementCount: 0
      };
    }

    // 使用所有内容的联合边界（图片/3D/2D线条）
    const finalBounds = this.calculateUnionBounds(allBounds);

    // 应用可选边距
    const pad = Math.max(0, padding || 0);
    return {
      x: finalBounds.x - pad,
      y: finalBounds.y - pad,
      width: finalBounds.width + pad * 2,
      height: finalBounds.height + pad * 2,
      isEmpty: false,
      elementCount: allBounds.length
    };
  }

  /**
   * 仅针对被选中的元素计算截图边界
   */
  static calculateSelectionBounds(
    selectedImages: ImageInstance[],
    selectedModels: Model3DInstance[],
    selectedPaperItems: paper.Item[],
    padding: number = 0
  ): ContentBounds {
    const boundsList: Bounds[] = [];

    for (const image of selectedImages) {
      if (!image.visible) continue;
      if (this.isValidBounds(image.bounds)) {
        boundsList.push({
          x: image.bounds.x,
          y: image.bounds.y,
          width: image.bounds.width,
          height: image.bounds.height,
        });
      }
    }

    for (const model of selectedModels) {
      if (!model.visible) continue;
      if (this.isValidBounds(model.bounds)) {
        boundsList.push({
          x: model.bounds.x,
          y: model.bounds.y,
          width: model.bounds.width,
          height: model.bounds.height,
        });
      }
    }

    for (const item of selectedPaperItems) {
      const b = this.getPaperItemBounds(item);
      if (b) {
        boundsList.push(b);
        console.log(`  - 选中Paper元素 ${item.className || item.name || 'unknown'}: ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
    }

    if (boundsList.length === 0) {
      console.log('⚠️ 未找到选中的有效元素边界，保持默认截取行为');
      return {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        isEmpty: true,
        elementCount: 0
      };
    }

    const union = this.calculateUnionBounds(boundsList);
    const pad = Math.max(0, padding || 0);

    return {
      x: union.x - pad,
      y: union.y - pad,
      width: union.width + pad * 2,
      height: union.height + pad * 2,
      isEmpty: false,
      elementCount: boundsList.length
    };
  }

  /**
   * 计算多个边界的联合边界
   */
  private static calculateUnionBounds(bounds: Bounds[]): Bounds {
    if (bounds.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    if (bounds.length === 1) {
      return { ...bounds[0] };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const bound of bounds) {
      minX = Math.min(minX, bound.x);
      minY = Math.min(minY, bound.y);
      maxX = Math.max(maxX, bound.x + bound.width);
      maxY = Math.max(maxY, bound.y + bound.height);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * 验证边界是否有效
   */
  private static isValidBounds(bounds: Bounds | paper.Rectangle): boolean {
    const b = bounds instanceof paper.Rectangle ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    } : bounds;

    return (
      typeof b.x === 'number' &&
      typeof b.y === 'number' &&
      typeof b.width === 'number' &&
      typeof b.height === 'number' &&
      !isNaN(b.x) &&
      !isNaN(b.y) &&
      !isNaN(b.width) &&
      !isNaN(b.height) &&
      b.width > 0 &&
      b.height > 0
    );
  }

  /**
   * 获取Paper.js中所有绘制元素的边界（不包括辅助元素），优先使用 strokeBounds 以包含线宽
   */
  static getPaperDrawingBounds(): Bounds[] {
    const out: Bounds[] = [];

    if (!paper.project || !paper.project.layers) return out;

    const pushBounds = (rect: paper.Rectangle | null | undefined) => {
      if (!rect) return;
      const b = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      if (this.isValidBounds(b)) out.push(b);
    };

    const visit = (item: paper.Item) => {
      if (!item || !item.visible || (item.data as any)?.isHelper) return;

      // 跳过网格/背景层元素
      const layerName = (item.layer && item.layer.name) || '';
      if (layerName === 'grid' || layerName === 'background') return;

      // 计算包含线宽的边界
      const rect = (item as any).strokeBounds || item.bounds || null;

      if (item instanceof paper.Group) {
        // 组：不直接使用组的边界，逐个遍历可见子项，避免隐形子项扩大边界
        for (const child of item.children) visit(child);
      } else if (
        isPath(item) ||
        isRaster(item) ||
        isPointText(item)
      ) {
        // 对 Path，如既无描边也无填充，视为不可见
        if (isPath(item)) {
          const hasStroke = !!(item as any).strokeColor && (item as any).strokeWidth !== 0;
          const hasFill = !!(item as any).fillColor;
          if (!hasStroke && !hasFill) return;
        }
        pushBounds(rect);
      }
    };

    for (const layer of paper.project.layers) {
      if (!layer.visible) continue;
      for (const item of layer.children) visit(item);
    }

    return out;
  }

  /**
   * 检查指定区域是否包含任何内容
   */
  static hasContentInBounds(
    bounds: Bounds,
    imageInstances: ImageInstance[],
    model3DInstances: Model3DInstance[]
  ): boolean {
    // 检查Paper.js内容
    const paperBounds = this.getPaperDrawingBounds();
    for (const paperBound of paperBounds) {
      if (this.boundsIntersect(bounds, paperBound)) {
        return true;
      }
    }

    // 检查图片实例
    for (const image of imageInstances) {
      if (image.visible && this.boundsIntersect(bounds, image.bounds)) {
        return true;
      }
    }

    // 检查3D模型实例
    for (const model of model3DInstances) {
      if (model.visible && this.boundsIntersect(bounds, model.bounds)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查两个边界是否相交
   */
  private static boundsIntersect(a: Bounds, b: Bounds): boolean {
    return !(
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y
    );
  }

  /**
   * 递归收集组内元素的边界
   */
  private static collectGroupBounds(group: paper.Group, allBounds: Bounds[]): void {
    for (const child of group.children) {
      if (!child.visible || child.data?.isHelper) continue;

      if (child instanceof paper.Path && child.segments && child.segments.length > 0) {
        if (child.bounds && this.isValidBounds(child.bounds)) {
          allBounds.push({
            x: child.bounds.x,
            y: child.bounds.y,
            width: child.bounds.width,
            height: child.bounds.height
          });
        }
      } else if (child instanceof paper.Group) {
        this.collectGroupBounds(child, allBounds);
      } else if (isRaster(child) && !child.data?.isHelper) {
        if (child.bounds && this.isValidBounds(child.bounds)) {
          allBounds.push({
            x: child.bounds.x,
            y: child.bounds.y,
            width: child.bounds.width,
            height: child.bounds.height
          });
        }
      }
    }
  }

  /**
   * 计算适合的边距大小（基于内容大小的自适应边距）
   */
  static calculateOptimalPadding(contentBounds: Bounds): number {
    const size = Math.max(contentBounds.width, contentBounds.height);
    
    if (size < 200) return 20;
    if (size < 500) return 30;
    if (size < 1000) return 50;
    if (size < 2000) return 80;
    return 100;
  }

  /**
   * 提取Paper元素的有效边界，默认优先使用包含描边的strokeBounds
   */
  private static getPaperItemBounds(item: paper.Item): Bounds | null {
    if (!item || !item.visible) return null;
    if ((item.data as any)?.isHelper) return null;

    let rect = (item as any).strokeBounds || item.bounds || null;
    if (!rect) return null;

    const bounds = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };

    if (!this.isValidBounds(bounds)) {
      const expanded = rect.expand(1);
      rect = expanded;
      bounds.x = rect.x;
      bounds.y = rect.y;
      bounds.width = rect.width;
      bounds.height = rect.height;
    }

    return this.isValidBounds(bounds) ? bounds : null;
  }
}
