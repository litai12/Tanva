import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, Download, Loader2, Play, RotateCcw, Square } from 'lucide-react';
import { mobileChatApi, type VideoJob } from '@/services/mobileChatApi';
import JobProcess from './JobProcess';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

const STAGE_LABEL: Record<VideoJob['stage'], string> = {
  planning: '规划分镜中', waiting_credits: '余额不足，已暂停', producing: '生成中', composing: '合成成片中',
  succeeded: '已完成', failed: '生成失败', cancelled: '已取消',
};

/** 等待时轮换的提示，让用户知道系统在做什么。 */
const TIPS: Record<string, string[]> = {
  planning: ['正在理解故事和人物', '正在拆分镜头与节奏', '正在设计角色和场景', '正在写每个镜头的画面提示词'],
  producing: ['正在生成角色和场景参考图', '正在逐段生成视频', '多段视频会并行生成', '单段视频一般需要 1–3 分钟'],
  composing: ['正在拼接各段视频', '马上就好'],
};

/** 轮询间隔随耗时放缓：前 3 分钟 5 秒，15 分钟内 10 秒，之后 20 秒；后台标签页再放慢 3 倍。 */
function pollDelay(elapsedMs: number): number {
  const base = elapsedMs < 3 * 60_000 ? 5_000 : elapsedMs < 15 * 60_000 ? 10_000 : 20_000;
  return document.hidden ? base * 3 : base;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function percent(job: VideoJob): number {
  if (job.stage === 'succeeded') return 100;
  if (job.stage === 'planning') return 6;
  if (job.stage === 'composing') return 92;
  const ratio = (c: { total: number; succeeded: number }) => (c.total ? c.succeeded / c.total : 1);
  return Math.round(10 + ratio(job.progress.images) * 30 + ratio(job.progress.clips) * 50);
}

export default function JobCard({ jobId, title }: { jobId: string; title: string }) {
  const [job, setJob] = useState<VideoJob | null>(null);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    try { const next = await mobileChatApi.job(jobId); setJob(next); setError(''); return next; }
    catch (e) { setError(errMsg(e, '读取任务失败')); return null; }
  }, [jobId]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await load();
      if (!alive) return;
      if (!next || !TERMINAL.has(next.stage)) {
        const elapsed = next ? Date.now() - new Date(next.createdAt).getTime() : 0;
        timer.current = setTimeout(tick, pollDelay(elapsed));
      }
    };
    void tick();
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const running = !!job && !TERMINAL.has(job.stage) && job.stage !== 'waiting_credits';
  // 运行中每秒走一次计时，让卡片“在动”；结束后停表。
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const act = async (fn: () => Promise<VideoJob>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setActing(true);
    try { setJob(await fn()); setError(''); clearTimeout(timer.current); timer.current = setTimeout(() => void load(), 3000); }
    catch (e) { setError(errMsg(e, '操作失败')); }
    finally { setActing(false); }
  };

  const elapsed = job ? (running ? now : new Date(job.completedAt || job.updatedAt).getTime()) - new Date(job.createdAt).getTime() : 0;
  const tips = job ? TIPS[job.stage] : undefined;
  const tip = tips ? tips[Math.floor(elapsed / 4000) % tips.length] : '';

  return (
    <div className="w-full overflow-hidden rounded-3xl border border-white/10 bg-[#1E1E1E]">
      {job?.finalVideoUrl ? (
        <video src={job.finalVideoUrl} controls playsInline preload="metadata" className="max-h-[60vh] w-full bg-black" />
      ) : (
        <div className="tanva-shimmer relative flex aspect-[16/9] flex-col items-center justify-center gap-3 bg-[#18181C]">
          {job?.stage === 'failed' || job?.stage === 'cancelled'
            ? <Play className="h-8 w-8 text-white/25" />
            : job?.stage === 'waiting_credits'
              ? <Coins className="h-8 w-8 text-[#F5B85B]/80" />
              : <Loader2 className="h-8 w-8 animate-spin text-white/70" />}
          {running && tip && <div key={tip} className="tanva-fade-in px-6 text-center text-[13px] text-white/60">{tip}…</div>}
        </div>
      )}
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-medium">{title}</div>
          <div className={`text-xs tabular-nums ${job?.stage === 'failed' ? 'text-[#FF7A6B]' : job?.stage === 'waiting_credits' ? 'text-[#F5B85B]' : 'text-white/55'}`}>
            {job ? STAGE_LABEL[job.stage] : '加载中…'}{job && elapsed > 0 ? ` · ${clock(elapsed)}` : ''}
          </div>
        </div>

        {job && job.stage !== 'succeeded' && job.stage !== 'cancelled' && (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full bg-[#ECEAE6] transition-all duration-700 ${running ? 'tanva-bar' : ''}`}
                style={{ width: `${percent(job)}%` }} />
            </div>
          </>
        )}

        {job && job.stage !== 'cancelled' && (
          <JobProcess job={job} running={running} acting={acting}
            onRetryClip={(key) => act(() => mobileChatApi.retry(jobId, [key]))} />
        )}
        {job?.estimate?.credits != null && (
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <Coins className="h-3.5 w-3.5" />预估 {job.estimate.credits} 积分{job.estimate.partial ? '起' : ''}（按实际用量扣除）
          </div>
        )}
        {job?.error && job.stage !== 'succeeded' && <div className="text-xs leading-5 text-[#FF7A6B]">{job.error}</div>}
        {error && <div className="text-xs text-[#FF7A6B]">{error}</div>}

        <div className="flex flex-wrap gap-2">
          {job?.finalVideoUrl && (
            <a href={job.finalVideoUrl} download target="_blank" rel="noreferrer"
              className="flex h-9 items-center gap-1.5 rounded-full bg-[#F4F2EE] px-4 text-sm font-medium text-[#141414]">
              <Download className="h-4 w-4" />下载成片
            </a>
          )}
          {job?.stage === 'waiting_credits' && (
            <>
              <a href="/my-credits" className="flex h-9 items-center rounded-full bg-white/10 px-4 text-sm">去充值</a>
              <button type="button" disabled={acting} onClick={() => act(() => mobileChatApi.produce(jobId))}
                className="flex h-9 items-center rounded-full bg-[#F4F2EE] px-4 text-sm font-medium text-[#141414] disabled:opacity-50">继续生成</button>
            </>
          )}
          {job?.stage === 'failed' && (
            <button type="button" disabled={acting} onClick={() => act(() => mobileChatApi.retry(jobId))}
              className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm disabled:opacity-50">
              <RotateCcw className="h-4 w-4" />重试失败部分
            </button>
          )}
          {(running || job?.stage === 'waiting_credits') && (
            <button type="button" disabled={acting} onClick={() => act(() => mobileChatApi.cancel(jobId), '取消后未开始的步骤不再生成，已提交的部分照常结算。确定取消？')}
              className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-white/50 disabled:opacity-50">
              <Square className="h-3.5 w-3.5" />取消
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
