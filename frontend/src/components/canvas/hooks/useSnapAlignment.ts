/**
 * 自动对齐系统 - 状态管理 Hook
 * 管理对齐检测状态、缓存和参考线数据
 */

import { useCallback, useRef, useState } from 'react';
import { useUIStore } from '@/stores';
import {
  detectAlignments,
  imagesToBounds,
  modelsToBounds,
  mergeBounds,
  deduplicateAlignments,
  type AlignmentLine,
  type ObjectBounds,
} from '@/utils/snapAlignment';
import type { ImageInstance, Model3DInstance } from '@/types/canvas';

interface UseSnapAlignmentProps {
  imageInstances: ImageInstance[];
  model3DInstances?: Model3DInstance[];
  zoom: number;
}

export interface SnapAlignmentAPI {
  snapEnabled: boolean;
  activeAlignments: AlignmentLine[];
  startSnapping: (excludeIds: string[]) => void;
  calculateSnappedPosition: (
    draggingId: string,
    currentPosition: { x: number; y: number },
    bounds: { width: number; height: number }
  ) => {
    position: { x: number; y: number };
    alignments: AlignmentLine[];
  };
  updateAlignments: (alignments: AlignmentLine[]) => void;
  clearAlignments: () => void;
}

export function useSnapAlignment({
  imageInstances,
  model3DInstances = [],
  zoom,
}: UseSnapAlignmentProps): SnapAlignmentAPI {
  const snapEnabled = useUIStore((state) => state.snapAlignmentEnabled);
  const [activeAlignments, setActiveAlignments] = useState<AlignmentLine[]>([]);

  // 缓存其他对象的边界，避免每帧重复计算
  const boundsCache = useRef<ObjectBounds[]>([]);

  /**
   * 开始拖拽时缓存其他对象的边界
   * @param excludeIds 要排除的对象 ID（被拖拽的对象）
   */
  const startSnapping = useCallback(
    (excludeIds: string[]) => {
      if (!snapEnabled) {
        boundsCache.current = [];
        return;
      }

      const excludeSet = new Set(excludeIds);
      const imageBounds = imagesToBounds(imageInstances).filter((b) => !excludeSet.has(b.id));
      const modelBounds = modelsToBounds(model3DInstances).filter((b) => !excludeSet.has(b.id));

      boundsCache.current = mergeBounds(imageBounds, modelBounds);
    },
    [snapEnabled, imageInstances, model3DInstances]
  );

  /**
   * 计算吸附后的位置
   * @param draggingId 被拖拽对象的 ID
   * @param currentPosition 当前位置（未吸附）
   * @param bounds 对象的宽高
   * @returns 吸附后的位置和对齐线数据
   */
  const calculateSnappedPosition = useCallback(
    (
      draggingId: string,
      currentPosition: { x: number; y: number },
      bounds: { width: number; height: number }
    ) => {
      if (!snapEnabled || boundsCache.current.length === 0) {
        return { position: currentPosition, alignments: [] };
      }

      // 阈值随缩放调整，确保不同缩放级别下体验一致
      const threshold = 8 / Math.max(zoom, 0.1);

      const draggingBounds: ObjectBounds = {
        id: draggingId,
        x: currentPosition.x,
        y: currentPosition.y,
        width: bounds.width,
        height: bounds.height,
      };

      const result = detectAlignments(draggingBounds, boundsCache.current, threshold);

      const snappedPosition = {
        x: currentPosition.x + result.snapDelta.x,
        y: currentPosition.y + result.snapDelta.y,
      };

      // 去重对齐线
      const dedupedAlignments = deduplicateAlignments(result.alignments);

      return {
        position: snappedPosition,
        alignments: dedupedAlignments,
      };
    },
    [snapEnabled, zoom]
  );

  /**
   * 更新当前显示的对齐线
   */
  const updateAlignments = useCallback((alignments: AlignmentLine[]) => {
    setActiveAlignments(alignments);
  }, []);

  /**
   * 清除所有对齐线
   */
  const clearAlignments = useCallback(() => {
    setActiveAlignments([]);
    boundsCache.current = [];
  }, []);

  return {
    snapEnabled,
    activeAlignments,
    startSnapping,
    calculateSnappedPosition,
    updateAlignments,
    clearAlignments,
  };
}
