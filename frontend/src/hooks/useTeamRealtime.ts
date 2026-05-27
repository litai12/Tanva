import { useEffect, useRef } from 'react';
import { useTeamStore } from '@/stores/teamStore';
import { useAuthStore } from '@/stores/authStore';
import { getAccessToken } from '@/services/authTokenStorage';
import type {
  CollabEnvelope,
  TeamCreditsChangedPayload,
} from '@/collab/types';

const RECONNECT_MS = 3000;

const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000';

/**
 * Opens a long-lived SSE connection to the team realtime stream so the
 * locally-rendered team credits balance stays in sync when another user (or
 * an admin action) mutates the account.
 *
 * Mounted once at app shell level. When `activeTeamId` changes the previous
 * connection is closed and a new one is opened.
 */
export function useTeamRealtime(): void {
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? null;
  const patchTeamCredits = useTeamStore((s) => s.patchTeamCredits);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeTeamId || !userId) return;

    const closeConn = () => {
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {}
        esRef.current = null;
      }
    };

    const connect = () => {
      closeConn();
      const token = getAccessToken() ?? '';
      const url = `${base}/api/team-realtime/teams/${activeTeamId}/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('team_credits_changed', (e: MessageEvent) => {
        try {
          const env = JSON.parse(e.data) as CollabEnvelope<TeamCreditsChangedPayload>;
          const p = env.payload;
          if (!p?.teamId) return;
          patchTeamCredits(p.teamId, p.availableCredits);
          // also notify any other listeners (e.g. ledger panels that want to refetch)
          try {
            window.dispatchEvent(
              new CustomEvent('team-credits-changed', {
                detail: p,
              }),
            );
          } catch {}
        } catch {}
      });

      es.addEventListener('user_credits_changed', () => {
        try {
          window.dispatchEvent(new CustomEvent('refresh-credits'));
        } catch {}
      });

      es.addEventListener('error', () => {
        closeConn();
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(connect, RECONNECT_MS);
      });
    };

    connect();

    return () => {
      closeConn();
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };
  }, [activeTeamId, userId, patchTeamCredits]);
}
