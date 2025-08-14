/**
 * 比例尺渲染组件
 * 在画布左下角显示动态比例尺
 * 使用 Paper.js 在画布上渲染，随缩放和单位设置自动更新
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
      // 清理已有的比例尺
      if (scaleBarGroupRef.current) {
        scaleBarGroupRef.current.remove();
        scaleBarGroupRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !paper.project) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // 计算比例尺的合适长度和显示值
    // 修复网格与比例尺不同步问题：使用与网格相同的坐标系统
    
    // 1. 基础网格在世界坐标系中的间距（与 GridRenderer 保持一致）
    const baseGridWorldDistance = gridSize * 5; // 5个基础网格单位，与网格系统完全相同
    
    // 2. 这个世界坐标距离对应的实际物理距离
    const scaleBarUnitValue = pixelsToUnit(baseGridWorldDistance, scaleRatio, units);
    
    // 3. 比例尺的渲染长度直接使用世界坐标距离（与网格同步）
    const mainGridPixelLength = baseGridWorldDistance; // 直接使用世界坐标，让 Paper.js 处理视口变换
    const scaleBarData = {
      pixelLength: mainGridPixelLength,
      unitValue: scaleBarUnitValue,
      displayText: `${scaleBarUnitValue.toFixed(scaleBarUnitValue < 1 ? 2 : 1)} ${units}`
    };

    // 清理旧的比例尺
    if (scaleBarGroupRef.current) {
      scaleBarGroupRef.current.remove();
    }

    // 创建新的比例尺组
    const scaleBarGroup = new paper.Group();
    scaleBarGroupRef.current = scaleBarGroup;

    // 比例尺的位置（右下角，留出边距）
    const marginRight = 65; // 再向右移动5px (70 - 5 = 65)
    const marginBottom = 50; // 向下移动20px (30 + 20 = 50)
    const barLength = scaleBarData.pixelLength;
    
    // 考虑视口变换的右下角定位
    // 将屏幕坐标转换为 Paper.js 世界坐标
    const screenBottomRight = new paper.Point(canvasWidth - marginRight, canvasHeight - marginBottom);
    const worldBottomRight = paper.view.viewToProject(screenBottomRight);
    
    const startX = worldBottomRight.x - barLength;
    const startY = worldBottomRight.y;

    // 创建主刻度线 (一个完整格子)
    const mainLine = new paper.Path.Line(
      new paper.Point(startX, startY),
      new paper.Point(startX + barLength, startY)
    );
    mainLine.strokeColor = new paper.Color(0, 0, 0, 0.8);
    mainLine.strokeWidth = 1;
    scaleBarGroup.addChild(mainLine);

    // 创建左端刻度 (0 位置)
    const leftTick = new paper.Path.Line(
      new paper.Point(startX, startY - 5),
      new paper.Point(startX, startY + 5)
    );
    leftTick.strokeColor = new paper.Color(0, 0, 0, 0.8);
    leftTick.strokeWidth = 1;
    scaleBarGroup.addChild(leftTick);

    // 创建右端刻度 (完整值位置)
    const rightTick = new paper.Path.Line(
      new paper.Point(startX + barLength, startY - 5),
      new paper.Point(startX + barLength, startY + 5)
    );
    rightTick.strokeColor = new paper.Color(0, 0, 0, 0.8);
    rightTick.strokeWidth = 1;
    scaleBarGroup.addChild(rightTick);

    // 创建主数值的标签文本 (显示在比例尺中间位置)
    const labelText = new paper.PointText({
      point: new paper.Point(startX + barLength / 2, startY + 20),
      content: `${scaleBarUnitValue.toFixed(scaleBarUnitValue < 1 ? 2 : 1)} ${units}`,
      fontSize: 12,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fillColor: new paper.Color(0, 0, 0, 0.8),
      justification: 'center'
    });
    scaleBarGroup.addChild(labelText);

    // 确保比例尺始终在最上层
    scaleBarGroup.bringToFront();

    return () => {
      if (scaleBarGroupRef.current) {
        scaleBarGroupRef.current.remove();
        scaleBarGroupRef.current = null;
      }
    };
  }, [isPaperInitialized, canvasRef, units, scaleRatio, zoom, showScaleBar, panX, panY, gridSize]);

  // 组件本身不渲染任何DOM元素，所有绘制都在Paper.js画布上
  return null;
};

export default ScaleBarRenderer;