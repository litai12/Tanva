import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useUploadLeavePromptStore } from '@/stores/uploadLeavePromptStore';
import { getPendingUploadSummary } from '@/utils/pendingUploadSummary';

function getHistoryIdx(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null;
  const idx = (state as Record<string, unknown>).idx;
  return typeof idx === 'number' ? idx : null;
}

/**
 * 处理浏览器前进/后退导致的离开：
 * - beforeunload 无法覆盖 SPA 内部路由变化
 * - 这里用 popstate 捕获阶段拦截，并弹出自定义确认弹窗
 */
export default function PendingUploadNavigationGuard() {
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

      // 仅在编辑器内拦截（避免影响其它页面的正常返回）
      if (!location.pathname.startsWith('/app')) {
        const idx = getHistoryIdx(event.state);
        if (idx !== null) historyIdxRef.current = idx;
        return;
      }

      const summary = getPendingUploadSummary();
      if (!summary.hasPending || promptOpen) {
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

      // 先把 URL/历史回滚到当前页，再弹确认（避免编辑器被卸载造成状态丢失）
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
        title: '还有图片未上传完成',
        message: '检测到仍有上传中/待上传图片，离开可能导致图片丢失或无法保存到云端。',
        onConfirm: () => {
          // 用户确认后，执行原本的前进/后退
          skipNextPopRef.current = true;
          try {
            window.history.go(delta !== null ? delta : -1);
          } catch {}
        },
      });
    };

    window.addEventListener('popstate', handler, true);
    return () => window.removeEventListener('popstate', handler, true);
  }, [location.pathname, openPrompt, promptOpen]);

  return null;
}
