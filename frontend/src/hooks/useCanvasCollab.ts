import { useCallback, useEffect, useRef, useState } from 'react';
import { useTeamStore } from '../stores/teamStore';
import { getAccessToken } from '../services/authTokenStorage';
import { fetchWithAuth } from '../services/authFetch';

const DEBOUNCE_MS = 200;
const CURSOR_THROTTLE_MS = 150;
const RECONNECT_MS = 3000;

const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

export interface CanvasPatch {
  upsertNodes?: unknown[];
  removeNodeIds?: string[];
  upsertEdges?: unknown[];
  removeEdgeIds?: string[];
  presence?: { userId: string; name: string; x: number; y: number };
}

export function useCanvasCollab(
  projectId: string,
  onPatch: (patch: CanvasPatch) => void,
  onAccessRevoked: () => void,
) {
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<Record<string, CanvasPatch['presence']>>({});
  const connIdRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorThrottle = useRef<number>(0);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const token = getAccessToken() ?? '';
    const url = `${base}/api/canvas/${projectId}/stream?teamId=${activeTeamId ?? ''}&token=${token}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'connected') {
        connIdRef.current = data.connId;
        setConnected(true);
        return;
      }
      if (data.type === 'access_revoked') {
        onAccessRevoked();
        es.close();
        return;
      }
      if (data.presence) {
        setPeers((prev) => ({ ...prev, [data.presence.userId]: data.presence }));
      }
      onPatch(data);
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      reconnectTimer.current = setTimeout(connect, RECONNECT_MS);
    };

    esRef.current = es;
  }, [projectId, activeTeamId, onPatch, onAccessRevoked]);

  useEffect(() => {
    if (!projectId || !activeTeamId) return;
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const sendPatch = useCallback(
    (patch: CanvasPatch) => {
      if (!connIdRef.current) return;
      if (patchDebounce.current) clearTimeout(patchDebounce.current);
      patchDebounce.current = setTimeout(() => {
        fetchWithAuth(`${base}/api/canvas/${projectId}/patch?teamId=${activeTeamId ?? ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch, connId: connIdRef.current }),
        });
      }, DEBOUNCE_MS);
    },
    [projectId, activeTeamId],
  );

  const sendCursor = useCallback(
    (x: number, y: number, name: string, userId: string) => {
      const now = Date.now();
      if (now - cursorThrottle.current < CURSOR_THROTTLE_MS) return;
      cursorThrottle.current = now;
      sendPatch({ presence: { userId, name, x, y } });
    },
    [sendPatch],
  );

  return { connected, peers, sendPatch, sendCursor };
}
