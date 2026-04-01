/**
 * Snap alignment guide renderer.
 * Uses Paper.js to draw alignment guides.
 */

import { useEffect, useRef } from 'react';
import paper from 'paper';
import type { AlignmentLine } from '@/utils/snapAlignment';

interface SnapGuideRendererProps {
  alignments: AlignmentLine[];
  zoom: number;
}

// Guide color config.
const COLORS = {
  edge: 'rgba(255, 107, 107, 0.48)', // Red - edge alignment.
  center: 'rgba(255, 105, 180, 0.44)', // Pink - center alignment.
};

export function SnapGuideRenderer({ alignments, zoom }: SnapGuideRendererProps) {
  const guidesRef = useRef<paper.Path[]>([]);

  useEffect(() => {
    // Clear previous guides.
    guidesRef.current.forEach((guide) => {
      try {
        guide.remove();
      } catch {
        // Ignore already removed objects.
      }
    });
    guidesRef.current = [];

    // Skip when there are no alignment lines or Paper.js is not ready.
    if (!alignments.length || !paper.project) {
      return;
    }

    // Scale stroke width with zoom for consistent visuals.
    const strokeWidth = 0.8 / Math.max(zoom, 0.1);
    const dashLength = 3.5 / Math.max(zoom, 0.1);

    alignments.forEach((alignment) => {
      const isCenter = alignment.type === 'centerX' || alignment.type === 'centerY';
      const color = isCenter ? COLORS.center : COLORS.edge;

      let line: paper.Path;

      if (alignment.orientation === 'vertical') {
        // Vertical line (X alignment).
        line = new paper.Path.Line({
          from: new paper.Point(alignment.position, alignment.start),
          to: new paper.Point(alignment.position, alignment.end),
          strokeColor: new paper.Color(color),
          strokeWidth,
          dashArray: [dashLength, dashLength],
        });
      } else {
        // Horizontal line (Y alignment).
        line = new paper.Path.Line({
          from: new paper.Point(alignment.start, alignment.position),
          to: new paper.Point(alignment.end, alignment.position),
          strokeColor: new paper.Color(color),
          strokeWidth,
          dashArray: [dashLength, dashLength],
        });
      }

      // Mark as helper line.
      line.data = { type: 'snap-guide', isHelper: true };

      // Bring guide to front.
      try {
        line.bringToFront();
      } catch {
        // Ignore errors.
      }

      guidesRef.current.push(line);
    });

    // Update Paper view.
    try {
      paper.view.update();
    } catch {
      // Ignore errors.
    }

    // Cleanup.
    return () => {
      guidesRef.current.forEach((guide) => {
        try {
          guide.remove();
        } catch {
          // Ignore already removed objects.
        }
      });
      guidesRef.current = [];
    };
  }, [alignments, zoom]);

  // Logical-only component; renders no DOM.
  return null;
}
