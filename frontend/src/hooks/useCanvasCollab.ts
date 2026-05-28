import { useCallback, useEffect, useRef, useState } from 'react';
import { useTeamStore } from '../stores/teamStore';
import { getAccessToken } from '../services/authTokenStorage';
import { fetchWithAuth } from '../services/authFetch';
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
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    }
    const set = listenersRef.current.get(envelope.type);
    if (set) for (const fn of set) fn(envelope);
    const star = listenersRef.current.get('*' as CollabEventType);
    if (star) for (const fn of star) fn(envelope);
  }, []);

  const connect = useCallback(() => {
    return; // SSE temporarily disabled
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    const token = getAccessToken() ?? '';
    const params = new URLSearchParams({
      teamId: activeTeamId ?? '',
      token,
    });
    if (lastSeqRef.current > 0) params.set('after', String(lastSeqRef.current));
    const url = `${base}/api/canvas/${projectId}/stream?${params.toString()}`;
    const es = new EventSource(url, { withCredentials: false });

    const namedTypes: CollabEventType[] = [
      'cursor',
      'node_patch',
      'node_lock',
      'task_status',
      'toast',
      'presence_join',
      'presence_leave',
      'access_revoked',
      'snapshot_required',
    ];

    es.addEventListener('connected', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as ConnectedPayload;
        connIdRef.current = data.connId;
        setConnId(data.connId);
        setConnected(true);
        setDegraded(Boolean(data.degraded));
        dispatch({
          type: 'connected',
          payload: data,
          ts: Date.now(),
        });
      } catch {}
    });

    es.addEventListener('snapshot_required', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data ?? '{}');
        onSnapshotRequiredRef.current?.();
        dispatch({ type: 'snapshot_required', payload, ts: Date.now() });
      } catch {}
    });

    for (const t of namedTypes) {
      if (t === 'snapshot_required') continue;
      es.addEventListener(t, (e: MessageEvent) => {
        try {
          const env = JSON.parse(e.data) as CollabEnvelope;
          if (env.senderConnId && env.senderConnId === connIdRef.current) return;
          if (env.type === 'access_revoked') {
            onAccessRevokedRef.current?.();
            es.close();
          }
          dispatch(env);
        } catch {}
      });
    }

    es.addEventListener('error', () => {
      setConnected(false);
      try {
        es.close();
      } catch {}
      esRef.current = null;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, RECONNECT_MS);
    });

    esRef.current = es;
  }, [projectId, activeTeamId, dispatch]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
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
      if (patchDebounce.current) clearTimeout(patchDebounce.current);
      patchDebounce.current = setTimeout(() => {
        fetchWithAuth(`${base}/api/canvas/${projectId}/patch?teamId=${activeTeamId ?? ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch, connId: connIdRef.current }),
        }).catch(() => undefined);
      }, PATCH_DEBOUNCE_MS);
    },
    [projectId, activeTeamId],
  );

  const sendCursor = useCallback(
    (x: number, y: number, viewport?: { zoom?: number; offsetX?: number; offsetY?: number }) => {
      if (!connIdRef.current) return;
      const now = Date.now();
      if (now - cursorLastSent.current < CURSOR_THROTTLE_MS) return;
      cursorLastSent.current = now;
      fetchWithAuth(`${base}/api/canvas/${projectId}/cursor?teamId=${activeTeamId ?? ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y, viewport, connId: connIdRef.current }),
      }).catch(() => undefined);
    },
    [projectId, activeTeamId],
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
