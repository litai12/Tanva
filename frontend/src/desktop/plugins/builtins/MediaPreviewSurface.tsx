import { ChevronLeft, ChevronRight, Download, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { downloadFile } from '@/utils/downloadHelper';
import { useDesktopMediaPreviewStore } from '@/desktop/media/mediaPreviewState';

const safeFileName = (value: string): string =>
  value.replace(/[\\/:*?"<>|]+/g, '_').trim() || '小T图片';

export default function MediaPreviewSurface() {
  const preview = useDesktopMediaPreviewStore((state) => state.preview);
  const select = useDesktopMediaPreviewStore((state) => state.select);
  const currentIndex = preview
    ? Math.max(0, preview.items.findIndex((item) => item.id === preview.currentItemId))
    : -1;
  const current = preview && currentIndex >= 0 ? preview.items[currentIndex] : null;

  if (!preview || !current) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500">
        选择一张图片后在这里预览
      </div>
    );
  }

  const downloadName = current.downloadName || `${safeFileName(current.title || preview.title)}.png`;
  const move = (offset: number) => {
    const next = preview.items[currentIndex + offset];
    if (next) select(next.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="flex h-11 flex-none items-center gap-2 border-b border-slate-200 bg-white px-3">
        <ImageIcon className="h-4 w-4 flex-none text-slate-500" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
          {current.title || preview.title}
        </div>
        {preview.items.length > 1 && (
          <span className="text-xs tabular-nums text-slate-500">
            {currentIndex + 1} / {preview.items.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => void downloadFile(current.url, downloadName)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          title="下载原图"
        >
          <Download className="h-3.5 w-3.5" />
          下载
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,_#ffffff_0,_#f8fafc_45%,_#e2e8f0_100%)] p-5">
        <img
          src={current.url}
          alt={current.title || preview.title}
          className="max-h-full max-w-full select-none object-contain shadow-[0_18px_60px_rgba(15,23,42,0.16)]"
          draggable={false}
        />
        {preview.items.length > 1 && (
          <>
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => move(-1)}
              className="absolute left-3 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-lg backdrop-blur disabled:opacity-30"
              title="上一张"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              disabled={currentIndex === preview.items.length - 1}
              onClick={() => move(1)}
              className="absolute right-3 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-lg backdrop-blur disabled:opacity-30"
              title="下一张"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {preview.items.length > 1 && (
        <div className="flex h-24 flex-none gap-2 overflow-x-auto border-t border-slate-200 bg-white p-2">
          {preview.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => select(item.id)}
              className={cn(
                'h-full w-20 flex-none overflow-hidden rounded-lg border-2 bg-slate-100',
                item.id === current.id ? 'border-blue-500' : 'border-transparent hover:border-slate-300'
              )}
              title={item.title || '预览图片'}
            >
              <img
                src={item.thumbnailUrl || item.url}
                alt={item.title || '预览图片'}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
