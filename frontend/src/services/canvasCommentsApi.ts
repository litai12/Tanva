import { fetchWithAuth } from './authFetch';

const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      msg = d?.message || d?.error || msg;
    } catch {}
    throw new Error(msg);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as unknown as T);
}

export interface CommentAuthor {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface CanvasComment {
  id: string;
  threadId: string;
  author: CommentAuthor;
  body: string;
  mentions: string[];
  imageUrls: string[];
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasCommentThread {
  id: string;
  nodeId: string | null;
  /** 画布坐标（flow 坐标系）。自由落点评论用此锚定。 */
  x: number | null;
  y: number | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: CommentAuthor | null;
  createdById: string;
  createdAt: string;
  comments: CanvasComment[];
}

const q = (teamId?: string | null) => (teamId ? `?teamId=${encodeURIComponent(teamId)}` : '');

export const canvasCommentsApi = {
  list: (projectId: string, teamId?: string | null, includeResolved = false) =>
    fetchWithAuth(
      `${base}/api/canvas/${projectId}/comments${q(teamId)}${
        includeResolved ? `${teamId ? '&' : '?'}includeResolved=true` : ''
      }`,
    ).then((r) => json<CanvasCommentThread[]>(r)),

  createThread: (
    projectId: string,
    payload: {
      x?: number;
      y?: number;
      nodeId?: string;
      body: string;
      mentions?: string[];
      imageUrls?: string[];
      connId?: string | null;
    },
    teamId?: string | null,
  ) =>
    fetchWithAuth(`${base}/api/canvas/${projectId}/comments${q(teamId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => json<CanvasCommentThread>(r)),

  reply: (
    projectId: string,
    threadId: string,
    payload: { body: string; mentions?: string[]; imageUrls?: string[]; connId?: string | null },
    teamId?: string | null,
  ) =>
    fetchWithAuth(`${base}/api/canvas/${projectId}/comments/${threadId}/replies${q(teamId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => json<CanvasComment>(r)),

  edit: (
    projectId: string,
    commentId: string,
    payload: { body: string; mentions?: string[]; imageUrls?: string[]; connId?: string | null },
    teamId?: string | null,
  ) =>
    fetchWithAuth(`${base}/api/canvas/${projectId}/comments/${commentId}${q(teamId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => json<CanvasComment>(r)),

  resolve: (
    projectId: string,
    threadId: string,
    resolved: boolean,
    teamId?: string | null,
    connId?: string | null,
  ) =>
    fetchWithAuth(`${base}/api/canvas/${projectId}/comments/${threadId}/resolve${q(teamId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved, connId }),
    }).then((r) => json<CanvasCommentThread>(r)),

  move: (
    projectId: string,
    threadId: string,
    x: number,
    y: number,
    teamId?: string | null,
    connId?: string | null,
  ) =>
    fetchWithAuth(`${base}/api/canvas/${projectId}/comments/${threadId}/position${q(teamId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, connId }),
    }).then((r) => json<CanvasCommentThread>(r)),

  remove: (projectId: string, commentId: string, teamId?: string | null, connId?: string | null) =>
    fetchWithAuth(
      `${base}/api/canvas/${projectId}/comments/${commentId}${q(teamId)}${
        connId ? `${teamId ? '&' : '?'}connId=${encodeURIComponent(connId)}` : ''
      }`,
      { method: 'DELETE' },
    ).then((r) => json<{ deleted: true }>(r)),
};
