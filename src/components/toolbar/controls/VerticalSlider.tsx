import React from 'react';

interface VerticalSliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

const VerticalSlider: React.FC<VerticalSliderProps> = ({ 
  value, 
  min, 
  max, 
  onChange, 
  disabled = false 
}) => {
  const sliderRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;
    setIsDragging(true);
    updateValue(e);
    e.preventDefault();
  };

  const updateValue = React.useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!sliderRef.current || disabled) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = Math.max(0, Math.min(1, 1 - (y / rect.height))); // 反转，顶部为最大值
    const newValue = Math.round(min + percentage * (max - min));
    onChange(newValue);
  }, [min, max, onChange, disabled]);

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
  }, [isDragging, updateValue]);

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

export default VerticalSlider;