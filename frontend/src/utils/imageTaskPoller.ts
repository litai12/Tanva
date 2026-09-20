/**
 * Per-task image-task polling.
 *
 * Every caller registers a taskId and receives a Promise that resolves when the
 * task reaches a terminal state. Each task runs its OWN independent polling loop
 * (GET /api/ai/image-task/:taskId) — one slow or stuck task no longer holds back
 * the others, and there is no shared batch request that all tasks must wait on.
 *
 * 观察超过 15 分钟后降低轮询频率；只有服务端明确终态才结束等待。
 * 排队超时只尝试取消，必须取得取消成功的确认，不能推定任务未执行。
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
  /** 生成阶段（processing）时限；首次观察到 processing 时据此设置 processingDeadlineAt */
  processingTimeoutMs: number;
  /** null = 尚未进入 processing，不计时 */
  processingDeadlineAt: number | null;
  /** 排队安全上限（防僵尸轮询；正常排队由用户主动取消，不自动放弃） */
  queuedDeadlineAt: number;
  /** 连续 404 计数——任务既不在 DB 也不在队列，说明已丢失 */
  notFoundStreak: number;
  lastStatus?: string;
  /** 归属方（通常是画布 nodeId），用于节点删除时按归属批量取消轮询 */
  ownerId?: string;
}

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const QUEUED_SAFETY_TIMEOUT_MS = 30 * 60 * 1000;
const NOT_FOUND_STREAK_LIMIT = 3;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

const pending = new Map<string, PendingEntry>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 状态变化时广播给 UI（如画布节点显示「排队中/生成中」）。终态也会广播，便于清理指示。 */
function emitPhase(taskId: string, entry: PendingEntry, status: string) {
  if (entry.lastStatus === status) return;
  entry.lastStatus = status;
  try {
    window.dispatchEvent(
      new CustomEvent("image-task:phase", {
        detail: { taskId, ownerId: entry.ownerId, status },
      }),
    );
  } catch {
    // SSR/异常环境下静默
  }
}

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
    let notFound = false;

    try {
      const res = await fetchWithAuth(
        `${API_BASE_URL}/ai/image-task/${encodeURIComponent(taskId)}`,
        { method: "GET" },
      );
      if (res.ok) {
        result = (await res.json()) as TaskPollResult;
      } else if (res.status === 404) {
        // 后端仅在「无 DB 行且不在队列」时返回 404 —— 连续出现说明任务已丢失
        notFound = true;
      }
      // 其余 !res.ok（5xx 等）→ leave the entry alive and retry on the next tick.
    } catch {
      // network error — leave the entry alive for the next tick
    }

    // The entry may have been cancelled (or replaced) while we awaited.
    if (pending.get(taskId) !== entry) return;

    if (notFound) {
      entry.notFoundStreak += 1;
      if (entry.notFoundStreak >= NOT_FOUND_STREAK_LIMIT) {
        pending.delete(taskId);
        entry.reject(new Error(`Task ${taskId} not found`));
        return;
      }
    } else if (result) {
      entry.notFoundStreak = 0;
    }

    if (result && TERMINAL.has(result.status)) {
      pending.delete(taskId);
      emitPhase(taskId, entry, result.status);
      entry.resolve(result);
      return;
    }

    if (result) {
      // 首次进入 processing：从此刻起算生成时限（排队等待不计入）
      if (result.status === "processing" && entry.processingDeadlineAt == null) {
        entry.processingDeadlineAt = Date.now() + entry.processingTimeoutMs;
      }
      emitPhase(taskId, entry, result.status);
    }

    const now = Date.now();
    // Browser deadlines are observation limits, never proof of upstream failure.
    // Only stop a queued job after the server confirms cancellation.
    if (entry.processingDeadlineAt == null && now >= entry.queuedDeadlineAt && result?.status === "queued") {
      try {
        const response = await fetchWithAuth(
          `${API_BASE_URL}/ai/image-task/${encodeURIComponent(taskId)}/cancel`,
          { method: "POST" },
        );
        const cancelled = response.ok ? await response.json() : null;
        if (pending.get(taskId) !== entry) return;
        if (cancelled?.cancelled) {
          pending.delete(taskId);
          emitPhase(taskId, entry, "cancelled");
          entry.resolve({ status: "cancelled", error: "排队任务已取消，未扣除积分" });
          return;
        }
      } catch { /* Unknown cancellation result: retain task and query again. */ }
      entry.queuedDeadlineAt = Date.now() + QUEUED_SAFETY_TIMEOUT_MS;
    }
    if (entry.processingDeadlineAt != null && now >= entry.processingDeadlineAt) {
      await sleep(30_000);
      continue;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Register a taskId and await its completion.
 * Returns only a server-confirmed terminal status; deadlines only slow polling.
 * `timeoutMs` 约束的是 processing（生成）阶段，而非从注册起的总时长。
 */
export function waitForTask(
  taskId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ownerId?: string,
): Promise<TaskPollResult> {
  const existing = pending.get(taskId);
  if (existing) {
    // Already polling — extend deadlines if this caller wants longer, and
    // chain onto the existing promise so every waiter is settled together.
    existing.processingTimeoutMs = Math.max(existing.processingTimeoutMs, timeoutMs);
    if (existing.processingDeadlineAt != null) {
      existing.processingDeadlineAt = Math.max(
        existing.processingDeadlineAt,
        Date.now() + timeoutMs,
      );
    }
    existing.queuedDeadlineAt = Math.max(
      existing.queuedDeadlineAt,
      Date.now() + QUEUED_SAFETY_TIMEOUT_MS,
    );
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
    entry = {
      resolve,
      reject,
      processingTimeoutMs: timeoutMs,
      processingDeadlineAt: null,
      queuedDeadlineAt: Date.now() + QUEUED_SAFETY_TIMEOUT_MS,
      notFoundStreak: 0,
      ownerId,
    };
    pending.set(taskId, entry);
  });

  void pollOne(taskId, entry);
  return p;
}

/**
 * 把轮询器的拒绝原因翻译成用户可读的中文文案。
 * 所有展示 waitForTask/pollImageTaskResult 错误的地方都应经过它，避免把
 * `Task <id> timed out` 这类原始英文直接怼到界面上。
 */
export function describeTaskPollError(e: unknown, fallback = "任务失败"): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (msg.includes("queue wait timed out")) {
    return "排队等待超时，任务未开始，未扣除积分，请稍后重试。";
  }
  if (msg.includes("timed out")) {
    return "生成结果尚未确认，请查看原任务，勿重复提交。";
  }
  if (msg.includes("not found")) {
    return "任务已失效，请重新生成。";
  }
  return msg || fallback;
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

/**
 * 反查某归属方（节点）当前在轮询的所有 taskId——用于停止按钮向后端发起排队取消
 * （generate4 等多任务流程不会把 taskId 写回 node.data，只有这里有全量记录）。
 */
export function getTaskIdsByOwner(ownerId: string): string[] {
  const ids: string[] = [];
  for (const [taskId, entry] of pending) {
    if (entry.ownerId === ownerId) ids.push(taskId);
  }
  return ids;
}

/** How many tasks are currently being tracked. */
export function pendingCount(): number {
  return pending.size;
}
