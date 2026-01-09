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
  const colorInputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInPanel = panelRef.current?.contains(target);
      const clickedInButton = buttonRef.current?.contains(target);
      const clickedInColorInput = colorInputRef.current?.contains(target);
      
      // 检查是否点击在 color input 上（原生颜色选择器弹窗不在 DOM 中，但点击 input 本身会在这里）
      const isColorInput = colorInputRef.current === target || 
                          (target as HTMLElement)?.tagName === 'INPUT' && 
                          (target as HTMLInputElement)?.type === 'color';

      // 如果点击在面板、按钮或颜色输入框上，保持面板打开
      // 原生颜色选择器弹窗不在 DOM 中，所以不会触发外部点击检测
      if (panelRef.current && !clickedInPanel &&
          buttonRef.current && !clickedInButton &&
          !clickedInColorInput && !isColorInput) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      // 使用捕获阶段，确保在事件冒泡前处理
      document.addEventListener('mousedown', handleClickOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [isOpen]);

  const handleColorSelect = (color: string, shouldClose: boolean = true) => {
    onChange(color);
    if (shouldClose) {
      setIsOpen(false);
    }
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
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
          }
        }}
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
          className="absolute left-0 z-50 p-3 bg-white border border-gray-300 rounded-lg shadow-lg top-8 w-60"
        >
          {/* 预设颜色网格 - 1行10列 */}
          <div className="grid grid-cols-10 gap-1 mb-3">
            {/* 显示前10个颜色 */}
            {PRESET_COLORS.slice(0, 10).map((color, index) => (
              <div
                key={index}
                className="w-5 h-5 transition-all rounded cursor-pointer hover:ring-2 hover:ring-blue-400"
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
                className="flex items-center justify-center w-16 h-8 bg-white border border-gray-300 rounded cursor-pointer hover:ring-2 hover:ring-blue-400"
                onClick={handleTransparentSelect}
                title="透明（无填充）"
              >
                <TransparentIcon />
              </div>
            )}
            
            {/* 自定义颜色按钮 */}
            <label 
              className={cn("block", showTransparent ? "flex-1" : "w-full")}
            >
              <input
                ref={colorInputRef}
                type="color"
                value={value}
                onClick={(e) => {
                  // 阻止事件冒泡，防止触发外部点击检测
                  e.stopPropagation();
                }}
                onChange={(e) => {
                  // 只更新颜色值，不关闭面板，让用户可以继续调整
                  handleColorSelect(e.target.value, false);
                }}
                onBlur={() => {
                  // 当颜色选择器失去焦点时，延迟关闭面板
                  // 使用 setTimeout 确保原生颜色选择器弹窗关闭后再关闭面板
                  setTimeout(() => {
                    setIsOpen(false);
                  }, 200);
                }}
                className="sr-only"
              />
              <div 
                className="flex items-center justify-center w-full h-8 text-xs font-medium text-gray-600 border border-gray-300 rounded cursor-pointer bg-gray-50 hover:bg-gray-100"
                onClick={(e) => {
                  // 触发 color input 的点击
                  e.preventDefault();
                  colorInputRef.current?.click();
                }}
              >
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