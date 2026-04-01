import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Pipette } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperInstance {
  open: () => Promise<EyeDropperResult>;
}

type EyeDropperConstructor = new () => EyeDropperInstance;

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
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '')
    .toLowerCase()
    .startsWith('zh');
  const lt = (zh: string, en: string) => (isZh ? zh : en);
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const cleanupCanvasPickRef = useRef<(() => void) | null>(null);
  const [isCanvasPicking, setIsCanvasPicking] = useState(false);
  const eyeDropperSupported = typeof window !== 'undefined' &&
    typeof (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper === 'function';

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

  const rgbToHex = (r: number, g: number, b: number): string => {
    const toHex = (value: number) => value.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const startCanvasFallbackPick = () => {
    const canvas = document.querySelector('canvas.tanva-main-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    setIsOpen(false);
    setIsCanvasPicking(true);

    const previousBodyCursor = document.body.style.cursor;
    const previousCanvasCursor = canvas.style.cursor;
    document.body.style.cursor = 'crosshair';
    canvas.style.cursor = 'crosshair';

    const cleanup = () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.cursor = previousBodyCursor;
      canvas.style.cursor = previousCanvasCursor;
      cleanupCanvasPickRef.current = null;
      setIsCanvasPicking(false);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const clickedCanvas = event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (clickedCanvas) {
        event.preventDefault();
        event.stopPropagation();
        const x = Math.floor((event.clientX - rect.left) * (canvas.width / rect.width));
        const y = Math.floor((event.clientY - rect.top) * (canvas.height / rect.height));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx && Number.isFinite(x) && Number.isFinite(y)) {
          try {
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            handleColorSelect(rgbToHex(pixel[0], pixel[1], pixel[2]));
          } catch (error) {
            console.error('Canvas color pick failed:', error);
          }
        }
      }

      cleanup();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cleanup();
      }
    };

    cleanupCanvasPickRef.current = cleanup;
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
  };

  const handleEyeDropperPick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!eyeDropperSupported) {
      startCanvasFallbackPick();
      return;
    }

    try {
      const EyeDropperCtor = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
      if (!EyeDropperCtor) return;
      const eyeDropper = new EyeDropperCtor();
      const result = await eyeDropper.open();
      if (result?.sRGBHex) {
        handleColorSelect(result.sRGBHex);
      }
    } catch (error) {
      // 用户主动取消取色时浏览器会抛 AbortError，这里静默忽略。
      if ((error as { name?: string })?.name !== 'AbortError') {
        console.error('EyeDropper failed:', error);
      }
    }
  };

  useEffect(() => {
    return () => {
      cleanupCanvasPickRef.current?.();
    };
  }, []);

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
            {PRESET_COLORS.slice(0, 10).map((color, index) => {
              const normalized = (color || '').toString().trim().toLowerCase();
              const isWhite = normalized === '#ffffff' || normalized === 'white';
              return (
                <div
                  key={index}
                  className="w-5 h-5 transition-all rounded cursor-pointer hover:ring-2 hover:ring-blue-400"
                  style={{
                    backgroundColor: color,
                    // 给白色色块一条很细的黑灰色边框，其他颜色使用透明边框保证大小一致
                    border: isWhite ? '1px solid rgba(0,0,0,0.35)' : '1px solid transparent'
                  }}
                  onClick={() => handleColorSelect(color)}
                  title={color}
                />
              );
            })}
          </div>

          {/* 无填充和More按钮并列 */}
          <div className="flex gap-2">
            {/* 无填充选项（如果需要） */}
            {showTransparent && (
              <div
                className="flex items-center justify-center w-16 h-8 bg-white border border-gray-300 rounded cursor-pointer hover:ring-2 hover:ring-blue-400"
                onClick={handleTransparentSelect}
                title={lt('透明（无填充）', 'Transparent (no fill)')}
              >
                <TransparentIcon />
              </div>
            )}
            
            {/* 自定义颜色与吸管取色 */}
            <div className={cn("flex gap-2", showTransparent ? "flex-1" : "w-full")}>
              <input
                ref={colorInputRef}
                type="color"
                value={value}
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
              <button
                type="button"
                className="flex items-center justify-center flex-1 h-8 text-xs font-medium text-gray-600 border border-gray-300 rounded cursor-pointer bg-gray-50 hover:bg-gray-100"
                onClick={() => {
                  colorInputRef.current?.click();
                }}
              >
                {lt('更多', 'More')}
              </button>
              <button
                type="button"
                onClick={handleEyeDropperPick}
                title={
                  isCanvasPicking
                    ? lt('正在等待点击画布取色（Esc 取消）', 'Waiting for canvas pick (Esc to cancel)')
                    : (eyeDropperSupported
                      ? lt('吸管取色（从画布拾取）', 'Eyedropper (pick from canvas)')
                      : lt('点击后在画布上取色（Esc 取消）', 'Click to pick from canvas (Esc to cancel)'))
                }
                className={cn(
                  "flex items-center justify-center w-8 h-8 border border-gray-300 rounded bg-gray-50 text-gray-600 cursor-pointer hover:bg-gray-100",
                  isCanvasPicking && "bg-blue-50 border-blue-300 text-blue-600"
                )}
              >
                <Pipette className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
