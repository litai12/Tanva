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
   * 计算所有内容元素的联合边界
   * @param imageInstances 图片实例数组
   * @param model3DInstances 3D模型实例数组
   * @param padding 边距（Paper.js坐标单位）
   * @returns 包含所有元素的边界
   */
  static calculateContentBounds(
    imageInstances: ImageInstance[],
    model3DInstances: Model3DInstance[],
    padding: number = 50
  ): ContentBounds {
    const allBounds: Bounds[] = [];

    // 1. 收集Paper.js中的所有非辅助元素边界
    if (paper.project && paper.project.layers) {
      for (const layer of paper.project.layers) {
        if (!layer.visible) continue;
        
        for (const item of layer.children) {
          // 跳过辅助元素（网格、选择框等）
          if (item.data?.isHelper) continue;
          
          // 跳过不可见元素
          if (!item.visible) continue;
          
          // 只收集真正的内容元素
          if (item instanceof paper.Path && item.segments && item.segments.length > 0) {
            if (item.bounds && this.isValidBounds(item.bounds)) {
              allBounds.push({
                x: item.bounds.x,
                y: item.bounds.y,
                width: item.bounds.width,
                height: item.bounds.height
              });
            }
          } else if (item instanceof paper.Group) {
            // 递归处理组内元素
            this.collectGroupBounds(item, allBounds);
          } else if (item instanceof paper.Raster && !item.data?.isHelper) {
            // Paper.js中的图片（不是图片占位符）
            if (item.bounds && this.isValidBounds(item.bounds)) {
              allBounds.push({
                x: item.bounds.x,
                y: item.bounds.y,
                width: item.bounds.width,
                height: item.bounds.height
              });
            }
          }
        }
      }
    }

    // 2. 收集可见图片实例的边界
    const visibleImages = imageInstances.filter(img => img.visible);
    for (const image of visibleImages) {
      if (this.isValidBounds(image.bounds)) {
        allBounds.push(image.bounds);
      }
    }

    // 3. 收集可见3D模型实例的边界
    const visibleModels = model3DInstances.filter(model => model.visible);
    for (const model of visibleModels) {
      if (this.isValidBounds(model.bounds)) {
        allBounds.push(model.bounds);
      }
    }

    // 4. 计算联合边界
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

    const unionBounds = this.calculateUnionBounds(allBounds);
    
    // 5. 添加边距
    return {
      x: unionBounds.x - padding,
      y: unionBounds.y - padding,
      width: unionBounds.width + padding * 2,
      height: unionBounds.height + padding * 2,
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