import React from 'react';
import { Camera, Send } from 'lucide-react';
import { Button } from '../ui/button';

interface SelectionGroupToolbarProps {
  bounds: { x: number; y: number; width: number; height: number };
  selectedCount: number;
  onCapture?: () => void;
  onSendToDialog?: () => void;
  isCapturing?: boolean;
}

const SelectionGroupToolbar: React.FC<SelectionGroupToolbarProps> = ({
  bounds,
  selectedCount,
  onCapture,
  onSendToDialog,
  isCapturing = false,
}) => {
  const top = (bounds?.y ?? 0) + (bounds?.height ?? 0) + 12;
  const left = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;

  return (
    <div
      className="tanva-selection-group-toolbar"
      style={{
        position: 'absolute',
        top,
        left,
        transform: 'translate(-50%, 0)',
        zIndex: 120,
        pointerEvents: 'auto',
      }}
    >
      <div
        className="flex items-center gap-3 rounded-full px-4 py-2 shadow-xl bg-white/90 backdrop-blur-md border border-white/40"
      >
        <span className="text-sm text-gray-700 whitespace-nowrap">
          已选中 {selectedCount} 个元素
        </span>
        <Button
          variant="default"
          size="sm"
          className="gap-1"
          onClick={onCapture}
          disabled={isCapturing}
        >
          <Camera className="w-4 h-4" />
          {isCapturing ? '处理中...' : '照相机'}
        </Button>
        {onSendToDialog && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={onSendToDialog}
            disabled={isCapturing}
          >
            <Send className="w-4 h-4" />
            {isCapturing ? '处理中...' : '发送到对话框'}
          </Button>
        )}
      </div>
    </div>
  );
};

export default SelectionGroupToolbar;
