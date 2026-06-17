import { useEffect, useRef, useState } from 'react';
import type { CanvasCollabHandle } from './useCanvasCollab';
import type {
  CollabEnvelope,
  ConnectedPayload,
  CursorPayload,
  PresenceUser,
} from '../collab/types';

const CURSOR_STALE_MS = 5_000;

export interface PeerCursor extends CursorPayload {
  receivedAt: number;
}

export interface PresenceState {
  online: PresenceUser[];
  cursors: Record<string, PeerCursor>;
}

const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
];

function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/**
 * Subscribes to presence events and cursor frames. Returns the live set of
 * online users and a map of their latest cursor positions.
 */
export function usePresence(collab: CanvasCollabHandle | null | undefined): PresenceState {
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [cursors, setCursors] = useState<Record<string, PeerCursor>>({});
  const sweepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!collab) return;
    const offConnected = collab.subscribe('connected', (env: CollabEnvelope) => {
      const payload = env.payload as ConnectedPayload;
      setOnline(
        (payload.presence ?? []).map((p) => ({
          ...p,
          color: p.color ?? colorFor(p.userId),
        })),
      );
    });

    const offJoin = collab.subscribe('presence_join', (env: CollabEnvelope) => {
      const p = env.payload as PresenceUser;
      setOnline((prev) => {
        if (prev.some((x) => x.userId === p.userId)) return prev;
        return [...prev, { ...p, color: p.color ?? colorFor(p.userId) }];
      });
    });

    const offLeave = collab.subscribe('presence_leave', (env: CollabEnvelope) => {
      const p = env.payload as PresenceUser;
      setOnline((prev) => prev.filter((x) => x.userId !== p.userId));
      setCursors((prev) => {
        if (!(p.userId in prev)) return prev;
        const next = { ...prev };
        delete next[p.userId];
        return next;
      });
    });

    const offCursor = collab.subscribe('cursor', (env: CollabEnvelope) => {
      const c = env.payload as CursorPayload;
      setCursors((prev) => ({
        ...prev,
        [c.userId]: {
          ...c,
          color: c.color ?? colorFor(c.userId),
          receivedAt: Date.now(),
        },
      }));
    });

    sweepTimer.current = setInterval(() => {
      const now = Date.now();
      setCursors((prev) => {
        let mutated = false;
        const next: Record<string, PeerCursor> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.receivedAt > CURSOR_STALE_MS) {
            mutated = true;
          } else {
            next[k] = v;
          }
        }
        return mutated ? next : prev;
      });
    }, 2000);

    return () => {
      offConnected();
      offJoin();
      offLeave();
      offCursor();
      if (sweepTimer.current) {
        clearInterval(sweepTimer.current);
        sweepTimer.current = null;
      }
    };
  }, [collab]);

  return { online, cursors };
}
