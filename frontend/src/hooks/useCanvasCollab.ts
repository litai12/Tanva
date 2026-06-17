import { useCallback, useEffect, useRef, useState } from 'react';
import { useTeamStore } from '../stores/teamStore';
import { getAccessToken } from '../services/authTokenStorage';
import { fetchWithAuth } from '../services/authFetch';
import { realtimeClient } from '../services/realtimeClient';
import type {
  CollabEnvelope,
  CollabEventType,
  CollabListener,
  ConnectedPayload,
  NodePatchPayload,
} from '../collab/types';

const PATCH_DEBOUNCE_MS = 200;
const CURSOR_THROTTLE_MS = 150;
const RECONNECT_MS = 3000;
const SEQ_DEDUP_WINDOW = 200;

const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

export interface UseCanvasCollabOptions {
  projectId: string;
  onAccessRevoked?: () => void;
  onSnapshotRequired?: () => void;
}

export interface CanvasCollabHandle {
  connected: boolean;
  connId: string | null;
  degraded: boolean;
  subscribe: (type: CollabEventType | CollabEventType[], listener: CollabListener) => () => void;
  sendPatch: (patch: NodePatchPayload) => void;
  sendCursor: (x: number, y: number, viewport?: { zoom?: number; offsetX?: number; offsetY?: number }) => void;
  claimLock: (nodeId: string) => Promise<{ acquired: boolean; expiresAt: number; holder?: { userId: string } }>;
  renewLock: (nodeId: string) => Promise<{ acquired: boolean; expiresAt: number }>;
  releaseLock: (nodeId: string) => Promise<boolean>;
  sendToast: (kind: string, text: string) => Promise<void>;
}

export function useCanvasCollab({ projectId, onAccessRevoked, onSnapshotRequired }: UseCanvasCollabOptions): CanvasCollabHandle {
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const isTeamMode = useTeamStore((s) => {
    const team = s.teams.find((t) => t.id === s.activeTeamId);
    return Boolean(team && !team.isPersonal);
  });
  const [connected, setConnected] = useState(false);
  const [connId, setConnId] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  const connIdRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<NodePatchPayload | null>(null);
  const cursorLastSent = useRef<number>(0);
  const lastSeqRef = useRef<number>(0);
  const seenSeqs = useRef<number[]>([]);
  const listenersRef = useRef<Map<CollabEventType | '*', Set<CollabListener>>>(new Map());
  const onAccessRevokedRef = useRef(onAccessRevoked);
  const onSnapshotRequiredRef = useRef(onSnapshotRequired);

  useEffect(() => {
    onAccessRevokedRef.current = onAccessRevoked;
  }, [onAccessRevoked]);
  useEffect(() => {
    onSnapshotRequiredRef.current = onSnapshotRequired;
  }, [onSnapshotRequired]);

  const subscribe = useCallback(
    (type: CollabEventType | CollabEventType[], listener: CollabListener): (() => void) => {
      const types = Array.isArray(type) ? type : [type];
      const cleanups: Array<() => void> = [];
      for (const t of types) {
        let set = listenersRef.current.get(t);
        if (!set) {
          set = new Set();
          listenersRef.current.set(t, set);
        }
        set.add(listener);
        const captured = set;
        cleanups.push(() => {
          captured.delete(listener);
        });
      }
      return () => {
        for (const c of cleanups) c();
      };
    },
    [],
  );

  const dispatch = useCallback((envelope: CollabEnvelope) => {
    if (typeof envelope.seq === 'number') {
      if (seenSeqs.current.includes(envelope.seq)) return;
      seenSeqs.current.push(envelope.seq);
      if (seenSeqs.current.length > SEQ_DEDUP_WINDOW) {
        seenSeqs.current.splice(0, seenSeqs.current.length - SEQ_DEDUP_WINDOW);
      }
      if (envelope.seq > lastSeqRef.current) {
        lastSeqRef.current = envelope.seq;
      }
      // 向 realtimeClient 推进补帧游标，断线重连时带上 after=seq。
      realtimeClient.noteSeq(envelope.seq);
    }
    const set = listenersRef.current.get(envelope.type);
    if (set) for (const fn of set) fn(envelope);
    const star = listenersRef.current.get('*' as CollabEventType);
    if (star) for (const fn of star) fn(envelope);
  }, []);

  const connect = useCallback(() => {
    // 设置 project 上下文（realtimeClient 会用新参数重连，始终单连接）。
    realtimeClient.setContext({ projectId: projectId || null });
    const unsub = realtimeClient.subscribe((env: CollabEnvelope) => {
      if (!env || typeof env.type !== 'string') return;
      if (env.type === 'connected') {
        const data = env.payload as ConnectedPayload;
        setConnected(true);
        setDegraded(Boolean(data?.degraded));
        // 写入 connId：激活 sendPatch / claimLock / sendToast（此前为 no-op 导致协作编辑不生效）。
        connIdRef.current = data?.connId ?? null;
        setConnId(data?.connId ?? null);
        dispatch({ type: 'connected', payload: data, ts: Date.now() });
        return;
      }
      if (env.type === 'access_revoked') {
        onAccessRevokedRef.current?.();
        return;
      }
      if (env.type === 'snapshot_required') {
        onSnapshotRequiredRef.current?.();
      }
      // 抑制自己发出的事件
      if (env.senderConnId && env.senderConnId === connIdRef.current) return;
      dispatch(env);
    });
    // 保存退订函数到 cleanupRef
    cleanupRef.current = unsub;
  }, [projectId, dispatch]);

  useEffect(() => {
    connect();
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      // 离开画布：清掉 project 上下文（团队连接仍由 useTeamRealtime 维持）
      realtimeClient.setContext({ projectId: null });
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      setConnected(false);
      setConnId(null);
      connIdRef.current = null;
    };
  }, [connect]);

  const sendPatch = useCallback(
    (patch: NodePatchPayload) => {
      if (!connIdRef.current) return;
      // 合并待发送 patch：200ms 去抖窗口内多次调用（移动/增删/Prompt 等不同来源）
      // 必须累积合并，否则后一次会覆盖前一次导致编辑丢失。upsert 按 id 去重保留最新。
      const dedupById = (arr?: unknown[]): unknown[] | undefined => {
        if (!arr || arr.length === 0) return undefined;
        const byId = new Map<string, unknown>();
        const noId: unknown[] = [];
        for (const it of arr) {
          const id = (it as { id?: unknown })?.id;
          if (typeof id === 'string') byId.set(id, it);
          else noId.push(it);
        }
        return [...noId, ...byId.values()];
      };
      const prev = pendingPatch.current ?? {};
      pendingPatch.current = {
        upsertNodes: dedupById([...(prev.upsertNodes ?? []), ...(patch.upsertNodes ?? [])]),
        removeNodeIds: [...new Set([...(prev.removeNodeIds ?? []), ...(patch.removeNodeIds ?? [])])],
        upsertEdges: dedupById([...(prev.upsertEdges ?? []), ...(patch.upsertEdges ?? [])]),
        removeEdgeIds: [...new Set([...(prev.removeEdgeIds ?? []), ...(patch.removeEdgeIds ?? [])])],
      };
      if (patchDebounce.current) clearTimeout(patchDebounce.current);
      patchDebounce.current = setTimeout(() => {
        const toSend = pendingPatch.current;
        pendingPatch.current = null;
        if (!toSend) return;
        fetchWithAuth(`${base}/api/canvas/${projectId}/patch?teamId=${activeTeamId ?? ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: toSend, connId: connIdRef.current }),
        }).catch(() => undefined);
      }, PATCH_DEBOUNCE_MS);
    },
    [projectId, activeTeamId],
  );

  const sendCursor = useCallback(
    (x: number, y: number, viewport?: { zoom?: number; offsetX?: number; offsetY?: number }) => {
      const now = Date.now();
      if (now - cursorLastSent.current < CURSOR_THROTTLE_MS) return;
      cursorLastSent.current = now;
      realtimeClient.send({ type: 'cursor', payload: { x, y, viewport } });
    },
    [],
  );

  const claimLock = useCallback(
    async (nodeId: string) => {
      if (!connIdRef.current) return { acquired: false, expiresAt: 0 };
      try {
        const res = await fetchWithAuth(
          `${base}/api/canvas/${projectId}/lock?teamId=${activeTeamId ?? ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, connId: connIdRef.current }),
          },
        );
        return (await res.json()) as { acquired: boolean; expiresAt: number; holder?: { userId: string } };
      } catch {
        return { acquired: false, expiresAt: 0 };
      }
    },
    [projectId, activeTeamId],
  );

  const renewLock = useCallback(
    async (nodeId: string) => {
      if (!connIdRef.current) return { acquired: false, expiresAt: 0 };
      try {
        const res = await fetchWithAuth(
          `${base}/api/canvas/${projectId}/lock/renew?teamId=${activeTeamId ?? ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, connId: connIdRef.current }),
          },
        );
        return (await res.json()) as { acquired: boolean; expiresAt: number };
      } catch {
        return { acquired: false, expiresAt: 0 };
      }
    },
    [projectId, activeTeamId],
  );

  const releaseLock = useCallback(
    async (nodeId: string) => {
      if (!connIdRef.current) return false;
      try {
        const res = await fetchWithAuth(
          `${base}/api/canvas/${projectId}/unlock?teamId=${activeTeamId ?? ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, connId: connIdRef.current }),
          },
        );
        const data = (await res.json()) as { released?: boolean };
        return Boolean(data.released);
      } catch {
        return false;
      }
    },
    [projectId, activeTeamId],
  );

  const sendToast = useCallback(
    async (kind: string, text: string) => {
      if (!connIdRef.current) return;
      try {
        await fetchWithAuth(
          `${base}/api/canvas/${projectId}/toast?teamId=${activeTeamId ?? ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, text, connId: connIdRef.current }),
          },
        );
      } catch {}
    },
    [projectId, activeTeamId],
  );

  return {
    connected,
    connId,
    degraded,
    subscribe,
    sendPatch,
    sendCursor,
    claimLock,
    renewLock,
    releaseLock,
    sendToast,
  };
}
