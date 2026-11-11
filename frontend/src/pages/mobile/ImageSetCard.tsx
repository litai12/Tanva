// 详情页卡片：各屏按顺序上下相接（看起来就是一张详情页），逐屏实时出图；全部完成后可拼成一张长图。
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Download, Layers, Loader2, Rows3 } from 'lucide-react';
import { mobileChatApi, type ImageSetMeta, type ImageTask, type MobileMessage } from '@/services/mobileChatApi';
import { isImageDone, ratioStyle, useElapsedSeconds, useImageTask } from './useImageTask';
import ImageViewer from './ImageViewer';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function Section({ index, title, taskId, submitError, aspectRatio, createdAt, onState, onOpen }: {
  index: number; title: string; taskId: string | null; submitError?: string; aspectRatio: string; createdAt: string;
  onState: (index: number, task: ImageTask | null) => void; onOpen: (url: string, title: string) => void;
}) {
  const { task } = useImageTask(taskId, createdAt);
  const done = !taskId || isImageDone(task);
  const seconds = useElapsedSeconds(createdAt, !done);
  useEffect(() => { onState(index, taskId ? task : { status: 'failed', imageUrl: null, error: submitError || '未提交' }); }, [index, task, taskId, submitError, onState]);
  const url = task?.status === 'succeeded' ? task.imageUrl : null;
  const failed = !taskId || task?.status === 'failed';
  return (
    <div className="relative">
      {url ? (
        <button type="button" className="block w-full" onClick={() => onOpen(url, title)}>
          <img src={url} alt={title} loading="lazy" className="tanva-fade-in block w-full" style={ratioStyle(aspectRatio)} />
        </button>
      ) : failed ? (
        <div className="flex flex-col items-center justify-center gap-1.5 bg-[#2A1714] px-6 text-center" style={ratioStyle(aspectRatio)}>
          <AlertCircle className="h-5 w-5 text-[#FF7A6B]" />
          <div className="text-xs text-[#FFB3A8]">{task?.error || submitError || '生成失败'}</div>
          <div className="text-[11px] text-white/40">已扣积分会自动退回；可在对话里让我重做「{title}」</div>
        </div>
      ) : (
        <div className="tanva-shimmer flex flex-col items-center justify-center gap-1" style={ratioStyle(aspectRatio)}>
          <Loader2 className="h-5 w-5 animate-spin text-white/50" />
          <span className="text-xs tabular-nums text-white/40">{seconds}s</span>
        </div>
      )}
      <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white/85">{index + 1} · {title}</span>
    </div>
  );
}

export default function ImageSetCard({ message }: { message: MobileMessage }) {
  const [meta, setMeta] = useState<ImageSetMeta>(message.imageSet!);
  const [states, setStates] = useState<Array<ImageTask | null>>(() => meta.sections.map(() => null));
  const [stitching, setStitching] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState<{ url: string; title: string; tall: boolean } | null>(null);

  useEffect(() => { if (message.imageSet) setMeta(message.imageSet); }, [message.imageSet]);
  const onState = useCallback((i: number, t: ImageTask | null) => setStates((prev) => (prev[i] === t ? prev : prev.map((x, j) => (j === i ? t : x)))), []);
  const onOpen = useCallback((url: string, title: string) => setViewer({ url, title, tall: false }), []);

  const total = meta.sections.length;
  const ok = states.filter((t) => t?.status === 'succeeded').length;
  const finished = states.every((t) => t?.status === 'succeeded' || t?.status === 'failed');
  const allOk = ok === total;

  const stitch = async () => {
    setStitching(true); setError('');
    try { const next = await mobileChatApi.stitch(message.id); if (next.imageSet) setMeta(next.imageSet); }
    catch (e) { setError(errMsg(e, '拼接长图失败，请重试')); }
    finally { setStitching(false); }
  };

  return (
    <div className="w-[86%] max-w-[400px] overflow-hidden rounded-3xl border border-white/10 bg-[#1E1E1E]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-[15px] font-medium"><Rows3 className="h-4 w-4 shrink-0" /><span className="truncate">{meta.title}</span></div>
        <span className={`shrink-0 text-xs tabular-nums ${finished ? 'text-white/50' : 'text-white/70'}`}>{finished ? `${ok}/${total} 屏完成` : `生成中 ${ok}/${total}`}</span>
      </div>
      {!finished && (
        <div className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="tanva-bar h-full rounded-full bg-[#ECEAE6] transition-all duration-700" style={{ width: `${Math.max(6, (ok / total) * 100)}%` }} />
        </div>
      )}
      <div className="max-h-[70vh] overflow-y-auto overscroll-contain">
        {meta.sections.map((s, i) => (
          <Section key={`${i}-${s.taskId}`} index={i} title={s.title} taskId={s.taskId} submitError={s.error} aspectRatio={meta.aspectRatio}
            createdAt={message.createdAt} onState={onState} onOpen={onOpen} />
        ))}
      </div>
      <div className="space-y-2 p-3">
        {meta.longImageUrl ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setViewer({ url: meta.longImageUrl!, title: meta.title, tall: true })}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 text-sm"><Layers className="h-4 w-4" />查看长图</button>
            <a href={meta.longImageUrl} download target="_blank" rel="noreferrer"
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#F4F2EE] text-sm font-medium text-[#141414]"><Download className="h-4 w-4" />下载长图</a>
          </div>
        ) : (
          <button type="button" disabled={!allOk || stitching} onClick={stitch}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#F4F2EE] text-sm font-medium text-[#141414] disabled:bg-white/10 disabled:text-white/35">
            {stitching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            {stitching ? '正在拼接长图…' : allOk ? '拼成一张长图' : finished ? '有屏未生成成功，暂不能拼接' : '全部完成后可拼成长图'}
          </button>
        )}
        {error && <div className="text-center text-xs text-[#FF7A6B]">{error}</div>}
      </div>
      {viewer && <ImageViewer url={viewer.url} alt={viewer.title} tall={viewer.tall} onClose={() => setViewer(null)} />}
    </div>
  );
}
