import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasCollabHandle } from './useCanvasCollab';
import type { CollabEnvelope, NodeLockPayload } from '../collab/types';

const RENEW_INTERVAL_MS = 5_000;

export interface RemoteLockInfo {
  userId: string;
  expiresAt: number;
}

export interface NodeLockState {
  /** Locks held by other users (nodeId → lock info). */
  remoteLocks: Record<string, RemoteLockInfo>;
  /** Nodes currently locked by the local user. */
  ownedLocks: Set<string>;
  /** Try to claim a node. Returns true on success. */
  claim: (nodeId: string) => Promise<boolean>;
  /** Release a node lock the local user owns. */
  release: (nodeId: string) => Promise<void>;
  /** Whether the lock is owned by the local user. */
  isOwn: (nodeId: string) => boolean;
  /** Whether the lock is held by someone else. */
  isLockedByOther: (nodeId: string) => boolean;
}

/**
 * Manages node locks: tracks remote claims, runs renewal heartbeats for
 * locally-owned locks, and clears state on release/expiry.
 */
export function useNodeLock(collab: CanvasCollabHandle, currentUserId: string | null): NodeLockState {
  const [remoteLocks, setRemoteLocks] = useState<Record<string, RemoteLockInfo>>({});
  const [ownedLocks, setOwnedLocks] = useState<Set<string>>(new Set());
  const ownedRef = useRef<Set<string>>(new Set());
  const renewTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const off = collab.subscribe('node_lock', (env: CollabEnvelope) => {
      const p = env.payload as NodeLockPayload;
      if (currentUserId && p.userId === currentUserId) {
        // skip: own lock events are handled by claim/release responses
        return;
      }
      setRemoteLocks((prev) => {
        const next = { ...prev };
        if (p.action === 'claim' || p.action === 'renewed') {
          next[p.nodeId] = { userId: p.userId, expiresAt: p.expiresAt };
        } else if (p.action === 'release' || p.action === 'expired') {
          delete next[p.nodeId];
        }
        return next;
      });
    });

    return off;
  }, [collab, currentUserId]);

  // Periodic renewal for owned locks
  useEffect(() => {
    renewTimer.current = setInterval(async () => {
      const nodes = [...ownedRef.current];
      for (const nodeId of nodes) {
        try {
          const result = await collab.renewLock(nodeId);
          if (!result.acquired) {
            ownedRef.current.delete(nodeId);
            setOwnedLocks(new Set(ownedRef.current));
          }
        } catch {}
      }
    }, RENEW_INTERVAL_MS);
    return () => {
      if (renewTimer.current) clearInterval(renewTimer.current);
      renewTimer.current = null;
    };
  }, [collab]);

  // Sweep expired remote locks based on client clock
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setRemoteLocks((prev) => {
        let mutated = false;
        const next: Record<string, RemoteLockInfo> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiresAt && v.expiresAt < now) {
            mutated = true;
          } else {
            next[k] = v;
          }
        }
        return mutated ? next : prev;
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const claim = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const result = await collab.claimLock(nodeId);
      if (result.acquired) {
        ownedRef.current.add(nodeId);
        setOwnedLocks(new Set(ownedRef.current));
        return true;
      }
      return false;
    },
    [collab],
  );

  const release = useCallback(
    async (nodeId: string) => {
      await collab.releaseLock(nodeId);
      ownedRef.current.delete(nodeId);
      setOwnedLocks(new Set(ownedRef.current));
    },
    [collab],
  );

  const isOwn = useCallback((nodeId: string) => ownedLocks.has(nodeId), [ownedLocks]);
  const isLockedByOther = useCallback(
    (nodeId: string) => Boolean(remoteLocks[nodeId]),
    [remoteLocks],
  );

  return { remoteLocks, ownedLocks, claim, release, isOwn, isLockedByOther };
}
