// 单张生图卡：生成中按目标画幅占位 + 扫光 + 走秒，完成后可全屏查看、下载。
import { useEffect, useState } from 'react';
import { AlertCircle, Download } from 'lucide-react';
import { isImageDone, ratioStyle, useElapsedSeconds, useImageTask } from './useImageTask';
import ImageViewer from './ImageViewer';
import ImageRetryButton from './ImageRetryButton';
import { mobileChatApi } from '@/services/mobileChatApi';

const TIPS = ['正在理解画面描述', '正在构图', '正在绘制细节', '快好了'];

export default function ImageCard({ messageId, taskId, prompt, aspectRatio, createdAt, submitError }: {
  messageId: string; taskId: string | null; submitError?: string; prompt: string; aspectRatio: string; createdAt: string;
}) {
  const [active, setActive] = useState({ taskId, createdAt });
  useEffect(() => { setActive({ taskId, createdAt }); }, [taskId, createdAt]);
  const { task, error } = useImageTask(active.taskId, active.createdAt);
  const done = !active.taskId || isImageDone(task);
  const seconds = useElapsedSeconds(active.createdAt, !done);
  const [open, setOpen] = useState(false);
  const url = task?.status === 'succeeded' ? task.imageUrl : null;
  const tip = TIPS[Math.min(Math.floor(seconds / 10), TIPS.length - 1)];

  return (
    <div className="w-[78%] max-w-[360px] overflow-hidden rounded-3xl border border-white/10 bg-[#1E1E1E]">
      {url ? (
        <button type="button" className="block w-full" onClick={() => setOpen(true)}>
          <img src={url} alt={prompt} className="tanva-fade-in w-full object-cover" style={ratioStyle(aspectRatio)} />
        </button>
      ) : !active.taskId || task?.status === 'failed' ? (
        <div className="flex flex-col items-center justify-center gap-2 bg-[#2A1714] px-4 text-center" style={ratioStyle(aspectRatio)}>
          <AlertCircle className="h-6 w-6 text-[#FF7A6B]" />
          <div className="text-xs leading-5 text-[#FFB3A8]">{task?.error || submitError || '生成失败'}</div>
          <div className="text-[11px] text-white/40">已扣积分会自动退回</div>
          <ImageRetryButton key={active.taskId} onRetry={async () => {
            const next = await mobileChatApi.retryImage(messageId, active.taskId);
            if (!next.jobId) throw new Error('重新生成未返回图片任务，请重试');
            setActive({ taskId: next.jobId, createdAt: next.generationStartedAt || next.createdAt });
          }} />
        </div>
      ) : (
        <div className="tanva-shimmer flex flex-col items-center justify-center gap-2" style={ratioStyle(aspectRatio)}>
          <span key={tip} className="tanva-fade-in tanva-dots text-[13px] text-white/60">{tip}</span>
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
      {open && url && <ImageViewer url={url} alt={prompt} onClose={() => setOpen(false)} />}
    </div>
  );
}
