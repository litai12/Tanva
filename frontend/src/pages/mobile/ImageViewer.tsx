// 全屏看图：普通图居中缩放；长图（tall）按屏宽铺满、上下滚动查看。
import { X } from 'lucide-react';

export default function ImageViewer({ url, alt, tall = false, onClose }: { url: string; alt: string; tall?: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" onClick={onClose}>
      <div className="flex shrink-0 justify-end px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <button type="button" aria-label="关闭" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
      </div>
      {tall ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
          <img src={url} alt={alt} className="w-full" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-3">
          <img src={url} alt={alt} className="max-h-full max-w-full rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      <div className="shrink-0 pb-[max(16px,env(safe-area-inset-bottom))] pt-2 text-center text-xs text-white/40">长按图片可保存到相册</div>
    </div>
  );
}
