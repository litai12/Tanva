import { useEffect } from 'react';
import type { CanvasCollabHandle } from './useCanvasCollab';
import type { CollabEnvelope, ToastPayload } from '../collab/types';

export interface UseCollabToastOptions {
  /**
   * Renderer for toast events. Wire to your global toast system
   * (e.g. shadcn/ui or sonner).
   */
  show: (text: string, kind: ToastPayload['kind']) => void;
  /** When true (default), only events from other users trigger the toast. */
  ignoreOwn?: boolean;
  /** Current user's id, used by `ignoreOwn`. */
  currentUserId?: string | null;
}

export function useCollabToast(
  collab: CanvasCollabHandle | null | undefined,
  options: UseCollabToastOptions,
): void {
  const { show, ignoreOwn = true, currentUserId } = options;

  useEffect(() => {
    if (!collab) return;
    const off = collab.subscribe('toast', (env: CollabEnvelope) => {
      const p = env.payload as ToastPayload;
      if (ignoreOwn && currentUserId && p.userId === currentUserId) return;
      try {
        show(`${p.name}: ${p.text}`, p.kind);
      } catch {}
    });

    if (collab.degraded) {
      try {
        show('实时协作降级（Redis 不可用），仅同一服务实例内可见', 'info');
      } catch {}
    }

    return off;
  }, [collab, show, ignoreOwn, currentUserId]);
}
