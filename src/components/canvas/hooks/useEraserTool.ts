/**
 * 橡皮擦工具Hook
 * 处理橡皮擦功能，删除与橡皮擦路径相交的绘图内容
 */

import { useCallback } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import type { DrawingContext } from '@/types/canvas';

interface UseEraserToolProps {
  context: DrawingContext;
  strokeWidth: number;
}

export const useEraserTool = ({ context, strokeWidth }: UseEraserToolProps) => {
  const { ensureDrawingLayer } = context;

  // ========== 橡皮擦核心功能 ==========

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

    logger.debug(`🧹 橡皮擦删除了 ${itemsToRemove.length} 个路径`);
    
    return itemsToRemove.length;
  }, [strokeWidth, ensureDrawingLayer]);

  // ========== 橡皮擦辅助功能 ==========

  // 计算橡皮擦的有效范围
  const getEraserRadius = useCallback(() => {
    return strokeWidth * 1.5; // 橡皮擦半径是笔刷宽度的1.5倍
  }, [strokeWidth]);

  // 检测指定点周围是否有可擦除的内容
  const hasErasableContentAt = useCallback((point: paper.Point, radius?: number): boolean => {
    const drawingLayer = ensureDrawingLayer();
    if (!drawingLayer) return false;

    const checkRadius = radius || getEraserRadius();
    let hasContent = false;

    drawingLayer.children.forEach((item) => {
      if (item instanceof paper.Path && !hasContent) {
        // 检查路径上的任意点是否在橡皮擦范围内
        for (const segment of item.segments) {
          const distance = segment.point.getDistance(point);
          if (distance <= checkRadius) {
            hasContent = true;
            break;
          }
        }
      }
    });

    return hasContent;
  }, [ensureDrawingLayer, getEraserRadius]);

  // 预览橡皮擦影响范围（返回会被擦除的路径数量）
  const previewEraseAt = useCallback((point: paper.Point, radius?: number): number => {
    const drawingLayer = ensureDrawingLayer();
    if (!drawingLayer) return 0;

    const checkRadius = radius || getEraserRadius();
    let affectedCount = 0;

    drawingLayer.children.forEach((item) => {
      if (item instanceof paper.Path) {
        // 检查路径上的任意点是否在橡皮擦范围内
        for (const segment of item.segments) {
          const distance = segment.point.getDistance(point);
          if (distance <= checkRadius) {
            affectedCount++;
            break;
          }
        }
      }
    });

    return affectedCount;
  }, [ensureDrawingLayer, getEraserRadius]);

  // ========== 橡皮擦模式检测 ==========

  // 检查指定路径是否是橡皮擦路径（基于样式特征）
  const isEraserPath = useCallback((path: paper.Path): boolean => {
    // 橡皮擦路径特征：红色虚线，特定透明度
    const strokeColor = path.strokeColor;
    if (!strokeColor) return false;

    // 检查是否是红色系（容忍一定误差）
    const isReddish = strokeColor.red > 0.8 && strokeColor.green < 0.5 && strokeColor.blue < 0.5;
    
    // 检查是否有虚线样式
    const hasDashArray = path.dashArray && path.dashArray.length > 0;
    
    // 检查透明度
    const hasTransparency = path.opacity < 1.0;

    return isReddish && hasDashArray && hasTransparency;
  }, []);

  // ========== 橡皮擦路径创建辅助 ==========

  // 创建橡皮擦样式的路径配置
  const getEraserPathStyle = useCallback(() => {
    return {
      strokeColor: new paper.Color('#ff6b6b'), // 红色
      strokeWidth: strokeWidth * 1.5, // 稍微粗一点
      dashArray: [5, 5], // 虚线效果
      opacity: 0.7, // 半透明
      strokeCap: 'round' as const,
      strokeJoin: 'round' as const,
    };
  }, [strokeWidth]);

  // 应用橡皮擦样式到路径
  const applyEraserStyle = useCallback((path: paper.Path) => {
    const style = getEraserPathStyle();
    Object.assign(path, style);
  }, [getEraserPathStyle]);

  // ========== 批量橡皮擦操作 ==========

  // 在指定区域内执行橡皮擦操作
  const performEraseInArea = useCallback((bounds: paper.Rectangle): number => {
    const drawingLayer = ensureDrawingLayer();
    if (!drawingLayer) return 0;

    const itemsToRemove: paper.Item[] = [];
    
    drawingLayer.children.forEach((item) => {
      if (item instanceof paper.Path) {
        // 检查路径是否与指定区域相交
        if (item.bounds.intersects(bounds)) {
          itemsToRemove.push(item);
        }
      }
    });

    // 删除相交的路径
    itemsToRemove.forEach(item => item.remove());

    logger.debug(`🧹 区域橡皮擦删除了 ${itemsToRemove.length} 个路径`);
    
    return itemsToRemove.length;
  }, [ensureDrawingLayer]);

  // 清空整个绘图图层
  const clearDrawingLayer = useCallback((): number => {
    const drawingLayer = ensureDrawingLayer();
    if (!drawingLayer) return 0;

    const pathCount = drawingLayer.children.filter(item => item instanceof paper.Path).length;
    
    // 移除所有路径（保留非路径元素）
    const itemsToRemove = drawingLayer.children.filter(item => item instanceof paper.Path);
    itemsToRemove.forEach(item => item.remove());

    logger.debug(`🧹 清空绘图图层，删除了 ${pathCount} 个路径`);
    
    return pathCount;
  }, [ensureDrawingLayer]);

  return {
    // 核心橡皮擦功能
    performErase,

    // 辅助功能
    getEraserRadius,
    hasErasableContentAt,
    previewEraseAt,

    // 样式和检测
    isEraserPath,
    getEraserPathStyle,
    applyEraserStyle,

    // 批量操作
    performEraseInArea,
    clearDrawingLayer,
  };
};