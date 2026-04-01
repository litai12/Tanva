/**
 * Scale bar renderer.
 * Draws a dynamic scale bar in the lower-left corner of the canvas.
 * Uses Paper.js and updates with zoom/unit settings.
 */

import { useEffect, useRef } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import { calculateScaleBarLength, calculateEffectiveScale, pixelsToUnit } from '@/lib/unitUtils';

interface ScaleBarRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isPaperInitialized: boolean;
}

const ScaleBarRenderer: React.FC<ScaleBarRendererProps> = ({ canvasRef, isPaperInitialized }) => {
  const scaleBarGroupRef = useRef<paper.Group | null>(null);

  const {
    units,
    scaleRatio,
    zoom,
    showScaleBar,
    panX,
    panY,
    gridSize,
  } = useCanvasStore();

  useEffect(() => {
    if (!isPaperInitialized || !canvasRef.current || !showScaleBar) {
      // Clear existing scale bar.
      if (scaleBarGroupRef.current) {
        scaleBarGroupRef.current.remove();
        scaleBarGroupRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !paper.project) return;

    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = canvas.width; // Device pixels.
    const canvasHeight = canvas.height;

    // Compute scale bar length/value using the same coordinate system as grid.

    // 1) Base grid spacing in world coordinates (kept in sync with GridRenderer).
    const baseGridWorldDistance = gridSize * 5; // 5 base grid units.

    // 2) Physical unit value for this world distance.
    const scaleBarUnitValue = pixelsToUnit(baseGridWorldDistance, scaleRatio, units);

    // 3) Render length uses world distance directly; Paper.js handles viewport transform.
    const mainGridPixelLength = baseGridWorldDistance;
    const scaleBarData = {
      pixelLength: mainGridPixelLength,
      unitValue: scaleBarUnitValue,
      displayText: `${scaleBarUnitValue.toFixed(scaleBarUnitValue < 1 ? 2 : 1)} ${units}`
    };

    // Clear previous scale bar.
    if (scaleBarGroupRef.current) {
      scaleBarGroupRef.current.remove();
    }

    // Create new scale bar group.
    const scaleBarGroup = new paper.Group();
    scaleBarGroup.data = { isHelper: true, type: 'scalebar' };
    scaleBarGroupRef.current = scaleBarGroup;

    // Scale bar position (bottom-right with margins).
    const marginRight = 65;
    const marginBottom = 50;
    const barLength = scaleBarData.pixelLength;

    // Account for viewport transform by converting screen to world coordinates.
    const screenBottomRight = new paper.Point(canvasWidth - marginRight * dpr, canvasHeight - marginBottom * dpr);
    const worldBottomRight = paper.view.viewToProject(screenBottomRight);

    const startX = worldBottomRight.x - barLength;
    const startY = worldBottomRight.y;

    // Main tick line.
    const mainLine = new paper.Path.Line(
      new paper.Point(startX, startY),
      new paper.Point(startX + barLength, startY)
    );
    mainLine.strokeColor = new paper.Color(0, 0, 0, 0.8);
    mainLine.strokeWidth = 1;
    mainLine.data = { isHelper: true, type: 'scalebar' };
    scaleBarGroup.addChild(mainLine);

    // Left tick (0 position).
    const leftTick = new paper.Path.Line(
      new paper.Point(startX, startY - 5),
      new paper.Point(startX, startY + 5)
    );
    leftTick.strokeColor = new paper.Color(0, 0, 0, 0.8);
    leftTick.strokeWidth = 1;
    leftTick.data = { isHelper: true, type: 'scalebar' };
    scaleBarGroup.addChild(leftTick);

    // Right tick (full value position).
    const rightTick = new paper.Path.Line(
      new paper.Point(startX + barLength, startY - 5),
      new paper.Point(startX + barLength, startY + 5)
    );
    rightTick.strokeColor = new paper.Color(0, 0, 0, 0.8);
    rightTick.strokeWidth = 1;
    rightTick.data = { isHelper: true, type: 'scalebar' };
    scaleBarGroup.addChild(rightTick);

    // Center label text.
    const labelText = new paper.PointText({
      point: new paper.Point(startX + barLength / 2, startY + 20),
      content: `${scaleBarUnitValue.toFixed(scaleBarUnitValue < 1 ? 2 : 1)} ${units}`,
      fontSize: 12,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fillColor: new paper.Color(0, 0, 0, 0.8),
      justification: 'center',
      data: { isHelper: true, type: 'scalebar' }
    });
    scaleBarGroup.addChild(labelText);

    // Keep scale bar on top.
    scaleBarGroup.bringToFront();

    return () => {
      if (scaleBarGroupRef.current) {
        scaleBarGroupRef.current.remove();
        scaleBarGroupRef.current = null;
      }
    };
  }, [isPaperInitialized, canvasRef, units, scaleRatio, zoom, showScaleBar, panX, panY, gridSize]);

  // This component renders no DOM; drawing happens in Paper.js.
  return null;
};

export default ScaleBarRenderer;
