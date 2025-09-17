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
}

// 预设颜色面板 - 2行8列（16个颜色）
const PRESET_COLORS = [
  // 第一排：基础颜色（7个，为透明选项预留第一个位置）
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff',
  // 第二排：常用颜色（8个）
  '#808080', '#c0c0c0', '#ff6666', '#66ff66', '#6666ff', '#ffff66', '#ff66ff', '#66ffff',
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

const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  onTransparentSelect,
  disabled = false,
  className,
  title,
  showTransparent = false,
  isTransparent = false
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
          "w-6 h-6 rounded border border-gray-300 cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        style={{ backgroundColor: disabled ? '#f3f4f6' : (isTransparent ? '#ffffff' : value) }}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        title={title}
      >
        {/* 如果是透明状态，显示透明图标 */}
        {isTransparent && !disabled && (
          <TransparentIcon />
        )}
      </div>

      {/* 颜色面板 */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute left-0 top-8 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-3 w-44"
        >
          {/* 预设颜色网格 - 2行8列 */}
          <div className="grid grid-cols-8 gap-1 mb-3">
            {/* 第一排第一个位置：透明选项（如果需要） */}
            {showTransparent ? (
              <div
                className="w-5 h-5 cursor-pointer hover:ring-2 hover:ring-blue-400 rounded"
                onClick={handleTransparentSelect}
                title="透明（无填充）"
              >
                <TransparentIcon />
              </div>
            ) : (
              <div
                className="w-5 h-5 rounded cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                style={{ backgroundColor: PRESET_COLORS[0] }}
                onClick={() => handleColorSelect(PRESET_COLORS[0])}
                title={PRESET_COLORS[0]}
              />
            )}
            
            {/* 其余颜色位置 */}
            {PRESET_COLORS.slice(showTransparent ? 0 : 1).map((color, index) => (
              <div
                key={showTransparent ? index : index + 1}
                className="w-5 h-5 rounded cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                style={{ backgroundColor: color }}
                onClick={() => handleColorSelect(color)}
                title={color}
              />
            ))}
          </div>

          {/* 自定义颜色按钮 */}
          <div className="pt-2 border-t border-gray-200">
            <label className="block">
              <input
                type="color"
                value={value}
                onChange={(e) => handleColorSelect(e.target.value)}
                className="sr-only"
              />
              <div className="w-full h-8 bg-gray-50 border border-gray-300 rounded cursor-pointer hover:bg-gray-100 flex items-center justify-center text-xs text-gray-600 font-medium">
                更多颜色...
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;