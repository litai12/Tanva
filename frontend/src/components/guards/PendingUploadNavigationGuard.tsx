import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useUploadLeavePromptStore } from '@/stores/uploadLeavePromptStore';
import { getPendingUploadSummary } from '@/utils/pendingUploadSummary';
import { useTranslation } from 'react-i18next';

function getHistoryIdx(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null;
  const idx = (state as Record<string, unknown>).idx;
  return typeof idx === 'number' ? idx : null;
}

/**
 * 处理浏览器前进/后退导致的页面离开：
 * - beforeunload 不能覆盖 SPA 内部路由变化
 * - 使用 popstate 捕获并弹出自定义确认框
 */
export default function PendingUploadNavigationGuard() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);
  const location = useLocation();
  const promptOpen = useUploadLeavePromptStore((state) => state.open);
  const openPrompt = useUploadLeavePromptStore((state) => state.openPrompt);

  const historyIdxRef = useRef<number | null>(
    typeof window !== 'undefined' ? getHistoryIdx(window.history.state) : null
  );
  const skipNextPopRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const idx = getHistoryIdx(window.history.state);
    if (idx !== null) {
      historyIdxRef.current = idx;
    }
  }, [location.key]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (event: PopStateEvent) => {
      if (skipNextPopRef.current) {
        skipNextPopRef.current = false;
        return;
      }

      // 仅在编辑器页面拦截，避免影响其他页面返回行为
      if (!location.pathname.startsWith('/app')) {
        const idx = getHistoryIdx(event.state);
        if (idx !== null) historyIdxRef.current = idx;
        return;
      }

      const summary = getPendingUploadSummary();
      if (!summary.hasRisk || promptOpen) {
        const idx = getHistoryIdx(event.state);
        if (idx !== null) historyIdxRef.current = idx;
        return;
      }

      const nextIdx = getHistoryIdx(event.state);
      const currentIdx = historyIdxRef.current;
      let delta: number | null = null;
      if (typeof nextIdx === 'number' && typeof currentIdx === 'number') {
        const computed = nextIdx - currentIdx;
        delta = computed !== 0 ? computed : null;
      }

      // 先回滚 history，再提示确认，避免编辑器被直接卸载
      const revertDelta = delta !== null ? -delta : 1;
      skipNextPopRef.current = true;
      try {
        event.stopImmediatePropagation();
      } catch {}
      try {
        window.history.go(revertDelta);
      } catch {}

      openPrompt({
        summary,
        title: lt(
          '当前画板仍有任务在运行或上传',
          'There are running or uploading tasks on this canvas'
        ),
        message: lt(
          '当前画板上有在运行或上传中的数据，请勿轻易离开页面；如执意离开，运行或上传中的数据即将丢失。',
          'There are running or uploading tasks on this canvas. Do not leave now; if you leave anyway, in-flight data may be lost.'
        ),
        onConfirm: () => {
          skipNextPopRef.current = true;
          try {
            window.history.go(delta !== null ? delta : -1);
          } catch {}
        },
      });
    };

    window.addEventListener('popstate', handler, true);
    return () => window.removeEventListener('popstate', handler, true);
  }, [location.pathname, lt, openPrompt, promptOpen]);

  return null;
}
