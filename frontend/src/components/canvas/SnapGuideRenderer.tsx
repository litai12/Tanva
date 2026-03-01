/**
 * 自动对齐系统 - 参考线渲染组件
 * 使用 Paper.js 渲染对齐参考线
 */

import { useEffect, useRef } from 'react';
import paper from 'paper';
import type { AlignmentLine } from '@/utils/snapAlignment';

interface SnapGuideRendererProps {
  alignments: AlignmentLine[];
  zoom: number;
}

// 参考线颜色配置
const COLORS = {
  edge: '#ff6b6b', // 红色 - 边缘对齐
  center: '#ff69b4', // 粉色 - 中心对齐
};

export function SnapGuideRenderer({ alignments, zoom }: SnapGuideRendererProps) {
  const guidesRef = useRef<paper.Path[]>([]);

  useEffect(() => {
    // 清除旧参考线
    guidesRef.current.forEach((guide) => {
      try {
        guide.remove();
      } catch {
        // 忽略已删除的对象
      }
    });
    guidesRef.current = [];

    // 如果没有对齐线或 Paper.js 未初始化，直接返回
    if (!alignments.length || !paper.project) {
      return;
    }

    // 线宽随缩放调整，确保视觉一致性
    const strokeWidth = 1 / Math.max(zoom, 0.1);
    const dashLength = 4 / Math.max(zoom, 0.1);

    alignments.forEach((alignment) => {
      const isCenter = alignment.type === 'centerX' || alignment.type === 'centerY';
      const color = isCenter ? COLORS.center : COLORS.edge;

      let line: paper.Path;

      if (alignment.orientation === 'vertical') {
        // 垂直线（X 轴对齐）
        line = new paper.Path.Line({
          from: new paper.Point(alignment.position, alignment.start),
          to: new paper.Point(alignment.position, alignment.end),
          strokeColor: new paper.Color(color),
          strokeWidth,
          dashArray: [dashLength, dashLength],
        });
      } else {
        // 水平线（Y 轴对齐）
        line = new paper.Path.Line({
          from: new paper.Point(alignment.start, alignment.position),
          to: new paper.Point(alignment.end, alignment.position),
          strokeColor: new paper.Color(color),
          strokeWidth,
          dashArray: [dashLength, dashLength],
        });
      }

      // 标记为辅助线，避免被其他逻辑处理
      line.data = { type: 'snap-guide', isHelper: true };

      // 将参考线置于最前
      try {
        line.bringToFront();
      } catch {
        // 忽略错误
      }

      guidesRef.current.push(line);
    });

    // 更新视图
    try {
      paper.view.update();
    } catch {
      // 忽略错误
    }

    // 清理函数
    return () => {
      guidesRef.current.forEach((guide) => {
        try {
          guide.remove();
        } catch {
          // 忽略已删除的对象
        }
      });
      guidesRef.current = [];
    };
  }, [alignments, zoom]);

  // 这是一个纯逻辑组件，不渲染任何 DOM
  return null;
}
