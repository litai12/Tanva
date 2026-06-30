import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useTeamStore } from '@/stores/teamStore';
import { useAuthStore } from '@/stores/authStore';
import { useCollab } from '@/collab/CollabContext';
import type { CommentMarkerMovePayload } from '@/collab/types';
import { teamApi } from '@/services/teamApi';
import {
  canvasCommentsApi,
  type CanvasComment,
  type CanvasCommentThread,
  type CommentAuthor,
} from '@/services/canvasCommentsApi';

const REFETCH_DEBOUNCE_MS = 300;

export interface MentionCandidate extends CommentAuthor {}

export interface CreateThreadInput {
  x?: number;
  y?: number;
  body: string;
  mentions?: string[];
  imageUrls?: string[];
}

export interface ReplyInput {
  body: string;
  mentions?: string[];
  imageUrls?: string[];
}

export interface CanvasCommentsValue {
  /** 当前项目全部线程（含已 resolve），按 createdAt 升序。 */
  threads: CanvasCommentThread[];
  loading: boolean;
  currentUserId: string | null;
  /** 可被 @ 的成员候选（团队成员；个人模式为空）。 */
  members: MentionCandidate[];
  createThread: (input: CreateThreadInput) => Promise<CanvasCommentThread | null>;
  reply: (threadId: string, input: ReplyInput) => Promise<CanvasComment | null>;
  editComment: (commentId: string, input: ReplyInput) => Promise<void>;
  removeComment: (commentId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  setResolved: (threadId: string, resolved: boolean) => Promise<void>;
  moveThread: (threadId: string, x: number, y: number) => Promise<void>;
  previewMoveThread: (threadId: string, x: number, y: number) => void;
  refetch: () => void;
}

const Ctx = createContext<CanvasCommentsValue | null>(null);

/**
 * 画布评论数据层（单实例，pin 浮层与右侧抽屉共享）。DB 为事实源；团队模式下收到
 * comment_changed 失效通知后 debounce 重新拉取，WS 重连(connected)后补拉。本端 mutation
 * 成功后直接更新本地状态——个人模式无 WS 时也能即时显示（不依赖回声）。
 */
export const CanvasCommentsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const isTeamMode = useTeamStore((s) => {
    const team = s.teams.find((t) => t.id === s.activeTeamId);
    return Boolean(team && !team.isPersonal);
  });
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ?? null;
  const collab = useCollab();

  const [threads, setThreads] = useState<CanvasCommentThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<MentionCandidate[]>([]);

  const teamIdForReq = isTeamMode ? activeTeamId : null;
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqRef = useRef({ projectId, teamIdForReq });
  reqRef.current = { projectId, teamIdForReq };
  // 单调请求序号 + 上下文校验：切项目/团队后丢弃在途旧响应，防旧评论覆盖新项目。
  const reqSeq = useRef(0);
  const isStale = (token: number, pid: string | null, tid: string | null) =>
    token !== reqSeq.current ||
    reqRef.current.projectId !== pid ||
    reqRef.current.teamIdForReq !== tid;

  const refetch = useCallback(() => {
    const { projectId: pid, teamIdForReq: tid } = reqRef.current;
    if (!pid) {
      setThreads([]);
      return;
    }
    const token = ++reqSeq.current;
    setLoading(true);
    canvasCommentsApi
      .list(pid, tid, true)
      .then((data) => {
        if (isStale(token, pid, tid)) return;
        setThreads(Array.isArray(data) ? data : []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!isStale(token, pid, tid)) setLoading(false);
      });
  }, []);

  // 前沿节流：收到第一条 comment_changed 立即拉取，突发多条只在窗口尾部补一次。
  const lastFetchAt = useRef(0);
  const debouncedRefetch = useCallback(() => {
    const elapsed = Date.now() - lastFetchAt.current;
    if (elapsed >= REFETCH_DEBOUNCE_MS) {
      lastFetchAt.current = Date.now();
      refetch();
    } else if (!refetchTimer.current) {
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        lastFetchAt.current = Date.now();
        refetch();
      }, REFETCH_DEBOUNCE_MS - elapsed);
    }
  }, [refetch]);

  useEffect(() => {
    if (!projectId) {
      setThreads([]);
      return;
    }
    refetch();
  }, [projectId, teamIdForReq, refetch]);

  const loadMembers = useCallback(() => {
    if (!isTeamMode || !activeTeamId) {
      setMembers([]);
      return undefined;
    }
    let cancelled = false;
    const run = () => teamApi
      .getMembers(activeTeamId)
      .then((rows) => {
        if (cancelled) return;
        const mapped: MentionCandidate[] = (Array.isArray(rows) ? rows : [])
          .map((m: any) => m?.user)
          .filter(Boolean)
          .map((u: any) => ({ id: u.id, name: u.name ?? null, avatarUrl: u.avatarUrl ?? null }));
        setMembers(mapped);
      })
      .catch(() => undefined);
    void run();
    return () => {
      cancelled = true;
    };
  }, [isTeamMode, activeTeamId]);

  useEffect(() => loadMembers(), [loadMembers]);

  useEffect(() => {
    const onProfileUpdated = () => {
      loadMembers();
      refetch();
    };
    window.addEventListener('tanva:profile-updated', onProfileUpdated);
    return () => window.removeEventListener('tanva:profile-updated', onProfileUpdated);
  }, [loadMembers, refetch]);

  useEffect(() => {
    if (!collab || !projectId) return;
    const offChanged = collab.subscribe('comment_changed', () => debouncedRefetch());
    const offConnected = collab.subscribe('connected', () => debouncedRefetch());
    const offMarkerMove = collab.subscribe('comment_marker_move', (env) => {
      const payload = env.payload as CommentMarkerMovePayload;
      if (!payload || typeof payload.threadId !== 'string') return;
      if (typeof payload.x !== 'number' || typeof payload.y !== 'number') return;
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === payload.threadId ? { ...thread, x: payload.x, y: payload.y } : thread,
        ),
      );
    });
    return () => {
      offChanged();
      offConnected();
      offMarkerMove();
    };
  }, [collab, projectId, debouncedRefetch]);

  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

  const sameCtx = (pid: string | null, tid: string | null) =>
    reqRef.current.projectId === pid && reqRef.current.teamIdForReq === tid;

  const createThread = useCallback(
    async (input: CreateThreadInput) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      const body = (input.body ?? '').trim();
      const hasImages = (input.imageUrls?.length ?? 0) > 0;
      if (!pid || (!body && !hasImages)) return null;
      const thread = await canvasCommentsApi.createThread(
        pid,
        {
          x: input.x,
          y: input.y,
          body,
          mentions: input.mentions,
          imageUrls: input.imageUrls,
          connId: collab?.connId ?? null,
        },
        tid,
      );
      if (sameCtx(pid, tid)) setThreads((prev) => [...prev, thread]);
      return thread;
    },
    [collab],
  );

  const reply = useCallback(
    async (threadId: string, input: ReplyInput) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      const body = (input.body ?? '').trim();
      const hasImages = (input.imageUrls?.length ?? 0) > 0;
      if (!pid || (!body && !hasImages)) return null;
      const comment = await canvasCommentsApi.reply(
        pid,
        threadId,
        { body, mentions: input.mentions, imageUrls: input.imageUrls, connId: collab?.connId ?? null },
        tid,
      );
      if (sameCtx(pid, tid)) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? { ...t, resolved: false, comments: [...t.comments, comment] } : t,
          ),
        );
      }
      return comment;
    },
    [collab],
  );

  const editComment = useCallback(
    async (commentId: string, input: ReplyInput) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      const body = (input.body ?? '').trim();
      const hasImages = (input.imageUrls?.length ?? 0) > 0;
      if (!pid || (!body && !hasImages)) return;
      const updated = await canvasCommentsApi.edit(
        pid,
        commentId,
        { body, mentions: input.mentions, imageUrls: input.imageUrls, connId: collab?.connId ?? null },
        tid,
      );
      if (sameCtx(pid, tid)) {
        setThreads((prev) =>
          prev.map((t) => ({
            ...t,
            comments: t.comments.map((c) => (c.id === commentId ? updated : c)),
          })),
        );
      }
    },
    [collab],
  );

  const removeComment = useCallback(
    async (commentId: string) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      if (!pid) return;
      await canvasCommentsApi.remove(pid, commentId, tid, collab?.connId ?? null);
      if (sameCtx(pid, tid)) {
        setThreads((prev) =>
          prev.map((t) => ({
            ...t,
            comments: t.comments.map((c) =>
              c.id === commentId
                ? { ...c, deleted: true, body: '', mentions: [], imageUrls: [] }
                : c,
            ),
          })),
        );
      }
    },
    [collab],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      if (!pid) return;
      // 乐观移除，避免删除后 pin 残留。
      if (sameCtx(pid, tid)) setThreads((prev) => prev.filter((t) => t.id !== threadId));
      try {
        await canvasCommentsApi.removeThread(pid, threadId, tid, collab?.connId ?? null);
      } catch {
        debouncedRefetch();
      }
    },
    [collab, debouncedRefetch],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      if (!pid) return;
      const updated = await canvasCommentsApi.resolve(
        pid,
        threadId,
        resolved,
        tid,
        collab?.connId ?? null,
      );
      if (sameCtx(pid, tid)) setThreads((prev) => prev.map((t) => (t.id === threadId ? updated : t)));
    },
    [collab],
  );

  const moveThread = useCallback(
    async (threadId: string, x: number, y: number) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      if (!pid) return;
      // 乐观更新坐标，避免拖放后回弹。
      if (sameCtx(pid, tid)) {
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, x, y } : t)));
      }
      try {
        const updated = await canvasCommentsApi.move(pid, threadId, x, y, tid, collab?.connId ?? null);
        if (sameCtx(pid, tid)) {
          setThreads((prev) => prev.map((t) => (t.id === threadId ? updated : t)));
        }
      } catch {
        // 失败则补拉收敛。
        debouncedRefetch();
      }
    },
    [collab, debouncedRefetch],
  );

  const previewMoveThread = useCallback(
    (threadId: string, x: number, y: number) => {
      if (!threadId) return;
      collab?.sendCommentMarkerMove(threadId, x, y);
    },
    [collab],
  );

  const membersWithCurrent = useMemo<MentionCandidate[]>(() => {
    if (!currentUser?.id) return members;
    const current: MentionCandidate = {
      id: currentUser.id,
      name: currentUser.name ?? currentUser.id.slice(0, 8),
      avatarUrl: currentUser.avatarUrl ?? null,
    };
    const exists = members.some((m) => m.id === current.id);
    return exists
      ? members.map((m) => (m.id === current.id ? { ...m, ...current } : m))
      : [current, ...members];
  }, [members, currentUser?.id, currentUser?.name, currentUser?.avatarUrl]);

  const hydratedThreads = useMemo<CanvasCommentThread[]>(() => {
    if (membersWithCurrent.length === 0) return threads;
    const profiles = new Map(membersWithCurrent.map((m) => [m.id, m]));
    return threads.map((thread) => ({
      ...thread,
      comments: thread.comments.map((comment) => {
        const profile = profiles.get(comment.author.id);
        if (!profile) return comment;
        const nextAuthor = {
          ...comment.author,
          name: profile.name ?? comment.author.name,
          avatarUrl: profile.avatarUrl ?? null,
        };
        if (nextAuthor.name === comment.author.name && nextAuthor.avatarUrl === comment.author.avatarUrl) {
          return comment;
        }
        return { ...comment, author: nextAuthor };
      }),
    }));
  }, [threads, membersWithCurrent]);

  const value = useMemo<CanvasCommentsValue>(
    () => ({
      threads: hydratedThreads,
      loading,
      currentUserId,
      members: membersWithCurrent,
      createThread,
      reply,
      editComment,
      removeComment,
      deleteThread,
      setResolved,
      moveThread,
      previewMoveThread,
      refetch,
    }),
    [
      hydratedThreads,
      loading,
      currentUserId,
      membersWithCurrent,
      createThread,
      reply,
      editComment,
      removeComment,
      deleteThread,
      setResolved,
      moveThread,
      previewMoveThread,
      refetch,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useCanvasComments(): CanvasCommentsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCanvasComments must be used within CanvasCommentsProvider');
  return v;
}
