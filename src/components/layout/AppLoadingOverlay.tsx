import React from 'react';
import { AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';

type AppLoadingOverlayProps = {
  visible: boolean;
  title: string;
  description?: string | null;
  status?: 'loading' | 'error';
  onRetry?: () => void;
};

/**
 * 全局加载遮罩，刷新后等待项目与画布内容恢复时使用
 */
const AppLoadingOverlay: React.FC<AppLoadingOverlayProps> = ({
  visible,
  title,
  description,
  status = 'loading',
  onRetry,
}) => {
  if (!visible) return null;

  const isError = status === 'error';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/95 px-5 py-4 shadow-2xl">
        <div
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full',
            isError ? 'bg-rose-50 text-rose-500' : 'bg-slate-100 text-slate-700',
          )}
        >
          {isError ? <AlertCircle className="h-5 w-5" /> : <LoadingSpinner size="lg" className="text-slate-700" />}
        </div>
        <div className="flex max-w-xs flex-col gap-1 text-left">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {description && <div className="text-xs leading-relaxed text-slate-500">{description}</div>}
          {isError && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 inline-flex w-fit items-center justify-center rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-slate-800 active:bg-slate-900"
            >
              重试
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppLoadingOverlay;
