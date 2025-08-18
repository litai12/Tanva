import React from 'react';
import { Button } from '@/components/ui/button';
import { DashedSelectIcon } from '../icons';
import type { DrawMode } from '@/stores';

interface SelectToolGroupProps {
  currentMode: DrawMode;
  onModeChange: (mode: DrawMode) => void;
}

const SelectToolGroup: React.FC<SelectToolGroupProps> = ({ 
  currentMode, 
  onModeChange 
}) => {
  return (
    <Button
      variant={currentMode === 'select' ? 'default' : 'outline'}
      size="sm"
      className="px-2 py-2 h-8 w-8 mb-2"
      onClick={() => onModeChange('select')}
      title="选择模式"
    >
      <DashedSelectIcon className="w-4 h-4" />
    </Button>
  );
};

export default SelectToolGroup;