import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasCollabHandle } from './useCanvasCollab';
import type {
  CollabEnvelope,
  ConnectedPayload,
  CursorPayload,
  PresenceUser,
} from '../collab/types';
import { assignUniqueColors, colorFor } from '../collab/presenceColors';

const CURSOR_STALE_MS = 5_000;

export interface PeerCursor extends CursorPayload {
  receivedAt: number;
}

export interface PresenceState {
  online: PresenceUser[];
  cursors: Record<string, PeerCursor>;
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

  // 在线成员与光标的颜色统一去重：以"在线 + 有光标"的全体 userId 为输入做唯一分配，
  // 保证同一 session 内任意两人颜色不重复，且同一 userId 在头像条与光标层用色一致。
  // （服务端不下发 color，事件处理里写入的 colorFor 仅作兜底，这里以去重结果为准。）
  const colorMap = useMemo(() => {
    const ids = new Set<string>();
    for (const u of online) ids.add(u.userId);
    for (const k of Object.keys(cursors)) ids.add(k);
    return assignUniqueColors([...ids]);
  }, [online, cursors]);

  const onlineColored = useMemo(
    () =>
      online.map((u) => ({
        ...u,
        color: colorMap[u.userId] ?? u.color ?? colorFor(u.userId),
      })),
    [online, colorMap],
  );

  const cursorsColored = useMemo(() => {
    const out: Record<string, PeerCursor> = {};
    for (const [k, v] of Object.entries(cursors)) {
      out[k] = { ...v, color: colorMap[k] ?? v.color ?? colorFor(k) };
    }
    return out;
  }, [cursors, colorMap]);

  return { online: onlineColored, cursors: cursorsColored };
}
