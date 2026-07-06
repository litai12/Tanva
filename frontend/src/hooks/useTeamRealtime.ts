import { useEffect, useRef } from 'react';
import { useTeamStore } from '@/stores/teamStore';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { realtimeClient } from '@/services/realtimeClient';
import type {
  CollabEnvelope,
  TeamCreditsChangedPayload,
  TeamProjectsChangedPayload,
} from '@/collab/types';

/** team_projects_changed 失效事件的 window 广播名：已打开的项目弹窗/管理面板据此重拉本地列表。 */
export const TEAM_PROJECTS_CHANGED_EVENT = 'team-projects-changed';
/** 当前正在编辑的项目被他人删除：携带 {projectId}，由 CurrentProjectDeletedModal 接管交互。 */
export const CURRENT_PROJECT_DELETED_EVENT = 'tanva:current-project-deleted';
const PROJECT_LIST_REFETCH_DEBOUNCE_MS = 300;

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
  // 团队项目列表刷新的前沿节流计时器（突发多条 team_projects_changed 只在窗口尾部补一次拉取）。
  const projectsRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsLastFetchAt = useRef(0);

  useEffect(() => {
    if (!isTeamMode || !activeTeamId || !userId) {
      realtimeClient.setContext({ teamId: null });
      return;
    }
    realtimeClient.setContext({ teamId: activeTeamId });

    const runProjectsRefetch = () => {
      // store 持久列表 + 已打开弹窗（各自本地拉取）都刷新一遍。
      void useProjectStore.getState().refreshList();
      try {
        window.dispatchEvent(new CustomEvent(TEAM_PROJECTS_CHANGED_EVENT));
      } catch {}
    };
    const debouncedProjectsRefetch = () => {
      const elapsed = Date.now() - projectsLastFetchAt.current;
      if (elapsed >= PROJECT_LIST_REFETCH_DEBOUNCE_MS) {
        projectsLastFetchAt.current = Date.now();
        runProjectsRefetch();
      } else if (!projectsRefetchTimer.current) {
        projectsRefetchTimer.current = setTimeout(() => {
          projectsRefetchTimer.current = null;
          projectsLastFetchAt.current = Date.now();
          runProjectsRefetch();
        }, PROJECT_LIST_REFETCH_DEBOUNCE_MS - elapsed);
      }
    };

    const unsub = realtimeClient.subscribe((env: CollabEnvelope) => {
      if (env.type === 'team_credits_changed') {
        const p = env.payload as TeamCreditsChangedPayload;
        if (!p?.teamId) return;
        patchTeamCredits(p.teamId, p.availableCredits);
        try {
          window.dispatchEvent(new CustomEvent('team-credits-changed', { detail: p }));
          // 顶栏团队额度（teamMyQuota：含个人配额剩余）按 refresh-credits 重拉，保证实时刷新。
          window.dispatchEvent(new CustomEvent('refresh-credits'));
        } catch {}
      } else if (env.type === 'user_credits_changed') {
        try {
          window.dispatchEvent(new CustomEvent('refresh-credits'));
        } catch {}
      } else if (env.type === 'team_projects_changed') {
        const p = env.payload as TeamProjectsChangedPayload;
        // 仅刷新当前激活团队的列表（其他团队的变更无需打断当前视图）。
        if (p?.teamId && p.teamId !== activeTeamId) return;
        // 删除的恰好是「我正在编辑的当前项目」：立刻暂停其自动保存（避免反复 404 刷红），
        // 并交给 CurrentProjectDeletedModal 弹窗（另存为新项目 / 返回列表）。
        if (p?.action === 'deleted' && p.projectId &&
            p.projectId === useProjectStore.getState().currentProjectId) {
          try { useProjectContentStore.getState().setCacheValidationPending(true); } catch {}
          try {
            window.dispatchEvent(
              new CustomEvent(CURRENT_PROJECT_DELETED_EVENT, { detail: { projectId: p.projectId } }),
            );
          } catch {}
        }
        debouncedProjectsRefetch();
      }
    });

    return () => {
      unsub();
      if (projectsRefetchTimer.current) {
        clearTimeout(projectsRefetchTimer.current);
        projectsRefetchTimer.current = null;
      }
    };
  }, [isTeamMode, activeTeamId, userId, patchTeamCredits]);
}
