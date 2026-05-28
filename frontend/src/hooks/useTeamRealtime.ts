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
  // 实时仅服务团队协作：仅当激活的是真实团队（非个人团队）才连 WS。
  // 个人/单人模式下 teamId 保持 null → realtimeClient 不建立连接，积分/任务走轮询。
  const isTeamMode = useTeamStore((s) => {
    const t = s.teams.find((team) => team.id === s.activeTeamId);
    return Boolean(t && !t.isPersonal);
  });
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const patchTeamCredits = useTeamStore((s) => s.patchTeamCredits);

  useEffect(() => {
    if (!isTeamMode || !activeTeamId || !userId) {
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
  }, [isTeamMode, activeTeamId, userId, patchTeamCredits]);
}
