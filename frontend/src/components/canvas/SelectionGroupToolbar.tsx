import React from 'react';
import { Camera, Group, Send, Ungroup } from 'lucide-react';
import { Button } from '../ui/button';

interface SelectionGroupToolbarProps {
  bounds: { x: number; y: number; width: number; height: number };
  selectedCount: number;
  onCapture?: () => void;
  onGroupImages?: () => void;
  canGroupImages?: boolean;
  onUngroupImages?: () => void;
  canUngroupImages?: boolean;
  onSendToDialog?: () => void;
  isCapturing?: boolean;
}

const SelectionGroupToolbar: React.FC<SelectionGroupToolbarProps> = ({
  bounds,
  selectedCount,
  onCapture,
  onGroupImages,
  canGroupImages = false,
  onUngroupImages,
  canUngroupImages = false,
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
{/* <span className="text-sm text-gray-700 whitespace-nowrap">
          已选中 {selectedCount} 个元素
        </span> */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={onCapture}
          disabled={isCapturing || !onCapture}
        >
          <Camera className="w-4 h-4" />
          {isCapturing ? '处理中...' : '照相机'}
        </Button>
        {onGroupImages && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={onGroupImages}
            disabled={isCapturing || !canGroupImages}
          >
            <Group className="w-4 h-4" />
            组合
          </Button>
        )}
        {onUngroupImages && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={onUngroupImages}
            disabled={isCapturing || !canUngroupImages}
          >
            <Ungroup className="w-4 h-4" />
            解组
          </Button>
        )}
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
