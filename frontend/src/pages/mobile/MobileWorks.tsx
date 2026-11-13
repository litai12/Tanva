import { useEffect, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { loadMobileWorks, type MobileImageWork, type MobileWork } from '@/services/mobileWorks';
import { useImageTask } from './useImageTask';
import ImageViewer from './ImageViewer';
import MediaSaveButton from './MediaSaveButton';
import VideoViewer from './VideoViewer';

const WORK_STAGE: Record<string, string> = {
  planning: '规划中', waiting_credits: '余额不足', producing: '生成中', composing: '合成中',
  succeeded: '已完成', failed: '失败', cancelled: '已取消',
};

function ImageWork({ work }: { work: MobileImageWork }) {
  const { task, error } = useImageTask(work.taskId, work.createdAt);
  const [open, setOpen] = useState(false);
  const url = work.url || (task?.status === 'succeeded' ? task.imageUrl : null);
  const failed = !!work.error || task?.status === 'failed' || !work.taskId;
  return (
    <>
      {url ? (
        <button type="button" aria-label={`查看${work.title}`} onClick={() => setOpen(true)} className="block w-full">
          <img src={url} alt={work.title} loading="lazy" className="aspect-[3/4] w-full bg-black object-cover object-top" />
        </button>
      ) : (
        <div className="flex aspect-[3/4] items-center justify-center bg-white/[0.03] px-3 text-center text-xs text-white/60" role="status">
          {error || (failed ? work.error || task?.error || '生成失败' : '生成中…')}
        </div>
      )}
      <div className="space-y-1 p-2.5">
        <div className="line-clamp-2 break-words text-[13px] leading-5 text-white/85">{work.title}</div>
        <div className="text-[11px] text-white/40">{work.tall ? '详情长图' : '图片'} · {new Date(work.createdAt).toLocaleDateString('zh-CN')}</div>
      </div>
      {open && url && <ImageViewer url={url} alt={work.title} tall={work.tall} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function MobileWorks() {
  const [video, setVideo] = useState<{ url: string; title: string } | null>(null);
  const [works, setWorks] = useState<MobileWork[] | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(''); setWarning(''); setWorks(null);
    loadMobileWorks().then((result) => {
      if (alive) { setWorks(result.works); setWarning(result.warning); }
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : '加载失败'); });
    return () => { alive = false; };
  }, [attempt]);

  if (error) return (
    <div className="p-8 text-center text-sm text-[#FF7A6B]">
      <p>{error}</p>
      <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 min-h-11 rounded-full bg-white/10 px-5 text-white">重试</button>
    </div>
  );
  if (!works) return <div className="flex flex-1 items-center justify-center"><Loader2 aria-label="加载作品" className="h-5 w-5 animate-spin text-white/40" /></div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
      {warning && <div className="flex items-center justify-between gap-2 py-2 text-xs text-[#F5B85B]" role="status">
        <span>{warning}</span><button type="button" onClick={() => setAttempt((value) => value + 1)} className="min-h-11 shrink-0 px-3 text-white">重试</button>
      </div>}
      {works.length === 0 ? <div className="py-16 text-center text-sm text-white/40">还没有作品，去对话里创作图片或视频吧</div> : (
        <div className="grid grid-cols-2 items-start gap-3 pt-2 md:grid-cols-4">
          {works.map((work) => (
            <article key={work.id} className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#1C1C1C]">
              {work.type === 'image' ? <ImageWork work={work} /> : <>
                {work.job.finalVideoUrl ? (
                  <button type="button" aria-label={`查看视频 ${work.job.prompt || (work.job.kind === 'remake' ? '一键复刻' : '一键成片')}`}
                    onClick={() => setVideo({ url: work.job.finalVideoUrl!, title: work.job.prompt || (work.job.kind === 'remake' ? '一键复刻' : '一键成片') })}
                    className="relative block aspect-[3/4] w-full overflow-hidden bg-black">
                    <video src={work.job.finalVideoUrl} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1}
                      className="pointer-events-none h-full w-full object-cover" />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white"><Play className="h-6 w-6 fill-current" /></span>
                    </span>
                  </button>
                ) : (
                  <div className="flex aspect-[3/4] items-center justify-center bg-white/[0.03] text-xs text-white/60">{WORK_STAGE[work.job.stage] || work.job.stage}</div>
                )}
                <div className="space-y-1 p-2.5">
                  <div className="line-clamp-2 break-words text-[13px] leading-5 text-white/85">{work.job.prompt || (work.job.kind === 'remake' ? '一键复刻' : '一键成片')}</div>
                  <div className="text-[11px] text-white/40">{work.job.kind === 'remake' ? '复刻' : '成片'} · {new Date(work.createdAt).toLocaleDateString('zh-CN')}</div>
                  {work.job.finalVideoUrl && <MediaSaveButton url={work.job.finalVideoUrl} kind="video"
                    className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-white/10 text-xs" />}
                </div>
              </>}
            </article>
          ))}
        </div>
      )}
      {video && <VideoViewer url={video.url} title={video.title} onClose={() => setVideo(null)} />}
    </div>
  );
}
