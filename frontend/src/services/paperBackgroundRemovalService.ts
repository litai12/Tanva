/**
 * Paper.js背景移除结果集成服务
 * 将透明PNG转换为Paper.js对象,并支持进一步编辑
 */

import paper from 'paper';
import { logger } from '@/utils/logger';

export interface PaperBackgroundRemovalOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layer?: paper.Layer;
  name?: string;
}

class PaperBackgroundRemovalService {
  /**
   * 将透明PNG添加到Paper.js画布
   * @param imageDataUrl base64 PNG with transparency
   * @param options 放置选项
   * @returns 创建的Raster对象
   */
  static addTransparentImageToCanvas(
    imageDataUrl: string,
    options: PaperBackgroundRemovalOptions = {}
  ): paper.Raster {
    try {
      logger.info('🎨 Adding transparent image to Paper.js canvas');

      // 创建Raster对象
      const raster = new paper.Raster(imageDataUrl);

      // 设置位置
      if (options.x !== undefined && options.y !== undefined) {
        raster.position = new paper.Point(options.x, options.y);
      } else {
        // 默认居中在视图中心
        raster.position = paper.view.center;
      }

      // 设置大小
      if (options.width !== undefined && options.height !== undefined) {
        raster.width = options.width;
        raster.height = options.height;
      }

      // 设置名称用于识别
      if (options.name) {
        raster.name = options.name;
      } else {
        raster.name = `removed-bg-${Date.now()}`;
      }

      // 添加到指定的图层或当前活跃图层
      const targetLayer = options.layer || paper.project.activeLayer;
      targetLayer.addChild(raster);

      // 设置为可选
      raster.selected = true;

      logger.info(`✅ Image added to canvas: ${raster.name}`);
      logger.info(`   Position: (${raster.position.x.toFixed(0)}, ${raster.position.y.toFixed(0)})`);
      logger.info(`   Size: ${raster.width.toFixed(0)} x ${raster.height.toFixed(0)}`);

      return raster;
    } catch (error) {
      logger.error('❌ Failed to add image to canvas:', error);
      throw error;
    }
  }

  /**
   * 添加带选项的透明图像
   * @param imageDataUrl base64 PNG
   * @param atPoint 放置的点(可选)
   * @param scale 缩放比例(可选)
   * @returns Raster对象
   */
  static addImageAtPoint(
    imageDataUrl: string,
    atPoint?: paper.Point,
    scale?: number
  ): paper.Raster {
    const raster = this.addTransparentImageToCanvas(imageDataUrl, {
      x: atPoint?.x,
      y: atPoint?.y,
      name: `transparent-image-${Date.now()}`,
    });

    if (scale) {
      raster.scale(scale);
      logger.info(`   Scaled to: ${scale}x`);
    }

    return raster;
  }

  /**
   * 将多个抠图结果合成到一个组
   * @param imageDataUrls 多个base64 PNG数组
   * @param positions 对应的位置数组
   * @param groupName 组名称
   * @returns Group对象
   */
  static addMultipleImagesAsGroup(
    imageDataUrls: string[],
    positions?: paper.Point[],
    groupName?: string
  ): paper.Group {
    try {
      logger.info(`🎨 Creating group with ${imageDataUrls.length} images`);

      const group = new paper.Group();
      group.name = groupName || `removed-bg-group-${Date.now()}`;

      imageDataUrls.forEach((url, index) => {
        const point = positions?.[index] || paper.view.center;
        const raster = new paper.Raster(url);
        raster.position = point;
        raster.name = `image-${index}`;
        group.addChild(raster);
      });

      paper.project.activeLayer.addChild(group);
      logger.info(`✅ Group created with ${imageDataUrls.length} images`);

      return group;
    } catch (error) {
      logger.error('❌ Failed to create group:', error);
      throw error;
    }
  }

  /**
   * 导出选中的抠图对象为PNG
   * @param raster 要导出的Raster对象
   * @param fileName 文件名
   * @returns Promise<Blob>
   */
  static async exportRasterAsPNG(
    raster: paper.Raster,
    fileName?: string
  ): Promise<Blob> {
    try {
      logger.info(`💾 Exporting raster as PNG: ${raster.name}`);

      // 获取Canvas元素并导出
      const canvas = raster.canvas as HTMLCanvasElement;
      if (!canvas) {
        throw new Error('No canvas found for raster');
      }

      // 创建新的Canvas以保持透明度
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = raster.width;
      exportCanvas.height = raster.height;

      const ctx = exportCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // 保持透明背景
      ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
      ctx.drawImage(canvas, 0, 0);

      return new Promise((resolve, reject) => {
        exportCanvas.toBlob((blob) => {
          if (blob) {
            logger.info(`✅ PNG exported: ${blob.size} bytes`);
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        }, 'image/png');
      });
    } catch (error) {
      logger.error('❌ Export failed:', error);
      throw error;
    }
  }

  /**
   * 下载导出的PNG
   * @param raster Raster对象
   * @param fileName 文件名(可选)
   */
  static async downloadRasterAsPNG(
    raster: paper.Raster,
    fileName?: string
  ): Promise<void> {
    try {
      const blob = await this.exportRasterAsPNG(raster, fileName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || `${raster.name}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logger.info(`✅ PNG downloaded: ${a.download}`);
    } catch (error) {
      logger.error('❌ Download failed:', error);
      throw error;
    }
  }

  /**
   * 调整Raster大小
   * @param raster 目标Raster
   * @param width 新宽度
   * @param height 新高度
   */
  static resizeRaster(
    raster: paper.Raster,
    width: number,
    height: number
  ): void {
    try {
      const originalWidth = raster.width;
      const originalHeight = raster.height;

      raster.width = width;
      raster.height = height;

      logger.info(
        `📐 Raster resized from ${originalWidth}x${originalHeight} to ${width}x${height}`
      );
    } catch (error) {
      logger.error('❌ Resize failed:', error);
      throw error;
    }
  }

  /**
   * 旋转Raster
   * @param raster 目标Raster
   * @param angle 旋转角度(度)
   */
  static rotateRaster(raster: paper.Raster, angle: number): void {
    try {
      raster.rotate(angle);
      logger.info(`🔄 Raster rotated by ${angle}°`);
    } catch (error) {
      logger.error('❌ Rotation failed:', error);
      throw error;
    }
  }

  /**
   * 将Raster转换为alpha蒙版的路径
   * 用于创建矢量形状或进一步编辑
   */
  static rasterToPath(raster: paper.Raster): paper.Path | null {
    try {
      logger.info('🎨 Converting raster to path...');

      // 这是一个高级功能,需要Canvas的像素数据处理
      // 返回null表示需要外部处理库(如PotraceJS)

      logger.warn('⚠️ Raster to path conversion requires additional libraries');
      return null;
    } catch (error) {
      logger.error('❌ Path conversion failed:', error);
      return null;
    }
  }

  /**
   * 获取Raster的边界信息
   */
  static getRasterBounds(raster: paper.Raster): {
    x: number;
    y: number;
    width: number;
    height: number;
    area: number;
  } {
    return {
      x: raster.position.x - raster.width / 2,
      y: raster.position.y - raster.height / 2,
      width: raster.width,
      height: raster.height,
      area: raster.width * raster.height,
    };
  }

  /**
   * 检查点是否在Raster范围内
   */
  static isPointInRaster(raster: paper.Raster, point: paper.Point): boolean {
    const bounds = raster.bounds;
    return bounds.contains(point);
  }

  /**
   * 获取所有背景移除的Raster(通过名称模式识别)
   */
  static getAllRemovedBGRasters(): paper.Raster[] {
    const rasters: paper.Raster[] = [];

    paper.project.getItems({
      match: (item: any) => {
        return (
          item instanceof paper.Raster &&
          (item.name?.includes('removed-bg') || item.name?.includes('transparent-image'))
        );
      },
    }).forEach((item) => {
      if (item instanceof paper.Raster) {
        rasters.push(item);
      }
    });

    logger.info(`📊 Found ${rasters.length} removed-background images`);
    return rasters;
  }

  /**
   * 删除所有背景移除的Raster
   */
  static removeAllRemovedBGRasters(): number {
    const rasters = this.getAllRemovedBGRasters();
    rasters.forEach((raster) => {
      raster.remove();
    });

    logger.info(`🗑️ Removed ${rasters.length} images`);
    return rasters.length;
  }
}

export default PaperBackgroundRemovalService;
