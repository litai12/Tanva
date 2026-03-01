import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUploadLeavePromptStore } from '@/stores/uploadLeavePromptStore';

export default function PendingUploadLeavePrompt() {
  const open = useUploadLeavePromptStore((state) => state.open);
  const title = useUploadLeavePromptStore((state) => state.title);
  const message = useUploadLeavePromptStore((state) => state.message);
  const summary = useUploadLeavePromptStore((state) => state.summary);
  const onConfirm = useUploadLeavePromptStore((state) => state.onConfirm);
  const closePrompt = useUploadLeavePromptStore((state) => state.closePrompt);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePrompt();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closePrompt]);

  if (!open || !summary) return null;

  const detailLines: string[] = [];
  if (summary.inFlightUploads > 0) {
    detailLines.push(`正在上传：${summary.inFlightUploads} 个任务`);
  }
  if (summary.pendingImageAssets > 0) {
    detailLines.push(`待上传图片：${summary.pendingImageAssets} 张`);
  }
  if (summary.pendingFlowNodes > 0) {
    detailLines.push(`Flow 节点本地图片：${summary.pendingFlowNodes} 个`);
  }

  const handleConfirm = () => {
    const confirmFn = onConfirm;
    closePrompt();
    try {
      confirmFn?.();
    } catch (err) {
      console.warn('离开确认回调执行失败:', err);
    }
  };

  const node = (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closePrompt}
      />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-800 truncate">{title}</span>
          </div>
          <button
            onClick={closePrompt}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="关闭"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
            {message}
          </div>

          {detailLines.length > 0 && (
            <div className="text-sm text-slate-600 space-y-1">
              {detailLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closePrompt}>
              留在页面
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleConfirm}
            >
              仍要离开
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

