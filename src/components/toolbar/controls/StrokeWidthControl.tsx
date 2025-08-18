import React from 'react';
import VerticalSlider from './VerticalSlider';

interface StrokeWidthControlProps {
  value: number;
  onChange: (width: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}

const StrokeWidthControl: React.FC<StrokeWidthControlProps> = ({ 
  value, 
  onChange, 
  disabled = false,
  min = 1,
  max = 20
}) => {
  return (
    <div className="flex flex-col items-center gap-2 my-2">
      <div className="flex flex-col items-center gap-2 w-full">
        <VerticalSlider
          value={value}
          min={min}
          max={max}
          onChange={onChange}
          disabled={disabled}
        />
        <span className="text-xs text-gray-600 font-medium">
          {value}
        </span>
      </div>
    </div>
  );
};

export default StrokeWidthControl;