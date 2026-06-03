type ProjectLoadDebugPayload = Record<string, unknown>;

type ProjectLoadDebugEvent = {
  phase: string;
  at: string;
  totalMs: number;
  deltaMs: number;
  data?: ProjectLoadDebugPayload;
};

type ProjectLoadDebugSession = {
  runId: string;
  startedAt: number;
  lastAt: number;
  events: ProjectLoadDebugEvent[];
};

declare global {
  interface Window {
    __projectLoadEvents?: Record<string, ProjectLoadDebugEvent[]>;
    dumpProjectLoadLog?: (projectId?: string) => ProjectLoadDebugEvent[] | Record<string, ProjectLoadDebugEvent[]>;
  }
}

const MAX_EVENTS_PER_PROJECT = 300;
const DEBUG_FLAG_KEY = "tanva_project_load_debug";
const sessions = new Map<string, ProjectLoadDebugSession>();

export function projectLoadNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function isDebugEnabled(): boolean {
  try {
    if (typeof localStorage !== "undefined") {
      const explicit = localStorage.getItem(DEBUG_FLAG_KEY);
      if (explicit === "0" || explicit === "false") return false;
      if (explicit === "1" || explicit === "true") return true;
    }
  } catch {}

  return Boolean(import.meta.env.DEV);
}

function createRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function ensureSession(projectId: string, reset = false): ProjectLoadDebugSession {
  const now = projectLoadNow();
  const existing = sessions.get(projectId);
  if (existing && !reset) return existing;

  const next: ProjectLoadDebugSession = {
    runId: createRunId(),
    startedAt: now,
    lastAt: now,
    events: [],
  };
  sessions.set(projectId, next);
  return next;
}

function expose(projectId: string, session: ProjectLoadDebugSession) {
  try {
    if (typeof window === "undefined") return;
    window.__projectLoadEvents = window.__projectLoadEvents || {};
    window.__projectLoadEvents[projectId] = session.events;
    window.dumpProjectLoadLog = (targetProjectId?: string) => {
      if (targetProjectId) {
        return window.__projectLoadEvents?.[targetProjectId] || [];
      }
      return window.__projectLoadEvents || {};
    };
  } catch {}
}

function appendEvent(
  projectId: string,
  phase: string,
  data?: ProjectLoadDebugPayload,
  options?: { reset?: boolean }
) {
  if (!projectId) return;

  const session = ensureSession(projectId, options?.reset === true);
  const now = projectLoadNow();
  const event: ProjectLoadDebugEvent = {
    phase,
    at: new Date().toISOString(),
    totalMs: roundMs(now - session.startedAt),
    deltaMs: roundMs(now - session.lastAt),
    data,
  };

  session.lastAt = now;
  session.events.push(event);
  while (session.events.length > MAX_EVENTS_PER_PROJECT) {
    session.events.shift();
  }
  expose(projectId, session);

  if (!isDebugEnabled()) return;
  const payload = {
    projectId,
    runId: session.runId,
    totalMs: event.totalMs,
    deltaMs: event.deltaMs,
    ...(data || {}),
  };
  console.info(
    `[ProjectLoad] ${phase} +${event.deltaMs}ms total=${event.totalMs}ms`,
    payload
  );
}

function errorPayload(error: unknown): ProjectLoadDebugPayload {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }
  return {
    message: String(error),
  };
}

export const projectLoadDebug = {
  start(projectId: string, data?: ProjectLoadDebugPayload) {
    appendEvent(projectId, "project load start", data, { reset: true });
  },

  mark(projectId: string | null | undefined, phase: string, data?: ProjectLoadDebugPayload) {
    if (!projectId) return;
    appendEvent(projectId, phase, data);
  },

  measureSync<T>(
    projectId: string,
    phase: string,
    work: () => T,
    data?: ProjectLoadDebugPayload
  ): T {
    const startedAt = projectLoadNow();
    try {
      const result = work();
      appendEvent(projectId, phase, {
        ...(data || {}),
        durationMs: roundMs(projectLoadNow() - startedAt),
      });
      return result;
    } catch (error) {
      appendEvent(projectId, `${phase} error`, {
        ...(data || {}),
        durationMs: roundMs(projectLoadNow() - startedAt),
        ...errorPayload(error),
      });
      throw error;
    }
  },

  async measure<T>(
    projectId: string,
    phase: string,
    work: () => Promise<T>,
    data?: ProjectLoadDebugPayload
  ): Promise<T> {
    const startedAt = projectLoadNow();
    try {
      const result = await work();
      appendEvent(projectId, phase, {
        ...(data || {}),
        durationMs: roundMs(projectLoadNow() - startedAt),
      });
      return result;
    } catch (error) {
      appendEvent(projectId, `${phase} error`, {
        ...(data || {}),
        durationMs: roundMs(projectLoadNow() - startedAt),
        ...errorPayload(error),
      });
      throw error;
    }
  },

  end(projectId: string | null | undefined, data?: ProjectLoadDebugPayload) {
    if (!projectId) return;
    appendEvent(projectId, "project load manager ready", data);
  },

  get(projectId: string): ProjectLoadDebugEvent[] {
    return sessions.get(projectId)?.events || [];
  },
};

export function waitForProjectLoadPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      globalThis.setTimeout(resolve, 0);
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function waitForProjectLoadIdle(timeoutMs = 1400, fallbackMs = 420): Promise<void> {
  return new Promise((resolve) => {
    const requestIdle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout?: number }
      ) => number;
    }).requestIdleCallback;

    if (typeof requestIdle === "function") {
      requestIdle(() => resolve(), { timeout: timeoutMs });
      return;
    }

    globalThis.setTimeout(resolve, fallbackMs);
  });
}

export async function waitForProjectLoadInteractive(): Promise<void> {
  await waitForProjectLoadIdle();
  await waitForProjectLoadPaint();
}
