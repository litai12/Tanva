import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useTeamStore } from '@/stores/teamStore';
import { useAuthStore } from '@/stores/authStore';
import { useCollab } from '@/collab/CollabContext';
import { teamApi } from '@/services/teamApi';
import {
  canvasCommentsApi,
  type CanvasComment,
  type CanvasCommentThread,
  type CommentAuthor,
} from '@/services/canvasCommentsApi';

const REFETCH_DEBOUNCE_MS = 300;

export interface MentionCandidate extends CommentAuthor {}

export interface UseNodeCommentsResult {
  /** 当前项目全部线程（含已 resolve）。 */
  threads: CanvasCommentThread[];
  /** nodeId -> 该节点的线程列表。 */
  threadsByNode: Map<string, CanvasCommentThread[]>;
  loading: boolean;
  currentUserId: string | null;
  /** 可被 @ 的成员候选（团队成员；个人模式为空）。 */
  members: MentionCandidate[];
  createThread: (nodeId: string, body: string, mentions?: string[]) => Promise<CanvasCommentThread | null>;
  reply: (threadId: string, body: string, mentions?: string[]) => Promise<CanvasComment | null>;
  editComment: (commentId: string, body: string, mentions?: string[]) => Promise<void>;
  removeComment: (commentId: string) => Promise<void>;
  setResolved: (threadId: string, resolved: boolean) => Promise<void>;
  refetch: () => void;
}

/**
 * 节点评论数据层。DB 为事实源；团队模式下收到 comment_changed 失效通知后 debounce 重新拉取，
 * WS 重连(connected)后也补拉一次。本端 mutation 成功后直接更新本地状态——个人模式无 WS 时
 * 也能即时显示（不依赖回声）。
 */
export function useNodeComments(): UseNodeCommentsResult {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const isTeamMode = useTeamStore((s) => {
    const team = s.teams.find((t) => t.id === s.activeTeamId);
    return Boolean(team && !team.isPersonal);
  });
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const collab = useCollab();

  const [threads, setThreads] = useState<CanvasCommentThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<MentionCandidate[]>([]);

  const teamIdForReq = isTeamMode ? activeTeamId : null;
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用 ref 保存最新依赖，避免 refetch 标识随每次渲染变化导致订阅频繁重建。
  const reqRef = useRef({ projectId, teamIdForReq });
  reqRef.current = { projectId, teamIdForReq };
  // 单调请求序号 + 上下文校验：切换项目/团队时丢弃在途旧响应，防止旧项目评论覆盖新项目。
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

  const debouncedRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  // 初次进入 / 切换项目或团队：全量拉取。
  useEffect(() => {
    if (!projectId) {
      setThreads([]);
      return;
    }
    refetch();
  }, [projectId, teamIdForReq, refetch]);

  // 加载团队成员作为 @ 候选。
  useEffect(() => {
    if (!isTeamMode || !activeTeamId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    teamApi
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
    return () => {
      cancelled = true;
    };
  }, [isTeamMode, activeTeamId]);

  // 订阅实时失效通知 + 重连补拉。
  useEffect(() => {
    if (!collab || !projectId) return;
    const offChanged = collab.subscribe('comment_changed', () => debouncedRefetch());
    const offConnected = collab.subscribe('connected', () => debouncedRefetch());
    return () => {
      offChanged();
      offConnected();
    };
  }, [collab, projectId, debouncedRefetch]);

  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

  const threadsByNode = useMemo(() => {
    const map = new Map<string, CanvasCommentThread[]>();
    for (const t of threads) {
      const arr = map.get(t.nodeId);
      if (arr) arr.push(t);
      else map.set(t.nodeId, [t]);
    }
    return map;
  }, [threads]);

  // ---- mutations：成功后直接更新本地 ----

  const createThread = useCallback(
    async (nodeId: string, body: string, mentions?: string[]) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      if (!pid || !body.trim()) return null;
      const thread = await canvasCommentsApi.createThread(
        pid,
        { nodeId, body: body.trim(), mentions, connId: collab?.connId ?? null },
        tid,
      );
      if (reqRef.current.projectId === pid && reqRef.current.teamIdForReq === tid) {
        setThreads((prev) => [...prev, thread]);
      }
      return thread;
    },
    [collab],
  );

  const reply = useCallback(
    async (threadId: string, body: string, mentions?: string[]) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      if (!pid || !body.trim()) return null;
      const comment = await canvasCommentsApi.reply(
        pid,
        threadId,
        { body: body.trim(), mentions, connId: collab?.connId ?? null },
        tid,
      );
      if (reqRef.current.projectId === pid && reqRef.current.teamIdForReq === tid) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? { ...t, resolved: false, comments: [...t.comments, comment] }
              : t,
          ),
        );
      }
      return comment;
    },
    [collab],
  );

  const editComment = useCallback(
    async (commentId: string, body: string, mentions?: string[]) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      if (!pid || !body.trim()) return;
      const updated = await canvasCommentsApi.edit(
        pid,
        commentId,
        { body: body.trim(), mentions, connId: collab?.connId ?? null },
        tid,
      );
      if (reqRef.current.projectId === pid && reqRef.current.teamIdForReq === tid) {
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
      if (reqRef.current.projectId === pid && reqRef.current.teamIdForReq === tid) {
        setThreads((prev) =>
          prev.map((t) => ({
            ...t,
            comments: t.comments.map((c) =>
              c.id === commentId ? { ...c, deleted: true, body: '', mentions: [] } : c,
            ),
          })),
        );
      }
    },
    [collab],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      const pid = reqRef.current.projectId;
      const tid = reqRef.current.teamIdForReq;
      if (!pid) return;
      const updated = await canvasCommentsApi.resolve(pid, threadId, resolved, tid, collab?.connId ?? null);
      if (reqRef.current.projectId === pid && reqRef.current.teamIdForReq === tid) {
        setThreads((prev) => prev.map((t) => (t.id === threadId ? updated : t)));
      }
    },
    [collab],
  );

  return {
    threads,
    threadsByNode,
    loading,
    currentUserId,
    members,
    createThread,
    reply,
    editComment,
    removeComment,
    setResolved,
    refetch,
  };
}
