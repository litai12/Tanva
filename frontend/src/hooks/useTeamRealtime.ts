import { useEffect } from 'react';
import { useTeamStore } from '@/stores/teamStore';
import { useAuthStore } from '@/stores/authStore';
import { realtimeClient } from '@/services/realtimeClient';
import type {
  CollabEnvelope,
  TeamCreditsChangedPayload,
} from '@/collab/types';

/**
 * 通过共享 WS 客户端订阅团队积分实时变更，保持本地余额同步。
 * 在 App 外壳挂载一次；activeTeamId 变化时由 realtimeClient 用新参数重连。
 */
export function useTeamRealtime(): void {
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const patchTeamCredits = useTeamStore((s) => s.patchTeamCredits);

  useEffect(() => {
    if (!activeTeamId || !userId) {
      realtimeClient.setContext({ teamId: null });
      return;
    }
    realtimeClient.setContext({ teamId: activeTeamId });

    const unsub = realtimeClient.subscribe((env: CollabEnvelope) => {
      if (env.type === 'team_credits_changed') {
        const p = env.payload as TeamCreditsChangedPayload;
        if (!p?.teamId) return;
        patchTeamCredits(p.teamId, p.availableCredits);
        try {
          window.dispatchEvent(new CustomEvent('team-credits-changed', { detail: p }));
        } catch {}
      } else if (env.type === 'user_credits_changed') {
        try {
          window.dispatchEvent(new CustomEvent('refresh-credits'));
        } catch {}
      }
    });

    return () => {
      unsub();
    };
  }, [activeTeamId, userId, patchTeamCredits]);
}
