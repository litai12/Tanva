import React from 'react';
import { Separator } from '../ui/separator';
import { SelectToolGroup, DrawingToolGroup, MediaToolGroup, UtilityToolGroup } from './groups';
import { ColorPicker, StrokeWidthControl } from './controls';
import { useToolbarState } from './hooks';


interface ToolBarProps {
  style?: React.CSSProperties;
  showLayerPanel?: boolean;
  onClearCanvas?: () => void;
}


const ToolBar: React.FC<ToolBarProps> = ({
  showLayerPanel = false,
  onClearCanvas,
}) => {
  // 使用自定义状态管理hook
  const {
    drawMode,
    currentColor,
    strokeWidth,
    isEraser,
    setDrawMode,
    setCurrentColor,
    setStrokeWidth,
    toggleEraser,
  } = useToolbarState();

  return (
    <div
      className={`fixed top-1/2 transform -translate-y-1/2 flex flex-col items-center gap-3 px-2 py-3 rounded-lg bg-white/95 backdrop-blur-sm shadow-lg border border-gray-200/50 z-[1000] transition-all duration-300 ${
        showLayerPanel ? 'left-[295px]' : 'left-2'
      }`}
      style={{
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08)'
      }}
    >
      {/* 选择工具组 */}
      <SelectToolGroup 
        currentMode={drawMode} 
        onModeChange={setDrawMode} 
      />

      {/* 绘制工具组 - 悬停展开 */}
      <DrawingToolGroup 
        currentMode={drawMode}
        isEraser={isEraser}
        onModeChange={setDrawMode}
      />

      <Separator orientation="horizontal" className="w-8" />

      {/* 颜色控制 */}
      <ColorPicker 
        value={currentColor}
        onChange={setCurrentColor}
        disabled={isEraser}
      />

      {/* 线宽控制 */}
      <StrokeWidthControl 
        value={strokeWidth}
        onChange={setStrokeWidth}
        disabled={isEraser}
      />

      <Separator orientation="horizontal" className="w-8" />

      {/* 媒体工具组 - 文字、图片、3D、截图 */}
      <MediaToolGroup 
        currentMode={drawMode}
        onModeChange={setDrawMode}
      />

      <Separator orientation="horizontal" className="w-8" />

      {/* 实用工具组 - 橡皮擦、清理 */}
      <UtilityToolGroup 
        isEraser={isEraser}
        onToggleEraser={toggleEraser}
        onClearCanvas={onClearCanvas}
      />
    </div>
  );
};

export default ToolBar;