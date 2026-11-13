import { useRef, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';

export default function ImageRetryButton({ onRetry }: { onRetry: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const retry = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try { await onRetry(); }
    catch (e) { setError(e instanceof Error ? e.message : '重新生成失败，请重试'); }
    finally { busy.current = false; setPending(false); }
  };

  return (
    <div className="mt-2 flex flex-col items-center gap-2">
      <button type="button" disabled={pending} onClick={() => void retry()}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-[#F4F2EE] px-4 py-2 text-sm font-medium text-[#141414] disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        {pending ? '正在重新提交…' : '重新生成这张图'}
      </button>
      {error && <div role="alert" className="text-xs leading-5 text-[#FFB3A8]">{error}</div>}
    </div>
  );
}
