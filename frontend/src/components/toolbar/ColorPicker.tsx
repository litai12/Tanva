import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onTransparentSelect?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  showTransparent?: boolean;
  isTransparent?: boolean; // 新增：是否当前为透明状态
  showLabel?: string; // 新增：在颜色块中心显示的字母标签
  showFillPattern?: boolean; // 新增：是否显示填充图案
}

// 预设颜色面板 - 1行12列（12个颜色）
const PRESET_COLORS = [
  // 参考系统颜色选择器的标准颜色
  '#000000', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#00ff00',
  '#00ffff', '#0000ff', '#ff00ff', '#800080', '#8b4513', '#808080'
];

// 透明选项图标 - 只保留对角线
const TransparentIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("relative w-full h-full bg-white border border-gray-300 rounded", className)}>
    {/* 对角线 */}
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 24 24">
      <line x1="2" y1="2" x2="22" y2="22" stroke="#e11d48" strokeWidth="2"/>
    </svg>
  </div>
);

// 填充图案图标 - 连续斜线填充效果
const FillPatternIcon: React.FC<{ className?: string; color: string }> = ({ className, color }) => {
  const patternId = `fillPattern-${Math.random().toString(36).substr(2, 9)}`;
  
  return (
    <div className={cn("relative w-full h-full rounded", className)}>
      {/* 背景色 */}
      <div className="absolute inset-0 rounded" style={{ backgroundColor: color }} />
      {/* 连续斜线图案 */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 24 24">
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width="3" height="3">
            <line x1="0" y1="3" x2="3" y2="0" stroke="rgba(255,255,255,0.7)" strokeWidth="0.8"/>
          </pattern>
        </defs>
        <rect width="24" height="24" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
};

const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  onTransparentSelect,
  disabled = false,
  className,
  title,
  showTransparent = false,
  isTransparent = false,
  showLabel,
  showFillPattern = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleColorSelect = (color: string) => {
    onChange(color);
    setIsOpen(false);
  };

  const handleTransparentSelect = () => {
    onTransparentSelect?.();
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* 颜色显示按钮 */}
      <div
        ref={buttonRef}
        className={cn(
          "w-6 h-6 rounded border border-gray-300 cursor-pointer relative flex items-center justify-center",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        style={{ backgroundColor: disabled ? '#f3f4f6' : (isTransparent ? '#ffffff' : value) }}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        title={title}
      >
        {/* 如果是透明状态，显示透明图标 */}
        {isTransparent && !disabled ? (
          <TransparentIcon />
        ) : showFillPattern && !disabled ? (
          /* 显示填充图案 */
          <FillPatternIcon color={value} />
        ) : showLabel ? (
          /* 显示字母标签 */
          <span 
            className="text-xs font-bold"
            style={{
              // 根据背景颜色自动调整文字颜色
              color: disabled ? '#9ca3af' : (value === '#ffffff' || value === '#ffff00' || value === '#00ffff' || value === '#ffff66') ? '#000000' : '#ffffff'
            }}
          >
            {showLabel}
          </span>
        ) : null}
      </div>

      {/* 颜色面板 */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute left-0 top-8 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-3 w-60"
        >
          {/* 预设颜色网格 - 1行10列 */}
          <div className="grid grid-cols-10 gap-1 mb-3">
            {/* 显示前10个颜色 */}
            {PRESET_COLORS.slice(0, 10).map((color, index) => (
              <div
                key={index}
                className="w-5 h-5 rounded cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                style={{ backgroundColor: color }}
                onClick={() => handleColorSelect(color)}
                title={color}
              />
            ))}
          </div>

          {/* 无填充和More按钮并列 */}
          <div className="flex gap-2">
            {/* 无填充选项（如果需要） */}
            {showTransparent && (
              <div
                className="w-16 h-8 cursor-pointer hover:ring-2 hover:ring-blue-400 rounded border border-gray-300 flex items-center justify-center bg-white"
                onClick={handleTransparentSelect}
                title="透明（无填充）"
              >
                <TransparentIcon />
              </div>
            )}
            
            {/* 自定义颜色按钮 */}
            <label className={cn("block", showTransparent ? "flex-1" : "w-full")}>
              <input
                type="color"
                value={value}
                onChange={(e) => handleColorSelect(e.target.value)}
                className="sr-only"
              />
              <div className="w-full h-8 bg-gray-50 border border-gray-300 rounded cursor-pointer hover:bg-gray-100 flex items-center justify-center text-xs text-gray-600 font-medium">
                More
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;