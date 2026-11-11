// 成片任务的过程视图：规划 → 参考图 → 分镜视频 → 合成，每个节点实时状态与产物，可点开查看。
import { useState } from 'react';
import { AlertCircle, Check, ChevronDown, Clock, Film, Image as ImageIcon, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import type { StepStatus, VideoJob } from '@/services/mobileChatApi';

type NodeState = 'done' | 'active' | 'todo' | 'failed';

function Dot({ state, running }: { state: NodeState; running: boolean }) {
  if (state === 'done') return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ECEAE6] text-[#141414]"><Check className="h-3.5 w-3.5" /></span>;
  if (state === 'failed') return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF7A6B]/20 text-[#FF7A6B]"><AlertCircle className="h-3.5 w-3.5" /></span>;
  if (state === 'active') {
    return (
      <span className="relative flex h-6 w-6 items-center justify-center rounded-full border border-white/60">
        {running && <span className="absolute inset-0 animate-ping rounded-full border border-white/40" />}
        <span className="h-2 w-2 rounded-full bg-white" />
      </span>
    );
  }
  return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15"><span className="h-1.5 w-1.5 rounded-full bg-white/25" /></span>;
}

function StepBadge({ status }: { status?: StepStatus }) {
  if (status === 'succeeded') return <Check className="h-3.5 w-3.5 text-white/70" />;
  if (status === 'submitted') return <Loader2 className="h-3.5 w-3.5 animate-spin text-white/80" />;
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-[#FF7A6B]" />;
  return <Clock className="h-3.5 w-3.5 text-white/30" />;
}

const STEP_TEXT: Record<StepStatus, string> = { pending: '排队中', submitted: '生成中', succeeded: '已完成', failed: '失败' };

function Node({ state, running, title, meta, last, children }: {
  state: NodeState; running: boolean; title: string; meta?: string; last?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="relative flex gap-3">
      {!last && <span className={`absolute left-[11px] top-7 bottom-0 w-px ${state === 'done' ? 'bg-white/40' : 'bg-white/10'}`} />}
      <Dot state={state} running={running} />
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className={`text-[14px] ${state === 'todo' ? 'text-white/35' : 'text-white/90'}`}>{title}</span>
          {meta && <span className="shrink-0 text-xs tabular-nums text-white/45">{meta}</span>}
        </div>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

export default function JobProcess({ job, running, onRetryClip, acting }: {
  job: VideoJob; running: boolean; onRetryClip: (key: string) => void; acting: boolean;
}) {
  // 进行中默认展开，完成后默认收起（用户可随时切换）。
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? job.stage !== 'succeeded';
  const [preview, setPreview] = useState<{ type: 'image' | 'video'; url: string; title: string } | null>(null);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);

  const images = job.images ?? [];
  const clips = job.storyboard ?? [];
  const planned = !!job.storyboard;
  const summary = job.planProgress?.nodeSummary;
  const planRunning = job.planProgress?.nodes.find((n) => n.status === 'running')?.label;
  const imagesDone = images.length > 0 && images.every((i) => i.status === 'succeeded');
  const clipsDone = clips.length > 0 && clips.every((c) => c.status === 'succeeded');
  const anyFailed = (list: Array<{ status?: StepStatus }>) => list.some((x) => x.status === 'failed');

  const planState: NodeState = planned ? 'done' : job.stage === 'failed' ? 'failed' : 'active';
  const imageState: NodeState = !planned ? 'todo' : anyFailed(images) ? 'failed' : imagesDone || images.length === 0 ? 'done' : 'active';
  const clipState: NodeState = !planned ? 'todo' : anyFailed(clips) ? 'failed' : clipsDone ? 'done' : imageState === 'done' || clips.some((c) => c.status && c.status !== 'pending') ? 'active' : 'todo';
  const composeState: NodeState = job.stage === 'succeeded' ? 'done' : job.stage === 'composing' ? 'active' : 'todo';
  const count = (list: Array<{ status?: StepStatus }>) => `${list.filter((x) => x.status === 'succeeded').length}/${list.length}`;

  return (
    <div>
      <button type="button" onClick={() => setOpen(!expanded)} className="flex w-full items-center justify-between py-1 text-[13px] text-white/60">
        <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />制作过程</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="tanva-fade-in mt-3">
          <Node state={planState} running={running} title={job.mode === 'remake' ? '拆解原片 · 规划分镜' : '理解故事 · 规划分镜'}
            meta={planned ? `${clips.length} 个分镜 · ${job.totalSeconds ?? '?'} 秒` : summary?.total ? `步骤 ${summary.succeeded ?? 0}/${summary.total}` : undefined}>
            {!planned && running && (
              <div className="text-xs text-white/45">{planRunning ? `正在：${planRunning}` : 'TapCanvas 正在规划人物、场景与镜头，通常需要 1–3 分钟'}</div>
            )}
            {job.warnings.length > 0 && planned && (
              <div className="text-xs leading-5 text-white/40">{job.warnings.slice(0, 2).join('；')}</div>
            )}
          </Node>

          <Node state={imageState} running={running} title="参考图（角色 / 场景 / 道具）" meta={images.length ? count(images) : planned ? '无需生成' : undefined}>
            {images.length > 0 && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {images.map((img) => (
                  <button type="button" key={img.key} disabled={!img.imageUrl}
                    onClick={() => img.imageUrl && setPreview({ type: 'image', url: img.imageUrl, title: img.title })}
                    className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
                    {img.imageUrl
                      ? <img src={img.imageUrl} alt={img.title} loading="lazy" className="tanva-fade-in h-full w-full object-cover" />
                      : <div className={`flex h-full w-full items-center justify-center ${img.status === 'submitted' ? 'tanva-shimmer' : ''}`}><ImageIcon className="h-5 w-5 text-white/25" /></div>}
                    <span className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5"><StepBadge status={img.status} /></span>
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1 pb-0.5 pt-3 text-left text-[10px] text-white/85">{img.title}</span>
                  </button>
                ))}
              </div>
            )}
          </Node>

          <Node state={clipState} running={running} title="分镜视频" meta={clips.length ? count(clips) : undefined}>
            {clips.length > 0 && (
              <div className="space-y-2">
                {clips.map((clip) => (
                  <div key={clip.key} className="rounded-2xl bg-white/[0.04] p-2.5">
                    <div className="flex items-center gap-2.5">
                      <button type="button" disabled={!clip.videoUrl}
                        onClick={() => clip.videoUrl && setPreview({ type: 'video', url: clip.videoUrl, title: `分镜 ${clip.index}` })}
                        className={`relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06] ${clip.status === 'submitted' ? 'tanva-shimmer' : ''}`}>
                        {clip.videoUrl
                          ? <video src={`${clip.videoUrl}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                          : <Film className="h-5 w-5 text-white/25" />}
                      </button>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenPrompt(openPrompt === clip.key ? null : clip.key)}>
                        <div className="flex items-center gap-1.5 text-[13px] text-white/85">
                          分镜 {clip.index} · {clip.durationSeconds}s
                          <span className="flex items-center gap-1 text-xs text-white/45"><StepBadge status={clip.status} />{clip.status ? STEP_TEXT[clip.status] : ''}</span>
                        </div>
                        <div className={`mt-0.5 text-xs leading-5 text-white/45 ${openPrompt === clip.key ? '' : 'line-clamp-2'}`}>{clip.prompt}</div>
                      </button>
                    </div>
                    {clip.status === 'failed' && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="line-clamp-2 text-xs text-[#FF7A6B]">{clip.error || '生成失败'}</span>
                        {job.stage === 'failed' && (
                          <button type="button" disabled={acting} onClick={() => onRetryClip(clip.key)}
                            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 text-xs disabled:opacity-50">
                            <RotateCcw className="h-3.5 w-3.5" />重试此段
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Node>

          <Node state={composeState} running={running} title="合成成片" meta={job.stage === 'succeeded' && job.totalSeconds ? `${job.totalSeconds} 秒` : undefined} last />
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" onClick={() => setPreview(null)}>
          <div className="flex items-center justify-between px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
            <span className="text-sm text-white/80">{preview.title}</span>
            <button type="button" aria-label="关闭" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
            {preview.type === 'image'
              ? <img src={preview.url} alt={preview.title} className="max-h-full max-w-full rounded-xl object-contain" />
              : <video src={preview.url} controls autoPlay playsInline className="max-h-full max-w-full rounded-xl" />}
          </div>
        </div>
      )}
    </div>
  );
}
