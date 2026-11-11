// 生图任务轮询：前 2 分钟 3 秒一次，之后 8 秒；后台标签页 ×3；切回前台立即刷新；终态停止。
import { useEffect, useRef, useState } from 'react';
import { mobileChatApi, type ImageTask } from '@/services/mobileChatApi';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
export const isImageDone = (t: ImageTask | null) => t?.status === 'succeeded' || t?.status === 'failed';

export function useImageTask(taskId: string | null, createdAt: string) {
  const [task, setTask] = useState<ImageTask | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    const tick = async () => {
      let next: ImageTask | null = null;
      try { next = await mobileChatApi.imageTask(taskId); if (alive) { setTask(next); setError(''); } }
      catch (e) { if (alive) setError(errMsg(e, '读取生图任务失败')); }
      if (!alive || isImageDone(next)) return;
      const base = Date.now() - new Date(createdAt).getTime() < 2 * 60_000 ? 3000 : 8000;
      timer.current = setTimeout(tick, document.hidden ? base * 3 : base);
    };
    void tick();
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer.current); void tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible); };
  }, [taskId, createdAt]);

  return { task, error };
}

/** 运行中每秒刷新的“已用秒数”。 */
export function useElapsedSeconds(since: string, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
}

export function ratioStyle(aspectRatio: string): React.CSSProperties {
  const [w, h] = aspectRatio.split(':').map(Number);
  return { aspectRatio: w > 0 && h > 0 ? `${w} / ${h}` : '1 / 1' };
}
