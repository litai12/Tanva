import React, { useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useAuthStore } from '@/stores/authStore';
import { useTeamStore } from '@/stores/teamStore';
import { useCanvasCollab } from '@/hooks/useCanvasCollab';
import { usePresence } from '@/hooks/usePresence';
import { useTaskBroadcast } from '@/hooks/useTaskBroadcast';
import { useCollabToast } from '@/hooks/useCollabToast';
import CollabCursorLayer from './CollabCursorLayer';
import CollabToastHost, { type CollabToastApi } from './CollabToastHost';
import type { ToastKind } from '@/collab/types';

const MOUSE_THROTTLE_MS = 10000;

/**
 * Top-level wiring for canvas real-time collaboration. Mounted once inside
 * the Canvas page; spins up the SSE connection, listens for presence/
 * cursor/task/toast events, and renders the overlay UI.
 *
 * The hook returns expose `sendPatch` / `claimLock` / `releaseLock` for
 * downstream Paper.js layers to consume — those wirings are intentionally
 * left for a follow-up so this PR stays focused on transport + UI bones.
 */
const CollabRoot: React.FC = () => {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const user = useAuthStore((s) => s.user);
  const currentUserId = user?.id ?? null;

  const toastApiRef = useRef<CollabToastApi | null>(null);
  const setToastApi = useCallback((api: CollabToastApi) => {
    toastApiRef.current = api;
  }, []);

  const onAccessRevoked = useCallback(() => {
    toastApiRef.current?.show('您对此项目的访问权限已被撤销', 'info');
  }, []);

  const onSnapshotRequired = useCallback(() => {
    toastApiRef.current?.show('远程变更过多，正在同步最新状态…', 'info');
  }, []);

  // Always call the hook with a placeholder when no project; React rules.
  const activeTeam = useTeamStore((s) => s.getActiveTeam());
  const isTeamMode = Boolean(activeTeam && !activeTeam.isPersonal);

  const collab = useCanvasCollab({
    projectId: projectId ?? '',
    onAccessRevoked,
    onSnapshotRequired,
  });
  const presence = usePresence(collab);

  const showToast = useCallback((text: string, kind: ToastKind) => {
    toastApiRef.current?.show(text, kind);
  }, []);

  useCollabToast(collab, {
    show: showToast,
    ignoreOwn: true,
    currentUserId,
  });

  useTaskBroadcast(collab, {
    onTaskStatus: (entry) => {
      if (entry.status === 'succeeded') {
        toastApiRef.current?.show(
          `任务完成：${entry.taskType}${entry.nodeId ? ` (#${entry.nodeId.slice(0, 6)})` : ''}`,
          'generate',
        );
      } else if (entry.status === 'failed') {
        toastApiRef.current?.show(
          `任务失败：${entry.taskType}${entry.error ? ` - ${entry.error.slice(0, 60)}` : ''}`,
          'generate',
        );
      }
    },
  });

  // Throttled mouse-move → cursor publish. Only in team mode, max once per 10s.
  const lastMouseSent = useRef(0);
  useEffect(() => {
    if (!projectId || !isTeamMode) return;
    const handler = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastMouseSent.current < MOUSE_THROTTLE_MS) return;
      lastMouseSent.current = now;
      collab.sendCursor(e.clientX, e.clientY);
    };
    window.addEventListener('mousemove', handler, { passive: true });
    return () => window.removeEventListener('mousemove', handler);
  }, [projectId, isTeamMode, collab]);

  if (!projectId) {
    return <CollabToastHost apiRef={setToastApi} />;
  }

  return (
    <>
      <CollabCursorLayer cursors={presence.cursors} />
      <CollabToastHost apiRef={setToastApi} />
    </>
  );
};

export default CollabRoot;
