/**
 * Central polling manager — replaces scattered setInterval calls in async
 * generation flows.  Keyed by an arbitrary string (typically a message ID).
 * When the same key is started again the previous interval is cleared first,
 * so double-registration is safe.
 */

type TimerId = ReturnType<typeof setInterval>;

const activePolls = new Map<string, TimerId>();

function start(key: string, fn: () => void, intervalMs: number): void {
  stop(key);
  const id = setInterval(fn, intervalMs);
  activePolls.set(key, id);
}

function stop(key: string): void {
  const id = activePolls.get(key);
  if (id !== undefined) {
    clearInterval(id);
    activePolls.delete(key);
  }
}

function stopAll(): void {
  activePolls.forEach((id) => clearInterval(id));
  activePolls.clear();
}

export const pollingManager = { start, stop, stopAll };
