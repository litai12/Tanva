// 生图任务卡：轮询 /api/ai/image-task/:id；生成中按目标画幅占位 + 扫光 + 走秒，完成后可全屏查看、下载。
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, X } from 'lucide-react';
import { mobileChatApi, type ImageTask } from '@/services/mobileChatApi';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const TIPS = ['正在理解画面描述', '正在构图', '正在绘制细节', '快好了'];

function ratioStyle(aspectRatio: string): React.CSSProperties {
  const [w, h] = aspectRatio.split(':').map(Number);
  return { aspectRatio: w > 0 && h > 0 ? `${w} / ${h}` : '1 / 1' };
}

export default function ImageCard({ taskId, prompt, aspectRatio, createdAt }: {
  taskId: string; prompt: string; aspectRatio: string; createdAt: string;
}) {
  const [task, setTask] = useState<ImageTask | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const done = task?.status === 'succeeded' || task?.status === 'failed';

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      let next: ImageTask | null = null;
      try { next = await mobileChatApi.imageTask(taskId); if (alive) { setTask(next); setError(''); } }
      catch (e) { if (alive) setError(errMsg(e, '读取生图任务失败')); }
      if (!alive || next?.status === 'succeeded' || next?.status === 'failed') return;
      const elapsed = Date.now() - new Date(createdAt).getTime();
      const base = elapsed < 2 * 60_000 ? 3000 : 8000;
      timer.current = setTimeout(tick, document.hidden ? base * 3 : base);
    };
    void tick();
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer.current); void tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible); };
  }, [taskId, createdAt]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done]);

  const seconds = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  const url = task?.status === 'succeeded' ? task.imageUrl : null;

  return (
    <div className="w-[78%] max-w-[360px] overflow-hidden rounded-3xl border border-white/10 bg-[#1E1E1E]">
      {url ? (
        <button type="button" className="block w-full" onClick={() => setOpen(true)}>
          <img src={url} alt={prompt} className="tanva-fade-in w-full object-cover" style={ratioStyle(aspectRatio)} />
        </button>
      ) : task?.status === 'failed' ? (
        <div className="flex flex-col items-center justify-center gap-2 bg-[#2A1714] px-4 text-center" style={ratioStyle(aspectRatio)}>
          <AlertCircle className="h-6 w-6 text-[#FF7A6B]" />
          <div className="text-xs leading-5 text-[#FFB3A8]">{task.error || '生成失败'}</div>
          <div className="text-[11px] text-white/40">已扣积分会自动退回</div>
        </div>
      ) : (
        <div className="tanva-shimmer flex flex-col items-center justify-center gap-2" style={ratioStyle(aspectRatio)}>
          <span key={Math.min(Math.floor(seconds / 10), TIPS.length - 1)} className="tanva-fade-in tanva-dots text-[13px] text-white/60">
            {TIPS[Math.min(Math.floor(seconds / 10), TIPS.length - 1)]}
          </span>
          <span className="text-xs tabular-nums text-white/35">{seconds}s · 通常 20–60 秒</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="line-clamp-1 min-w-0 flex-1 text-xs text-white/50">{prompt}</div>
        {url && (
          <a href={url} download target="_blank" rel="noreferrer" aria-label="下载"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10"><Download className="h-4 w-4" /></a>
        )}
      </div>
      {error && !done && <div className="px-3 pb-2 text-xs text-[#FF7A6B]">{error}</div>}

      {open && url && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" onClick={() => setOpen(false)}>
          <div className="flex justify-end px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
            <button type="button" aria-label="关闭" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <img src={url} alt={prompt} className="max-h-full max-w-full rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
          <div className="pb-[max(16px,env(safe-area-inset-bottom))] text-center text-xs text-white/40">长按图片可保存到相册</div>
        </div>
      )}
    </div>
  );
}
