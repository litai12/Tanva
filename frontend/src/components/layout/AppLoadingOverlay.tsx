import React from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

type Status = 'loading' | 'error';

type AppLoadingOverlayProps = {
  visible: boolean;
  title?: string;
  description?: string | null;
  status?: Status;
  onRetry?: () => void;
};

/**
 * Full-screen loading and error overlay used while a project is being restored.
 * Keeps the canvas hidden during hydration to avoid the “flash then disappear” effect.
 */
const AppLoadingOverlay: React.FC<AppLoadingOverlayProps> = ({
  visible,
  title = '正在加载',
  description,
  status = 'loading',
  onRetry,
}) => {
  if (!visible) return null;

  const isError = status === 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/85 backdrop-blur-sm">
      <div className="absolute inset-0 bg-gradient-to-b from-slate-50 via-white to-slate-100" aria-hidden />
      <div className="relative w-full max-w-md px-6">
        <div className={cn(
          'rounded-2xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-200/70',
          'px-6 py-5 flex items-start gap-4'
        )}>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            {isError ? (
              <AlertCircle className="h-6 w-6 text-rose-500" />
            ) : (
              <LoadingSpinner size="lg" className="text-blue-500 border-blue-200" />
            )}
          </div>
          <div className="flex-1">
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            {description && (
              <div className="mt-1 text-sm text-slate-600 leading-relaxed">
                {description}
              </div>
            )}
            {isError && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-rose-600"
              >
                <RefreshCcw className="h-4 w-4" />
                重新加载
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppLoadingOverlay;
