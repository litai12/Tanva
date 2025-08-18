import React from 'react';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ 
  value, 
  onChange, 
  disabled = false 
}) => {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-6 h-6 rounded border border-gray-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
};

export default ColorPicker;