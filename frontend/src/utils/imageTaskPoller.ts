/**
 * Global image-task polling pool.
 *
 * All callers register a taskId and receive a Promise that resolves when the
 * task reaches a terminal state.  A single shared interval fires one batch
 * request (POST /api/ai/tasks/by-ids) for every pending taskId — regardless
 * of how many tasks are in flight — so the browser never opens more than one
 * connection for polling.
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
let loopRunning = false;

// TEMP DEBUG (remove after diagnosing duplicate-poll): ids we've already resolved
// as terminal. If one is ever re-sent in a later tick, something re-registered it.
const _debugTerminal = new Set<string>();

async function tick() {
  if (pending.size === 0) return;

  const taskIds = [...pending.keys()];

  // TEMP DEBUG
  const _reSent = taskIds.filter((id) => _debugTerminal.has(id));
  if (_reSent.length) {
    console.warn("[poller] re-sent already-terminal taskIds:", _reSent);
  }
  console.debug("[poller] tick → taskIds:", taskIds);

  let results: Record<string, TaskPollResult | null> = {};

  try {
    const res = await fetchWithAuth(`${API_BASE_URL}/ai/tasks/by-ids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds }),
    });
    if (res.ok) {
      results = (await res.json()) as Record<string, TaskPollResult | null>;
    }
  } catch {
    // network error — leave all entries alive for the next tick
  }

  // TEMP DEBUG
  console.debug(
    "[poller] tick ← statuses:",
    Object.fromEntries(
      taskIds.map((id): [string, string] => [id, results[id]?.status ?? "(absent)"]),
    ),
  );

  const now = Date.now();
  for (const [taskId, entry] of pending) {
    const r = results[taskId];

    if (r && TERMINAL.has(r.status)) {
      _debugTerminal.add(taskId); // TEMP DEBUG
      entry.resolve(r);
      pending.delete(taskId);
      continue;
    }

    if (now >= entry.deadlineAt) {
      entry.reject(new Error(`Task ${taskId} timed out`));
      pending.delete(taskId);
    }
  }
}

/** Sequential loop: wait for response, then wait interval, then repeat. */
async function runLoop() {
  loopRunning = true;
  while (pending.size > 0) {
    await tick();
    if (pending.size > 0) {
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  loopRunning = false;
}

function ensureRunning() {
  if (!loopRunning) {
    void runLoop();
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
  // TEMP DEBUG (remove after diagnosing duplicate-poll): catch re-registration
  // of an already-completed task, with a stack trace pointing at the caller.
  if (_debugTerminal.has(taskId)) {
    console.warn(
      `[poller] waitForTask re-registers already-terminal task ${taskId} (owner=${ownerId})`,
      new Error("re-register stack").stack,
    );
  }
  const existing = pending.get(taskId);
  if (existing) {
    // Extend deadline if this caller wants to wait longer
    existing.deadlineAt = Math.max(existing.deadlineAt, Date.now() + timeoutMs);
    if (ownerId) existing.ownerId = ownerId;
    return new Promise((resolve, reject) => {
      const origResolve = existing.resolve;
      const origReject = existing.reject;
      existing.resolve = (r) => { origResolve(r); resolve(r); };
      existing.reject  = (e) => { origReject(e);  reject(e); };
    });
  }

  const p = new Promise<TaskPollResult>((resolve, reject) => {
    pending.set(taskId, {
      resolve,
      reject,
      deadlineAt: Date.now() + timeoutMs,
      ownerId,
    });
  });

  ensureRunning();
  return p;
}

/**
 * Remove a taskId from the pool without resolving/rejecting its promise.
 * The sequential loop exits on its own once `pending` is empty.
 */
export function cancelTask(taskId: string) {
  pending.delete(taskId);
}

/**
 * Remove every pending task whose ownerId is in the given set — used when the
 * owning canvas nodes are deleted, so their taskIds stop participating in the
 * shared by-ids poll (even for flows like generate4 whose per-slot taskIds are
 * never written back onto node.data). Same silent-removal contract as cancelTask.
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
