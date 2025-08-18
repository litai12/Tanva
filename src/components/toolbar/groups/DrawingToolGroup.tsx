import React from 'react';
import { Button } from '@/components/ui/button';
import { Square } from 'lucide-react';
import { LineIcon, CircleIcon, PolylineIcon } from '../icons';
import type { DrawMode } from '@/stores';

interface DrawingToolGroupProps {
  currentMode: DrawMode;
  isEraser: boolean;
  onModeChange: (mode: DrawMode) => void;
}

const DrawingToolGroup: React.FC<DrawingToolGroupProps> = ({ 
  currentMode, 
  isEraser, 
  onModeChange 
}) => {
  const isDrawingMode = (mode: DrawMode) => 
    ['free', 'rect', 'circle', 'polyline'].includes(mode);

  const isActive = isDrawingMode(currentMode) && !isEraser;

  const getCurrentIcon = () => {
    switch (currentMode) {
      case 'free': return <LineIcon className="w-4 h-4" />;
      case 'rect': return <Square className="w-4 h-4" />;
      case 'circle': return <CircleIcon className="w-4 h-4" />;
      case 'polyline': return <PolylineIcon className="w-4 h-4" />;
      default: return <LineIcon className="w-4 h-4" />;
    }
  };

  const getTitle = () => {
    if (!isActive) return '点击切换到绘线工具';
    
    const toolNames = {
      free: '绘线',
      rect: '矩形', 
      circle: '圆形',
      polyline: '多段线'
    };
    
    return `当前工具：${toolNames[currentMode as keyof typeof toolNames] || currentMode}`;
  };

  const handleMainClick = () => {
    if (!isActive) {
      onModeChange('free');
      console.log('工具栏主按钮：切换到绘线工具');
    }
  };

  return (
    <div className="relative group">
      {/* 主按钮 - 显示当前绘制模式 */}
      <Button
        variant={isActive ? "default" : "outline"}
        size="sm"
        className="px-2 py-2 h-8 w-8"
        onClick={handleMainClick}
        title={getTitle()}
      >
        {getCurrentIcon()}
      </Button>

      {/* 悬停展开的绘制工具菜单 */}
      <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-in-out z-[1001]">
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/95 backdrop-blur-sm shadow-lg border border-gray-200/50">
          <Button
            variant={currentMode === 'free' && !isEraser ? 'default' : 'outline'}
            size="sm"
            className="px-2 py-2 h-8 w-8"
            onClick={() => onModeChange('free')}
            title="自由画线"
          >
            <LineIcon className="w-4 h-4" />
          </Button>
          <Button
            variant={currentMode === 'rect' && !isEraser ? 'default' : 'outline'}
            size="sm"
            className="px-2 py-2 h-8 w-8"
            onClick={() => onModeChange('rect')}
            title="绘制矩形"
          >
            <Square className="w-4 h-4" />
          </Button>
          <Button
            variant={currentMode === 'circle' && !isEraser ? 'default' : 'outline'}
            size="sm"
            className="px-2 py-2 h-8 w-8"
            onClick={() => onModeChange('circle')}
            title="绘制圆形"
          >
            <CircleIcon className="w-4 h-4" />
          </Button>
          <Button
            variant={currentMode === 'polyline' && !isEraser ? 'default' : 'outline'}
            size="sm"
            className="px-2 py-2 h-8 w-8"
            onClick={() => onModeChange('polyline')}
            title="绘制多段线"
          >
            <PolylineIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DrawingToolGroup;