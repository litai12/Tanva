import React from 'react';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Eraser, Square, Trash2, Box, Image, Layers, Camera, Wand2, Sparkles, Maximize2, Type } from 'lucide-react';
import TextStylePanel from './TextStylePanel';
import { useToolStore, useUIStore } from '@/stores';
import { useAIChatStore } from '@/stores/aiChatStore';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import paper from 'paper';

// 自定义图标组件
// 直线工具图标
const StraightLineIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// 自由绘制图标
const FreeDrawIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <path
      d="M2 10 Q4 2 6 6 T10 4 Q12 8 14 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
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

// 带蓝色加号的图片图标
const ImageWithPlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div className="relative">
    <Image className={className} />
    <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-blue-500 rounded-full flex items-center justify-center">
      <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
        <path d="M3 1 L3 5 M1 3 L5 3" stroke="white" strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>
  </div>
);

// 快速图片上传图标（带绿色加号，表示快速添加）
const QuickImageIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div className="relative">
    <Image className={className} />
    <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full flex items-center justify-center">
      <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
        <path d="M3 1 L3 5 M1 3 L5 3" stroke="white" strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>
  </div>
);

// 带蓝色加号的3D模型图标
const BoxWithPlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div className="relative">
    <Box className={className} />
    <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-blue-500 rounded-full flex items-center justify-center">
      <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
        <path d="M3 1 L3 5 M1 3 L5 3" stroke="white" strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>
  </div>
);

// AI编辑图像图标（图片+魔法棒）
const AIEditImageIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div className="relative">
    <Image className={className} />
    <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-purple-500 rounded-full flex items-center justify-center">
      <Sparkles className="w-2 h-2 text-white" />
    </div>
  </div>
);


interface ToolBarProps {
  style?: React.CSSProperties;
  showLayerPanel?: boolean;
  onClearCanvas?: () => void;
}

// 自定义水平滑块组件
const HorizontalSlider: React.FC<{
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
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
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

  // 计算滑块位置
  const percentage = (value - min) / (max - min);
  const thumbPosition = percentage * 100;

  return (
    <div
      ref={sliderRef}
      className={`relative w-20 h-2 bg-gray-200 rounded-full cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onMouseDown={handleMouseDown}
    >
      {/* 填充的进度条 */}
      <div
        className="absolute top-0 left-0 bottom-0 bg-blue-500 rounded-full transition-all duration-150"
        style={{ width: `${percentage * 100}%` }}
      />
      {/* 滑块圆圈 */}
      <div
        className="absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full shadow-md transform -translate-y-0.5 -translate-x-1/2 transition-all duration-150"
        style={{ left: `${thumbPosition}%` }}
      />
    </div>
  );
};

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
    const percentage = Math.max(0, Math.min(1, 1 - y / rect.height)); // 从下往上滑动值增大
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

  // 计算滑块位置
  const percentage = (value - min) / (max - min);

  return (
    <div
      ref={sliderRef}
      className={`relative w-2 h-24 bg-gray-200 rounded-full cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onMouseDown={handleMouseDown}
    >
      {/* 填充的进度条 */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-blue-500 rounded-full transition-all duration-150"
        style={{ height: `${percentage * 100}%` }}
      />
      {/* 滑块圆圈 */}
      <div
        className="absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full shadow-md transition-all duration-150"
        style={{ 
          bottom: `calc(${percentage * 100}% - 6px)`,
          left: '50%',
          transform: 'translateX(-50%)'
        }}
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

  const { showLayerPanel: isLayerPanelOpen, toggleLayerPanel } = useUIStore();
  const { toggleDialog, isVisible: isAIDialogVisible, setSourceImageForEditing, showDialog } = useAIChatStore();

  // 原始尺寸模式状态
  const [useOriginalSize, setUseOriginalSize] = React.useState(() => {
    return localStorage.getItem('tanva-use-original-size') === 'true';
  });

  // 切换原始尺寸模式
  const toggleOriginalSizeMode = () => {
    const newValue = !useOriginalSize;
    setUseOriginalSize(newValue);
    localStorage.setItem('tanva-use-original-size', newValue.toString());

    // 派发事件通知其他组件
    window.dispatchEvent(new CustomEvent('tanva-size-mode-changed'));

    console.log('🖼️ 原始尺寸模式:', newValue ? '启用' : '禁用');

    if (newValue) {
      console.log('📏 图像将以原始像素尺寸显示（1像素=1像素）');
    } else {
      console.log('📐 图像将自动缩放适应画布');
    }
  };

  // 处理AI编辑图像功能
  const handleAIEditImage = () => {
    // 检查画布中是否有选中的图像
    const imageInstances = (window as any).tanvaImageInstances || [];
    const selectedImage = imageInstances.find((img: any) => img.isSelected);

    if (selectedImage) {
      // 如果有选中的图像，获取其数据并设置为编辑源
      try {
        // 找到对应的Paper.js Raster对象
        const imageGroup = paper.project?.layers?.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId === selectedImage.id
          )
        )[0];

        if (imageGroup) {
          const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster;
          if (raster && raster.canvas) {
            const imageData = raster.canvas.toDataURL('image/png');
            setSourceImageForEditing(imageData);
            showDialog();
            console.log('🎨 已选择图像进行AI编辑');
          }
        }
      } catch (error) {
        console.error('获取图像数据失败:', error);
      }
    } else {
      // 如果没有选中图像，直接打开对话框让用户上传
      showDialog();
      console.log('🎨 打开AI对话框，用户可上传图像进行编辑');
    }
  };

  return (
    <div
      className={cn(
        "fixed top-1/2 transform -translate-y-1/2 flex flex-col items-center gap-2 px-2 py-3 rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass z-[1000] transition-all duration-[50ms] ease-out",
        isLayerPanelOpen ? "left-[322px]" : "left-2"
      )}
    >
      {/* AI生图工具 */}
      <Button
        variant={isAIDialogVisible ? 'default' : 'outline'}
        size="sm"
        className={cn(
          "p-0 h-8 w-8 rounded-full",
          isAIDialogVisible 
            ? "bg-blue-600 text-white" 
            : "bg-white/50 text-gray-700 border-gray-300"
        )}
        onClick={toggleDialog}
        title="AI对话"
      >
        <Sparkles className="w-4 h-4" />
      </Button>

      <Separator orientation="horizontal" className="w-6" />

      {/* 选择工具 - 独立按钮 */}
      <Button
        variant={drawMode === 'select' ? 'default' : 'outline'}
        size="sm"
        className={cn(
          "p-0 h-8 w-8 rounded-full",
          drawMode === 'select' 
            ? "bg-blue-600 text-white" 
            : "bg-white/50 text-gray-700 border-gray-300"
        )}
        onClick={() => setDrawMode('select')}
        title="选择模式"
      >
        <DashedSelectIcon className="w-4 h-4" />
      </Button>

      {/* 绘制工具分组 - 激活时固定显示 */}
      <div className="relative">
        {/* 主按钮 - 显示当前绘制模式 */}
        <Button
          variant={drawMode !== 'select' && drawMode !== 'text' && drawMode !== 'image' && drawMode !== '3d-model' && drawMode !== 'screenshot' && !isEraser ? "default" : "outline"}
          size="sm"
          className={cn(
            "p-0 h-8 w-8 rounded-full",
            drawMode !== 'select' && drawMode !== 'text' && drawMode !== 'image' && drawMode !== '3d-model' && drawMode !== 'screenshot' && !isEraser
              ? "bg-blue-600 text-white" 
              : "bg-white/50 border-gray-300"
          )}
          onClick={() => {
            // 如果当前没有激活绘图工具（选择模式、橡皮擦模式或其他独立工具），切换到默认的绘线工具
            if (drawMode === 'select' || isEraser || drawMode === 'text' || drawMode === 'image' || drawMode === '3d-model' || drawMode === 'screenshot') {
              setDrawMode('free');
              logger.tool('工具栏主按钮：切换到绘线工具');
            }
          }}
          title={
            drawMode === 'select' || isEraser || drawMode === 'text' || drawMode === 'image' || drawMode === '3d-model' || drawMode === 'screenshot'
              ? '点击切换到自由绘制工具'
              : `当前工具：${drawMode === 'free' ? '自由绘制' : drawMode === 'line' ? '直线' : drawMode === 'rect' ? '矩形' : drawMode === 'circle' ? '圆形' : drawMode === 'polyline' ? '多段线' : drawMode}`
          }
        >
          {drawMode === 'free' && <FreeDrawIcon className="w-4 h-4" />}
          {drawMode === 'line' && <StraightLineIcon className="w-4 h-4" />}
          {drawMode === 'rect' && <Square className="w-4 h-4" />}
          {drawMode === 'circle' && <CircleIcon className="w-4 h-4" />}
          {/* 如果是选择模式或独立工具模式，显示默认的自由绘制图标但为非激活状态 */}
          {(drawMode === 'select' || drawMode === 'image' || drawMode === '3d-model' || drawMode === 'text' || drawMode === 'screenshot' || drawMode === 'polyline') && <FreeDrawIcon className="w-4 h-4" />}
        </Button>

        {/* 固定显示的绘制工具菜单 - 当绘制工具激活时显示 */}
        {(drawMode === 'free' || drawMode === 'line' || drawMode === 'rect' || drawMode === 'circle') && !isEraser && (
          <div className="absolute left-full ml-3 transition-all duration-[50ms] ease-out z-[1001]" style={{ top: '-14px' }}>
            <div className="flex flex-col items-center gap-3 px-2 py-3 rounded-2xl bg-liquid-glass-light backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass-light" style={{ marginTop: '1px' }}>
              {/* 绘图工具按钮组 */}
              <div className="flex flex-col gap-1">
                <Button
                  variant={drawMode === 'free' && !isEraser ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "p-0 h-8 w-8 rounded-full",
                    drawMode === 'free' && !isEraser 
                      ? "bg-blue-600 text-white" 
                      : "bg-white/50 border-gray-300"
                  )}
                  onClick={() => setDrawMode('free')}
                  title="自由绘制"
                >
                  <FreeDrawIcon className="w-4 h-4" />
                </Button>
                <Button
                  variant={drawMode === 'line' && !isEraser ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "p-0 h-8 w-8 rounded-full",
                    drawMode === 'line' && !isEraser 
                      ? "bg-blue-600 text-white" 
                      : "bg-white/50 border-gray-300"
                  )}
                  onClick={() => setDrawMode('line')}
                  title="绘制直线"
                >
                  <StraightLineIcon className="w-4 h-4" />
                </Button>
                <Button
                  variant={drawMode === 'rect' && !isEraser ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "p-0 h-8 w-8 rounded-full",
                    drawMode === 'rect' && !isEraser 
                      ? "bg-blue-600 text-white" 
                      : "bg-white/50 border-gray-300"
                  )}
                  onClick={() => setDrawMode('rect')}
                  title="绘制矩形"
                >
                  <Square className="w-4 h-4" />
                </Button>
                <Button
                  variant={drawMode === 'circle' && !isEraser ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "p-0 h-8 w-8 rounded-full",
                    drawMode === 'circle' && !isEraser 
                      ? "bg-blue-600 text-white" 
                      : "bg-white/50 border-gray-300"
                  )}
                  onClick={() => setDrawMode('circle')}
                  title="绘制圆形"
                >
                  <CircleIcon className="w-4 h-4" />
                </Button>
              </div>

              <Separator orientation="horizontal" className="w-6" />

              {/* 颜色选择器 */}
              <input
                type="color"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
                disabled={isEraser}
                className="w-6 h-6 rounded border border-gray-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="选择颜色"
              />

              {/* 线宽控制 */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs text-gray-600 font-medium tabular-nums">
                  {strokeWidth}
                </span>
                <VerticalSlider
                  value={strokeWidth}
                  min={1}
                  max={20}
                  onChange={setStrokeWidth}
                  disabled={isEraser}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 橡皮擦工具 - 放在画笔工具下方 */}
      <Button
        onClick={toggleEraser}
        variant={isEraser ? "default" : "outline"}
        size="sm"
        className={cn(
          "p-0 h-8 w-8 rounded-full",
          isEraser 
            ? "bg-blue-600 text-white" 
            : "bg-white/50 border-gray-300"
        )}
        title={isEraser ? "切换到画笔" : "切换到橡皮擦"}
      >
        <Eraser className="w-4 h-4" />
      </Button>

      <Separator orientation="horizontal" className="w-6" />

      {/* 独立工具按钮 */}
      <div className="flex flex-col items-center gap-2">
        {/* 文字工具 */}
        <div className="relative">
          <Button
            variant={drawMode === 'text' ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "p-0 h-8 w-8 rounded-full",
              drawMode === 'text' 
                ? "bg-blue-600 text-white" 
                : "bg-white/50 border-gray-300"
            )}
            onClick={() => {
              setDrawMode('text');
              logger.tool('工具栏：切换到文字工具');
            }}
            title="文本工具 - 点击空白处创建文本"
          >
            <Type className="w-4 h-4" />
          </Button>

          {/* 文本样式面板 - 当文本工具激活时显示 */}
          {drawMode === 'text' && (
            <TextStylePanel
              currentStyle={(window as any).tanvaTextTool?.getSelectedTextStyle?.() || {
                fontFamily: 'Inter',
                fontWeight: 'normal',
                fontSize: 24,
                color: currentColor,
                align: 'left',
                italic: false
              }}
              onStyleChange={(updates) => {
                const textTool = (window as any).tanvaTextTool;
                if (textTool) {
                  // 如果有选中的文本，更新该文本的样式
                  if (textTool.selectedTextId) {
                    textTool.updateTextStyle(textTool.selectedTextId, updates);
                  } else {
                    // 否则更新默认样式
                    textTool.updateDefaultStyle(updates);
                  }
                }
              }}
            />
          )}
        </div>

        {/* 图片工具 */}
        <Button
          variant={drawMode === 'image' ? 'default' : 'outline'}
          size="sm"
          className={cn(
            "p-0 h-8 w-8 rounded-full",
            drawMode === 'image' 
              ? "bg-blue-600 text-white" 
              : "bg-white/50 border-gray-300"
          )}
          onClick={() => setDrawMode('image')}
          title="添加图片"
        >
          <ImageWithPlusIcon className="w-4 h-4" />
        </Button>

        {/* 快速图片上传工具（居中） - 暂时隐藏 */}
        {/* <Button
          variant={drawMode === 'quick-image' ? 'default' : 'outline'}
          size="sm"
          className="px-2 py-2 h-8 w-8 bg-white/50 border-gray-300"
          onClick={() => setDrawMode('quick-image')}
          title="快速上传图片（自动居中）"
        >
          <QuickImageIcon className="w-4 h-4" />
        </Button> */}

        {/* 3D模型工具 */}
        <Button
          variant={drawMode === '3d-model' ? 'default' : 'outline'}
          size="sm"
          className={cn(
            "p-0 h-8 w-8 rounded-full",
            drawMode === '3d-model' 
              ? "bg-blue-600 text-white" 
              : "bg-white/50 border-gray-300"
          )}
          onClick={() => setDrawMode('3d-model')}
          title="添加3D模型"
        >
          <BoxWithPlusIcon className="w-4 h-4" />
        </Button>

        {/* 截图工具 */}
        <Button
          variant={drawMode === 'screenshot' ? 'default' : 'outline'}
          size="sm"
          className={cn(
            "p-0 h-8 w-8 rounded-full",
            drawMode === 'screenshot' 
              ? "bg-blue-600 text-white" 
              : "bg-white/50 border-gray-300"
          )}
          onClick={() => setDrawMode('screenshot')}
          title="AI截图 - 自动包含所有元素，同时下载和传入AI对话框"
        >
          <Camera className="w-4 h-4" />
        </Button>


        {/* AI编辑图像工具 - 暂时隐藏 */}
        {/* <Button
          variant="outline"
          size="sm"
          className="px-2 py-2 h-8 w-8 bg-white/50 border-gray-300"
          onClick={handleAIEditImage}
          title="AI编辑图像 - 选择画布中的图像或上传图像进行AI编辑"
        >
          <AIEditImageIcon className="w-4 h-4" />
        </Button> */}

        {/* 原始尺寸模式切换 - 已隐藏，默认使用自适应模式 */}
        {/* <Button
          variant={useOriginalSize ? 'default' : 'outline'}
          size="sm"
          className="px-2 py-2 h-8 w-8 bg-white/50 border-gray-300"
          onClick={toggleOriginalSizeMode}
          title={useOriginalSize ? '当前：原始尺寸模式 (1像素=1像素)' : '当前：自适应模式 (自动缩放)'}
        >
          <Maximize2 className="w-4 h-4" />
        </Button> */}
      </div>

      <Separator orientation="horizontal" className="w-6" />

      {/* 图层工具 */}
      <Button
        variant={isLayerPanelOpen ? 'default' : 'outline'}
        size="sm"
        className={cn(
          "p-0 h-8 w-8 rounded-full",
          isLayerPanelOpen 
            ? "bg-blue-600 text-white" 
            : "bg-white/50 border-gray-300"
        )}
        onClick={toggleLayerPanel}
        title="图层面板"
      >
        <Layers className="w-4 h-4" />
      </Button>

      {/* 工具按钮 */}
      <div className="flex flex-col items-center gap-2">
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
            className="p-0 h-8 w-8 rounded-full bg-white/50 border-gray-300 hover:bg-red-50 hover:border-red-200 hover:text-red-600"
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