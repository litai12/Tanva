/**
 * Per-task image-task polling.
 *
 * Every caller registers a taskId and receives a Promise that resolves when the
 * task reaches a terminal state. Each task runs its OWN independent polling loop
 * (GET /api/ai/image-task/:taskId) — one slow or stuck task no longer holds back
 * the others, and there is no shared batch request that all tasks must wait on.
 */

import { fetchWithAuth } from "@/services/authFetch";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL?.trim()
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000") + "/api";

export interface TaskPollResult {
  status: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  textResponse?: string;
  error?: string;
}

interface PendingEntry {
  resolve: (r: TaskPollResult) => void;
  reject: (e: Error) => void;
  deadlineAt: number;
  /** 归属方（通常是画布 nodeId），用于节点删除时按归属批量取消轮询 */
  ownerId?: string;
}

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

const pending = new Map<string, PendingEntry>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Independent polling loop for a single task. Exits when the task reaches a
 * terminal state (resolve), times out (reject), or is cancelled (silent — the
 * entry is gone from `pending`, so we just stop without settling the promise).
 *
 * The loop is bound to the exact `entry` it was started for: every check is an
 * identity comparison against `pending.get(taskId)`, not a mere presence check.
 * If the task is cancelled and then re-registered (a new entry) while a request
 * is still in flight, this stale loop sees a different object and exits without
 * touching the new registration's promise.
 */
async function pollOne(taskId: string, entry: PendingEntry) {
  while (pending.get(taskId) === entry) {
    let result: TaskPollResult | null = null;

    try {
      const res = await fetchWithAuth(
        `${API_BASE_URL}/ai/image-task/${encodeURIComponent(taskId)}`,
        { method: "GET" },
      );
      if (res.ok) {
        result = (await res.json()) as TaskPollResult;
      }
      // !res.ok (e.g. transient 404 while the DB record is still being written,
      // or a 5xx) → leave the entry alive and retry on the next tick.
    } catch {
      // network error — leave the entry alive for the next tick
    }

    // The entry may have been cancelled (or replaced) while we awaited.
    if (pending.get(taskId) !== entry) return;

    if (result && TERMINAL.has(result.status)) {
      pending.delete(taskId);
      entry.resolve(result);
      return;
    }

    if (Date.now() >= entry.deadlineAt) {
      pending.delete(taskId);
      entry.reject(new Error(`Task ${taskId} timed out`));
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Register a taskId and await its completion.
 * Returns the terminal status result, or throws on timeout/network failure.
 */
export function waitForTask(
  taskId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ownerId?: string,
): Promise<TaskPollResult> {
  const existing = pending.get(taskId);
  if (existing) {
    // Already polling — extend the deadline if this caller wants longer, and
    // chain onto the existing promise so every waiter is settled together.
    existing.deadlineAt = Math.max(existing.deadlineAt, Date.now() + timeoutMs);
    if (ownerId) existing.ownerId = ownerId;
    return new Promise((resolve, reject) => {
      const origResolve = existing.resolve;
      const origReject = existing.reject;
      existing.resolve = (r) => { origResolve(r); resolve(r); };
      existing.reject  = (e) => { origReject(e);  reject(e); };
    });
  }

  let entry!: PendingEntry;
  const p = new Promise<TaskPollResult>((resolve, reject) => {
    entry = { resolve, reject, deadlineAt: Date.now() + timeoutMs, ownerId };
    pending.set(taskId, entry);
  });

  void pollOne(taskId, entry);
  return p;
}

/**
 * Remove a taskId from the pool without resolving/rejecting its promise.
 * Its polling loop exits on the next iteration once the entry is gone.
 */
export function cancelTask(taskId: string) {
  pending.delete(taskId);
}

/**
 * Remove every pending task whose ownerId is in the given set — used when the
 * owning canvas nodes are deleted, so their taskIds stop being polled (even for
 * flows like generate4 whose per-slot taskIds are never written back onto
 * node.data). Same silent-removal contract as cancelTask.
 * Returns the number of entries removed.
 */
export function cancelTasksByOwner(ownerIds: Iterable<string>): number {
  const set = ownerIds instanceof Set ? ownerIds : new Set(ownerIds);
  if (set.size === 0) return 0;
  let removed = 0;
  for (const [taskId, entry] of pending) {
    if (entry.ownerId && set.has(entry.ownerId)) {
      pending.delete(taskId);
      removed++;
    }
  }
  return removed;
}

/** How many tasks are currently being tracked. */
export function pendingCount(): number {
  return pending.size;
}
