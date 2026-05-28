/**
 * Global image-task polling pool.
 *
 * All callers register a taskId and receive a Promise that resolves when the
 * task reaches a terminal state.  A single shared interval fires one batch
 * request (POST /api/ai/tasks/by-ids) for every pending taskId — regardless
 * of how many tasks are in flight — so the browser never opens more than one
 * connection for polling.
 */

import { fetchWithAuth, API_BASE_URL } from "@/services/aiBackendAPI";

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
}

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

const pending = new Map<string, PendingEntry>();
let timerId: ReturnType<typeof setInterval> | null = null;

async function tick() {
  if (pending.size === 0) return;

  const taskIds = [...pending.keys()];
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

  const now = Date.now();
  for (const [taskId, entry] of pending) {
    const r = results[taskId];

    if (r && TERMINAL.has(r.status)) {
      entry.resolve(r);
      pending.delete(taskId);
      continue;
    }

    if (now >= entry.deadlineAt) {
      entry.reject(new Error(`Task ${taskId} timed out`));
      pending.delete(taskId);
    }
  }

  if (pending.size === 0) {
    if (timerId !== null) { clearInterval(timerId); timerId = null; }
  }
}

function ensureRunning() {
  if (timerId === null) {
    timerId = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  }
}

/**
 * Register a taskId and await its completion.
 * Returns the terminal status result, or throws on timeout/network failure.
 */
export function waitForTask(
  taskId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TaskPollResult> {
  const existing = pending.get(taskId);
  if (existing) {
    // already registered — return a new promise that resolves from the same entry
    return new Promise((resolve, reject) => {
      const orig = existing;
      const origResolve = orig.resolve;
      const origReject = orig.reject;
      orig.resolve = (r) => { origResolve(r); resolve(r); };
      orig.reject  = (e) => { origReject(e);  reject(e);  };
    });
  }

  const p = new Promise<TaskPollResult>((resolve, reject) => {
    pending.set(taskId, {
      resolve,
      reject,
      deadlineAt: Date.now() + timeoutMs,
    });
  });

  ensureRunning();
  return p;
}

/** Remove a taskId from the pool (e.g. on component unmount before completion). */
export function cancelTask(taskId: string) {
  pending.delete(taskId);
  if (pending.size === 0 && timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

/** How many tasks are currently being tracked. */
export function pendingCount(): number {
  return pending.size;
}
