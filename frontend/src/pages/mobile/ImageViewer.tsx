// 全屏看图从完整缩略图开始，支持双指缩放、双击放大和拖动查看细节。
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import MediaSaveButton from './MediaSaveButton';

export default function ImageViewer({ url, alt, onClose }: { url: string; alt: string; tall?: boolean; onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState({ url: '', width: 0, height: 0 });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const focused = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (focused instanceof HTMLElement) focused.focus();
    };
  }, []);

  const loaded = image.url === url && image.width > 0 && image.height > 0;
  const fit = loaded ? Math.min(viewport.width / image.width, viewport.height / image.height, 1) : 1;
  const width = loaded ? image.width * fit : viewport.width;
  const height = loaded ? image.height * fit : viewport.height;

  return (
    <div role="dialog" aria-modal="true" aria-label={alt || '查看图片'}
      className="fixed inset-0 z-[60] flex flex-col bg-[#141414] text-white"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
      }}>
      <div className="flex shrink-0 justify-end px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <button ref={closeRef} type="button" aria-label="关闭" onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
      </div>
      <div ref={viewportRef} className="relative mx-3 min-h-0 flex-1 overflow-hidden">
        {viewport.width > 0 && viewport.height > 0 && (
          <TransformWrapper key={`${url}:${width}:${height}`} initialScale={1} minScale={1}
            maxScale={Math.max(8, 2 / Math.max(fit, 0.01))} centerOnInit
            doubleClick={{ mode: 'toggle', step: 2 }} panning={{ velocityDisabled: true }}>
            <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width, height }}>
              <img src={url} alt={alt} draggable={false} className="block h-full w-full select-none object-contain"
                onLoad={(event) => {
                  const element = event.currentTarget;
                  setImage((current) => current.url === url && current.width === element.naturalWidth && current.height === element.naturalHeight
                    ? current : { url, width: element.naturalWidth, height: element.naturalHeight });
                }} />
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>
      <div className="shrink-0 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <MediaSaveButton url={url} kind="image" className="mx-auto flex min-h-11 items-center justify-center gap-2 rounded-full bg-white/10 px-5 text-sm" />
      </div>
    </div>
  );
}
