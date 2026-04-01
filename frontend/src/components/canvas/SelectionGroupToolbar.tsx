import React from 'react';
import { Camera, Download, Group, Send, Ungroup } from 'lucide-react';
import { Button } from '../ui/button';
import { useCanvasStore } from '@/stores';
import { useTranslation } from 'react-i18next';

interface SelectionGroupToolbarProps {
  bounds: { x: number; y: number; width: number; height: number };
  selectedCount: number;
  onCapture?: () => void;
  onGroupImages?: () => void;
  canGroupImages?: boolean;
  onUngroupImages?: () => void;
  canUngroupImages?: boolean;
  onBatchDownloadImages?: () => void;
  canBatchDownloadImages?: boolean;
  onSendToDialog?: () => void;
  isCapturing?: boolean;
}

const SelectionGroupToolbar: React.FC<SelectionGroupToolbarProps> = ({
  bounds,
  selectedCount: _selectedCount,
  onCapture,
  onGroupImages,
  canGroupImages = false,
  onUngroupImages,
  canUngroupImages = false,
  onBatchDownloadImages,
  canBatchDownloadImages = false,
  onSendToDialog,
  isCapturing = false,
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = (zhText: string, enText: string) => (isZh ? zhText : enText);
  const zoom = useCanvasStore((state) => state.zoom);
  const showButtonText = (zoom || 1) >= 0.5;
  const toolbarButtonClass = showButtonText
    ? 'h-8 px-3 gap-1 whitespace-nowrap shrink-0 leading-none'
    : 'h-8 w-8 p-0 shrink-0';

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
        className="flex items-center flex-nowrap gap-2 rounded-full px-3 py-2 shadow-xl bg-white/90 backdrop-blur-md border border-white/40"
      >
{/* <span className="text-sm text-gray-700 whitespace-nowrap">
          {selectedCount} items selected
        </span> */}
        <Button
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onCapture}
          disabled={isCapturing || !onCapture}
          title={isCapturing ? lt('处理中...', 'Processing...') : lt('照相机', 'Capture')}
        >
          <Camera className="w-4 h-4 shrink-0" />
          {showButtonText && (isCapturing ? lt('处理中...', 'Processing...') : lt('照相机', 'Capture'))}
        </Button>
        {onGroupImages && (
          <Button
            variant="outline"
            size="sm"
            className={toolbarButtonClass}
            onClick={onGroupImages}
            disabled={isCapturing || !canGroupImages}
            title={lt('组合', 'Group')}
          >
            <Group className="w-4 h-4 shrink-0" />
            {showButtonText && lt('组合', 'Group')}
          </Button>
        )}
        {onUngroupImages && (
          <Button
            variant="outline"
            size="sm"
            className={toolbarButtonClass}
            onClick={onUngroupImages}
            disabled={isCapturing || !canUngroupImages}
            title={lt('解组', 'Ungroup')}
          >
            <Ungroup className="w-4 h-4 shrink-0" />
            {showButtonText && lt('解组', 'Ungroup')}
          </Button>
        )}
        {onBatchDownloadImages && (
          <Button
            variant="outline"
            size="sm"
            className={toolbarButtonClass}
            onClick={onBatchDownloadImages}
            disabled={isCapturing || !canBatchDownloadImages}
            title={lt('批量下载', 'Batch download')}
          >
            <Download className="w-4 h-4 shrink-0" />
            {showButtonText && lt('批量下载', 'Batch download')}
          </Button>
        )}
        {onSendToDialog && (
          <Button
            variant="outline"
            size="sm"
            className={toolbarButtonClass}
            onClick={onSendToDialog}
            disabled={isCapturing}
            title={
              isCapturing
                ? lt('处理中...', 'Processing...')
                : lt('发送到对话框', 'Send to dialog')
            }
          >
            <Send className="w-4 h-4 shrink-0" />
            {showButtonText &&
              (isCapturing
                ? lt('处理中...', 'Processing...')
                : lt('发送到对话框', 'Send to dialog'))}
          </Button>
        )}
      </div>
    </div>
  );
};

export default SelectionGroupToolbar;
