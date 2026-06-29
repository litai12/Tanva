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
const PATCH_MAXWAIT_MS = 150; // 持续拖动时最长 150ms 强制推送一次, 保证 <300ms 实时跟随
const CURSOR_THROTTLE_MS = 80;
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
  /** x/y 为画布世界坐标（Paper project 坐标），由调用方换算后传入。 */
  sendCursor: (x: number, y: number) => void;
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
  const patchLastFlush = useRef<number>(0);
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
    const handleProfileUpdated = () => {
      realtimeClient.refresh();
    };
    window.addEventListener('tanva:profile-updated', handleProfileUpdated);
    return () => {
      window.removeEventListener('tanva:profile-updated', handleProfileUpdated);
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
        const byId = new Map<string, Record<string, unknown>>();
        const noId: unknown[] = [];
        for (const it of arr) {
          const cur = it as Record<string, unknown>;
          const id = cur?.id;
          if (typeof id === 'string') {
            const prev = byId.get(id);
            if (!prev) {
              byId.set(id, cur);
              continue;
            }
            // 合并而非整体替换：同一去抖窗口内，先到的完整新增补丁{id,type,data,...}
            // 不能被后到的局部补丁{id,position}覆盖丢掉 type/data，否则对端会据此合成
            // 无 type 的"未知节点"。{...prev,...cur} 已能保留 cur 未携带的 type；
            // data/style 再做深合并，避免互相覆盖。
            const merged: Record<string, unknown> = { ...prev, ...cur };
            if (prev.data || cur.data) {
              merged.data = { ...(prev.data as object || {}), ...(cur.data as object || {}) };
            }
            if (prev.style || cur.style) {
              merged.style = { ...(prev.style as object || {}), ...(cur.style as object || {}) };
            }
            byId.set(id, merged);
          } else {
            noId.push(it);
          }
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
      const post = (payload: NodePatchPayload, attempt: number) => {
        // 用当前(可能刚重连刷新过的) connId 发送；失败(网络抖动/重连后旧 connId 被判 403)
        // 重试一次, 避免单次丢包导致对端漏掉该次编辑(尤其拖拽最终位置)。
        fetchWithAuth(`${base}/api/canvas/${projectId}/patch?teamId=${activeTeamId ?? ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: payload, connId: connIdRef.current }),
        })
          .then((res) => {
            if (!res.ok && attempt === 0 && connIdRef.current) {
              setTimeout(() => post(payload, 1), 300);
            }
          })
          .catch(() => {
            if (attempt === 0 && connIdRef.current) setTimeout(() => post(payload, 1), 300);
          });
      };
      const flush = () => {
        if (patchDebounce.current) { clearTimeout(patchDebounce.current); patchDebounce.current = null; }
        const toSend = pendingPatch.current;
        pendingPatch.current = null;
        patchLastFlush.current = Date.now();
        if (!toSend) return;
        post(toSend, 0);
      };
      // maxWait 节流：持续拖动(每帧调用)时, 距上次发送 >=150ms 立即推送, 实现实时跟随;
      // 否则按 200ms 去抖在停顿后发出最终值。两者都保证不丢、不积压。
      if (Date.now() - patchLastFlush.current >= PATCH_MAXWAIT_MS) {
        flush();
        return;
      }
      if (patchDebounce.current) clearTimeout(patchDebounce.current);
      patchDebounce.current = setTimeout(flush, PATCH_DEBOUNCE_MS);
    },
    [projectId, activeTeamId],
  );

  const sendCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      if (now - cursorLastSent.current < CURSOR_THROTTLE_MS) return;
      cursorLastSent.current = now;
      realtimeClient.send({ type: 'cursor', payload: { x, y } });
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
