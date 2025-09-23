/**
 * 边界计算工具
 * 用于计算画布中所有元素的联合边界，支持自动截图功能
 */

import paper from 'paper';
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
    console.log('📏 计算截图边界（包含 2D/图片/3D 全部内容）...');
    
    // 第一步：收集所有可见图片和3D模型作为基础边界
    const baseBounds: Bounds[] = [];
    
    // 1. 收集可见图片实例作为主要边界
    const visibleImages = imageInstances.filter(img => img.visible);
    console.log(`🖼️ 找到 ${visibleImages.length} 个可见图片实例`);
    
    for (const image of visibleImages) {
      if (this.isValidBounds(image.bounds)) {
        baseBounds.push(image.bounds);
        console.log(`  - 图片 ${image.id}: ${Math.round(image.bounds.x)},${Math.round(image.bounds.y)} ${Math.round(image.bounds.width)}x${Math.round(image.bounds.height)}`);
      }
    }

    // 2. 收集可见3D模型实例
    const visibleModels = model3DInstances.filter(model => model.visible);
    console.log(`🎭 找到 ${visibleModels.length} 个可见3D模型`);
    
    for (const model of visibleModels) {
      if (this.isValidBounds(model.bounds)) {
        baseBounds.push(model.bounds);
        console.log(`  - 3D模型 ${model.id}: ${Math.round(model.bounds.x)},${Math.round(model.bounds.y)} ${Math.round(model.bounds.width)}x${Math.round(model.bounds.height)}`);
      }
    }
    
    // 第二步：无论是否存在图片/3D模型，都合并 2D 绘制内容的边界
    const paperDrawingBounds = this.getPaperDrawingBounds();
    console.log(`✏️ 可见的 2D 绘制元素边界数量: ${paperDrawingBounds.length}`);
    const allBounds: Bounds[] = baseBounds.concat(paperDrawingBounds);

    // 第三步：计算最终边界
    if (allBounds.length === 0) {
      console.log('⚠️ 没有找到任何内容元素，使用默认边界');
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
    console.log(`📏 最终截图边界（合并 2D/图片/3D）: ${Math.round(finalBounds.x)},${Math.round(finalBounds.y)} ${Math.round(finalBounds.width)}x${Math.round(finalBounds.height)}`);
    
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
   * 获取Paper.js中所有绘制路径的边界（不包括辅助元素）
   */
  static getPaperDrawingBounds(): Bounds[] {
    const bounds: Bounds[] = [];

    if (!paper.project || !paper.project.layers) {
      return bounds;
    }

    for (const layer of paper.project.layers) {
      if (!layer.visible) continue;
      // 跳过网格/背景等非内容图层
      if (layer.name === 'grid' || layer.name === 'background') continue;

      for (const item of layer.children) {
        // 只包含实际的绘制内容
        if (
          item.visible &&
          !item.data?.isHelper &&
          item.bounds &&
          this.isValidBounds(item.bounds) &&
          // 确保是用户绘制的内容
          (item instanceof paper.Path || 
           item instanceof paper.Group || 
           item instanceof paper.Raster)
        ) {
          bounds.push({
            x: item.bounds.x,
            y: item.bounds.y,
            width: item.bounds.width,
            height: item.bounds.height
          });
        }
      }
    }

    return bounds;
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
      } else if (child instanceof paper.Raster && !child.data?.isHelper) {
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
}
