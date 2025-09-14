/**
 * 专业文本样式面板组件
 * 提供字体、字号、颜色、对齐等样式控制
 */

import React, { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AlignLeft, AlignCenter, AlignRight, Bold, Italic } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TextStyle {
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  italic: boolean;
}

interface TextStylePanelProps {
  currentStyle: TextStyle;
  onStyleChange: (updates: Partial<TextStyle>) => void;
}

const TextStylePanel: React.FC<TextStylePanelProps> = ({
  currentStyle,
  onStyleChange
}) => {
  
  // 字体选项
  const fontFamilies = [
    { value: 'Inter', label: 'Inter' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Helvetica', label: 'Helvetica' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Times', label: 'Times' },
    { value: 'Courier', label: 'Courier' },
    { value: 'Verdana', label: 'Verdana' }
  ];

  // 字重选项
  const fontWeights = [
    { value: 'normal', label: 'Regular' },
    { value: 'bold', label: 'Bold' }
  ];

  // 常用字号（12-72范围，一排显示）
  const fontSizes = [12, 16, 20, 24, 32, 48, 64, 72];

  const handleFontSizeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value) && value >= 12 && value <= 72) {
      onStyleChange({ fontSize: value });
    }
  }, [onStyleChange]);

  return (
    <div className="absolute left-full ml-3 transition-all duration-[50ms] ease-out z-[1001]" style={{ top: '-14px' }}>
      <div className="flex flex-col items-center gap-3 px-3 py-3 rounded-2xl bg-liquid-glass-light backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass-light min-w-[160px]">
        
        {/* 字体选择 */}
        <div className="w-full">
          <select
            value={currentStyle.fontFamily}
            onChange={(e) => onStyleChange({ fontFamily: e.target.value })}
            className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-white cursor-pointer"
            title="字体"
          >
            {fontFamilies.map(font => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </div>

        {/* 字重和样式 */}
        <div className="flex gap-2 w-full">
          <select
            value={currentStyle.fontWeight}
            onChange={(e) => onStyleChange({ fontWeight: e.target.value as 'normal' | 'bold' })}
            className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-300 bg-white cursor-pointer"
            title="字重"
          >
            {fontWeights.map(weight => (
              <option key={weight.value} value={weight.value}>
                {weight.label}
              </option>
            ))}
          </select>
          
          <Button
            variant={currentStyle.italic ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "p-0 h-7 w-7 rounded",
              currentStyle.italic 
                ? "bg-blue-600 text-white" 
                : "bg-white border-gray-300"
            )}
            onClick={() => onStyleChange({ italic: !currentStyle.italic })}
            title="斜体"
          >
            <Italic className="w-3 h-3" />
          </Button>
        </div>

        {/* 字号 */}
        <div className="w-full">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={currentStyle.fontSize}
              onChange={handleFontSizeChange}
              min="12"
              max="72"
              className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-300 bg-white text-center"
              title="字号"
            />
            <span className="text-xs text-gray-500">px</span>
          </div>
          
          {/* 常用字号快捷按钮 */}
          <div className="flex flex-wrap gap-1 mt-2">
            {fontSizes.map(size => (
              <Button
                key={size}
                variant={currentStyle.fontSize === size ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  "text-xs h-6 px-2",
                  currentStyle.fontSize === size 
                    ? "bg-blue-600 text-white" 
                    : "bg-white border-gray-300"
                )}
                onClick={() => onStyleChange({ fontSize: size })}
              >
                {size}
              </Button>
            ))}
          </div>
        </div>

        <Separator orientation="horizontal" className="w-full" />

        {/* 颜色选择 */}
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs text-gray-600">颜色</span>
          <input
            type="color"
            value={currentStyle.color}
            onChange={(e) => onStyleChange({ color: e.target.value })}
            className="w-8 h-6 rounded border border-gray-300 cursor-pointer"
            title="文字颜色"
          />
          
          {/* 常用颜色 */}
          <div className="flex gap-1">
            {['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF'].map(color => (
              <button
                key={color}
                onClick={() => onStyleChange({ color })}
                className={cn(
                  "w-5 h-5 rounded border-2 cursor-pointer",
                  currentStyle.color === color ? "border-blue-500" : "border-gray-300"
                )}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>

        <Separator orientation="horizontal" className="w-full" />

        {/* 对齐选项 */}
        <div className="flex gap-1 w-full">
          <Button
            variant={currentStyle.align === 'left' ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "flex-1 p-0 h-7",
              currentStyle.align === 'left' 
                ? "bg-blue-600 text-white" 
                : "bg-white border-gray-300"
            )}
            onClick={() => onStyleChange({ align: 'left' })}
            title="左对齐"
          >
            <AlignLeft className="w-3 h-3" />
          </Button>
          
          <Button
            variant={currentStyle.align === 'center' ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "flex-1 p-0 h-7",
              currentStyle.align === 'center' 
                ? "bg-blue-600 text-white" 
                : "bg-white border-gray-300"
            )}
            onClick={() => onStyleChange({ align: 'center' })}
            title="居中对齐"
          >
            <AlignCenter className="w-3 h-3" />
          </Button>
          
          <Button
            variant={currentStyle.align === 'right' ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "flex-1 p-0 h-7",
              currentStyle.align === 'right' 
                ? "bg-blue-600 text-white" 
                : "bg-white border-gray-300"
            )}
            onClick={() => onStyleChange({ align: 'right' })}
            title="右对齐"
          >
            <AlignRight className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TextStylePanel;