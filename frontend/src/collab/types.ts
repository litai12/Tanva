export type CollabEventType =
  | 'cursor'
  | 'node_patch'
  | 'node_lock'
  | 'task_status'
  | 'toast'
  | 'presence_join'
  | 'presence_leave'
  | 'access_revoked'
  | 'connected'
  | 'snapshot_required';

export interface CollabEnvelope<T = unknown> {
  type: CollabEventType;
  payload: T;
  ts: number;
  senderConnId?: string;
  senderUserId?: string;
  seq?: number;
}

export interface CursorPayload {
  userId: string;
  name: string;
  color?: string;
  x: number;
  y: number;
  viewport?: { zoom?: number; offsetX?: number; offsetY?: number };
}

export interface PresenceUser {
  userId: string;
  name: string;
  color?: string;
}

export interface NodePatchPayload {
  upsertNodes?: unknown[];
  removeNodeIds?: string[];
  upsertEdges?: unknown[];
  removeEdgeIds?: string[];
}

export type NodeLockAction = 'claim' | 'release' | 'expired' | 'renewed';

export interface NodeLockPayload {
  nodeId: string;
  action: NodeLockAction;
  userId: string;
  expiresAt: number;
}

export type TaskBroadcastStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export interface TaskStatusPayload {
  taskId: string;
  nodeId?: string | null;
  taskType: string;
  category: 'image' | 'video';
  status: TaskBroadcastStatus;
  progress?: number;
  resultPreview?: { url?: string; thumbnailUrl?: string } | null;
  error?: string | null;
}

export type ToastKind = 'upload' | 'generate' | 'delete' | 'share' | 'info';

export interface ToastPayload {
  userId: string;
  name: string;
  kind: ToastKind;
  text: string;
}

export interface ConnectedPayload {
  connId: string;
  presence: PresenceUser[];
  degraded?: boolean;
}

export type CollabListener = (envelope: CollabEnvelope) => void;
