import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import MediaSaveButton from './MediaSaveButton';

export default function VideoViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const video = videoRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    // 浏览器阻止自动播放时，仍可通过原生播放控件开始播放。
    void video?.play().catch(() => {});
    return () => {
      video?.pause();
      dialog?.close();
      document.body.style.overflow = overflow;
    };
  }, [url]);

  return (
    <dialog ref={dialogRef} aria-label={`查看视频 ${title}`} onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-[#141414] p-0 text-white backdrop:bg-transparent">
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
          <span className="min-w-0 truncate text-sm text-white/70">{title}</span>
          <button type="button" aria-label="关闭视频" onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <video ref={videoRef} src={url} controls playsInline autoPlay preload="metadata" className="h-full w-full object-contain" />
        </div>
        <div className="flex shrink-0 justify-end px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          <MediaSaveButton url={url} kind="video" className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-white/10 px-5 text-sm" />
        </div>
      </div>
    </dialog>
  );
}
