import React from 'react';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Eraser, Square, Trash2, Box, Image } from 'lucide-react';
import { useToolStore } from '@/stores';

// 自定义图标组件
const LineIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const DashedSelectIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" fill="none" />
  </svg>
);

const CircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

const PolylineIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    {/* 多段线路径 */}
    <path
      d="M2 12 L6 4 L10 8 L14 2"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    {/* 起始点 */}
    <circle cx="2" cy="12" r="1.5" fill="currentColor" />
    {/* 中间节点 */}
    <circle cx="6" cy="4" r="1" fill="currentColor" />
    <circle cx="10" cy="8" r="1" fill="currentColor" />
    {/* 结束点 */}
    <circle cx="14" cy="2" r="1.5" fill="currentColor" />
  </svg>
);


interface ToolBarProps {
  style?: React.CSSProperties;
  showLayerPanel?: boolean;
  onClearCanvas?: () => void;
}

// 自定义垂直滑块组件
const VerticalSlider: React.FC<{
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}> = ({ value, min, max, onChange, disabled = false }) => {
  const sliderRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;
    setIsDragging(true);
    updateValue(e);
    e.preventDefault();
  };

  const updateValue = (e: MouseEvent | React.MouseEvent) => {
    if (!sliderRef.current || disabled) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = Math.max(0, Math.min(1, 1 - (y / rect.height))); // 反转，顶部为最大值
    const newValue = Math.round(min + percentage * (max - min));
    onChange(newValue);
  };

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        updateValue(e);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 计算滑块位置（从底部开始计算）
  const percentage = (value - min) / (max - min);
  const thumbPosition = (1 - percentage) * 100; // 反转位置

  return (
    <div
      ref={sliderRef}
      className={`relative w-2 h-20 bg-gray-200 rounded-full cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onMouseDown={handleMouseDown}
    >
      {/* 填充的进度条 */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-blue-500 rounded-full transition-all duration-150"
        style={{ height: `${percentage * 100}%` }}
      />
      {/* 滑块圆圈 */}
      <div
        className="absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full shadow-md transform -translate-x-0.5 -translate-y-1/2 transition-all duration-150"
        style={{ top: `${thumbPosition}%` }}
      />
    </div>
  );
};

const ToolBar: React.FC<ToolBarProps> = ({
  showLayerPanel = false,
  onClearCanvas,
}) => {
  // 使用 Zustand store
  const {
    drawMode,
    currentColor,
    strokeWidth,
    isEraser,
    setDrawMode,
    setCurrentColor,
    setStrokeWidth,
    toggleEraser,
  } = useToolStore();

  return (
    <div
      className={`fixed top-1/2 transform -translate-y-1/2 flex flex-col items-center gap-3 px-2 py-3 rounded-lg bg-white/95 backdrop-blur-sm shadow-lg border border-gray-200/50 z-[1000] transition-all duration-300 ${
        showLayerPanel ? 'left-[295px]' : 'left-2'
      }`}
      style={{
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08)'
      }}
    >
      {/* 选择工具 - 独立按钮 */}
      <Button
        variant={drawMode === 'select' ? 'default' : 'outline'}
        size="sm"
        className="px-2 py-2 h-8 w-8 mb-2"
        onClick={() => setDrawMode('select')}
        title="选择模式"
      >
        <DashedSelectIcon className="w-4 h-4" />
      </Button>

      {/* 绘制工具分组 - 悬停展开 */}
      <div className="relative group">
        {/* 主按钮 - 显示当前绘制模式 */}
        <Button
          variant={drawMode !== 'select' && drawMode !== 'text' && drawMode !== 'image' && drawMode !== '3d-model' && drawMode !== 'screenshot' && !isEraser ? "default" : "outline"}
          size="sm"
          className="px-2 py-2 h-8 w-8"
          onClick={() => {
            // 如果当前没有激活绘图工具（选择模式、橡皮擦模式或其他独立工具），切换到默认的绘线工具
            if (drawMode === 'select' || isEraser || drawMode === 'text' || drawMode === 'image' || drawMode === '3d-model' || drawMode === 'screenshot') {
              setDrawMode('free');
              console.log('工具栏主按钮：切换到绘线工具');
            }
          }}
          title={
            drawMode === 'select' || isEraser || drawMode === 'text' || drawMode === 'image' || drawMode === '3d-model' || drawMode === 'screenshot' 
              ? '点击切换到绘线工具' 
              : `当前工具：${drawMode === 'free' ? '绘线' : drawMode === 'rect' ? '矩形' : drawMode === 'circle' ? '圆形' : drawMode === 'polyline' ? '多段线' : drawMode}`
          }
        >
          {drawMode === 'free' && <LineIcon className="w-4 h-4" />}
          {drawMode === 'rect' && <Square className="w-4 h-4" />}
          {drawMode === 'circle' && <CircleIcon className="w-4 h-4" />}
          {/* 如果是选择模式或独立工具模式，显示默认的直线图标但为非激活状态 */}
          {(drawMode === 'select' || drawMode === 'image' || drawMode === '3d-model' || drawMode === 'text' || drawMode === 'screenshot' || drawMode === 'polyline') && <LineIcon className="w-4 h-4" />}
        </Button>

        {/* 悬停展开的绘制工具菜单 */}
        <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-in-out z-[1001]">
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/95 backdrop-blur-sm shadow-lg border border-gray-200/50">
            <Button
              variant={drawMode === 'free' && !isEraser ? 'default' : 'outline'}
              size="sm"
              className="px-2 py-2 h-8 w-8"
              onClick={() => setDrawMode('free')}
              title="自由画线"
            >
              <LineIcon className="w-4 h-4" />
            </Button>
            <Button
              variant={drawMode === 'rect' && !isEraser ? 'default' : 'outline'}
              size="sm"
              className="px-2 py-2 h-8 w-8"
              onClick={() => setDrawMode('rect')}
              title="绘制矩形"
            >
              <Square className="w-4 h-4" />
            </Button>
            <Button
              variant={drawMode === 'circle' && !isEraser ? 'default' : 'outline'}
              size="sm"
              className="px-2 py-2 h-8 w-8"
              onClick={() => setDrawMode('circle')}
              title="绘制圆形"
            >
              <CircleIcon className="w-4 h-4" />
            </Button>
            {/* 多段线工具 - 暂时关闭 */}
            {/* <Button
              variant={drawMode === 'polyline' && !isEraser ? 'default' : 'outline'}
              size="sm"
              className="px-2 py-2 h-8 w-8"
              onClick={() => setDrawMode('polyline')}
              title="绘制多段线"
            >
              <PolylineIcon className="w-4 h-4" />
            </Button> */}
          </div>
        </div>
      </div>

      <Separator orientation="horizontal" className="w-8" />

      {/* 颜色选择器 */}
      <input
        type="color"
        value={currentColor}
        onChange={(e) => setCurrentColor(e.target.value)}
        disabled={isEraser}
        className="w-6 h-6 rounded border border-gray-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      />

      {/* 线宽控制 */}
      <div className="flex flex-col items-center gap-2 my-2">
        <div className="flex flex-col items-center gap-2 w-full">
          <VerticalSlider
            value={strokeWidth}
            min={1}
            max={20}
            onChange={setStrokeWidth}
            disabled={isEraser}
          />
          <span className="text-xs text-gray-600 font-medium">
            {strokeWidth}
          </span>
        </div>
      </div>

      <Separator orientation="horizontal" className="w-8" />

      {/* 独立工具按钮 - 暂时只保留3D模型工具 */}
      <div className="flex flex-col items-center gap-2">
        {/* 文字工具 - 暂时关闭 */}
        {/* <Button
          variant={drawMode === 'text' ? 'default' : 'outline'}
          size="sm"
          className="px-2 py-2 h-8 w-8"
          onClick={() => setDrawMode('text')}
          title="添加文本"
        >
          <Type className="w-4 h-4" />
        </Button> */}

        {/* 图片工具 */}
        <Button
          variant={drawMode === 'image' ? 'default' : 'outline'}
          size="sm"
          className="px-2 py-2 h-8 w-8"
          onClick={() => setDrawMode('image')}
          title="添加图片"
        >
          <Image className="w-4 h-4" />
        </Button>

        {/* 3D模型工具 */}
        <Button
          variant={drawMode === '3d-model' ? 'default' : 'outline'}
          size="sm"
          className="px-2 py-2 h-8 w-8"
          onClick={() => setDrawMode('3d-model')}
          title="添加3D模型"
        >
          <Box className="w-4 h-4" />
        </Button>

        {/* 截图工具 - 暂时关闭 */}
        {/* <Button
          variant={drawMode === 'screenshot' ? 'default' : 'outline'}
          size="sm"
          className="px-2 py-2 h-8 w-8"
          onClick={() => setDrawMode('screenshot')}
          title="截图工具"
        >
          <Camera className="w-4 h-4" />
        </Button> */}
      </div>

      <Separator orientation="horizontal" className="w-8" />

      {/* 工具按钮 */}
      <div className="flex flex-col items-center gap-2">
        {/* 橡皮擦工具 */}
        <Button
          onClick={toggleEraser}
          variant={isEraser ? "default" : "outline"}
          size="sm"
          className="px-2 py-2 h-8 w-8"
          title={isEraser ? "切换到画笔" : "切换到橡皮擦"}
        >
          <Eraser className="w-4 h-4" />
        </Button>

        {/* 清理画布按钮 */}
        {onClearCanvas && (
          <Button
            onClick={() => {
              if (window.confirm('确定要清空画布吗？此操作将删除所有图元，不可撤销。')) {
                onClearCanvas();
              }
            }}
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 hover:bg-red-50 hover:border-red-200 hover:text-red-600"
            title="清空画布 (清除所有图元)"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default ToolBar;