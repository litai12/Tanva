import { getAccessToken } from './authTokenStorage';

type Listener = (env: any) => void;

const httpBase =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000';
const wsBase = httpBase.replace(/^http/i, 'ws'); // http->ws, https->wss

const MAX_BACKOFF_MS = 30_000;

let ws: WebSocket | null = null;
let generation = 0; // 每次 (重)连接自增，用于丢弃过期 socket 的回调
let teamId: string | null = null;
let projectId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 1_000;
let connId: string | null = null;
let resumeSeq = 0; // 当前 project 已处理的最后 seq；重连时带上以补帧
const listeners = new Set<Listener>();

function buildUrl(): string | null {
  const token = getAccessToken() ?? '';
  if (!token || (!teamId && !projectId)) return null;
  const params = new URLSearchParams({ token });
  if (teamId) params.set('teamId', teamId);
  if (projectId) params.set('projectId', projectId);
  if (resumeSeq > 0) params.set('after', String(resumeSeq));
  return `${wsBase}/ws/collab?${params.toString()}`;
}

function closeSocket(): void {
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    } catch {}
    ws = null;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = backoff;
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect(): void {
  // 清掉可能在途的重连定时器，避免它稍后用旧上下文覆盖这次显式连接
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const url = buildUrl();
  closeSocket();
  if (!url) return; // 缺 token/teamId，不连
  const gen = ++generation;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    if (gen !== generation) {
      try { sock.close(); } catch {}
      return;
    }
    backoff = 1_000;
  };
  sock.onmessage = (e) => {
    if (gen !== generation) return;
    let env: any;
    try {
      env = JSON.parse(e.data);
    } catch {
      return;
    }
    if (env?.type === 'connected') connId = env.payload?.connId ?? null;
    for (const l of listeners) {
      try {
        l(env);
      } catch {}
    }
  };
  sock.onclose = () => {
    if (gen !== generation) return;
    scheduleReconnect();
  };
  sock.onerror = () => {
    try { sock.close(); } catch {}
  };
}

export const realtimeClient = {
  /** 设置连接上下文；teamId/projectId 变化会用新参数重连（始终只保持一条连接）。 */
  setContext(next: { teamId?: string | null; projectId?: string | null }): void {
    let changed = false;
    if (next.teamId !== undefined && next.teamId !== teamId) {
      teamId = next.teamId;
      changed = true;
    }
    if (next.projectId !== undefined && next.projectId !== projectId) {
      projectId = next.projectId;
      resumeSeq = 0; // 切换项目：清空补帧游标，避免回放上一个项目的事件
      changed = true;
    }
    if (changed) connect();
  },
  refresh(): void {
    connect();
  },
  /** 记录已处理的最后 seq，供断线重连补帧（仅向前推进）。 */
  noteSeq(seq: number): void {
    if (typeof seq === 'number' && seq > resumeSeq) resumeSeq = seq;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  send(env: unknown): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(env));
      } catch {}
    }
  },
  getConnId(): string | null {
    return connId;
  },
  stop(): void {
    generation += 1;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    closeSocket();
  },
};
