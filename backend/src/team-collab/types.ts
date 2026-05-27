export type CollabEventType =
  | 'cursor'
  | 'node_patch'
  | 'node_lock'
  | 'task_status'
  | 'toast'
  | 'presence_join'
  | 'presence_leave'
  | 'access_revoked'
  | 'team_credits_changed'
  | 'user_credits_changed';

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

export interface PresenceUserPayload {
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

export interface AccessRevokedPayload {
  reason?: string;
}

export type TeamCreditsChangeReason =
  | 'reserve'
  | 'deduct'
  | 'release'
  | 'topup'
  | 'admin_adjust'
  | 'subscription_grant';

export interface TeamCreditsChangedPayload {
  teamId: string;
  /** Net change applied (positive for grants/release, negative for reserve/deduct). */
  delta: number;
  /** New available balance = balance - frozenBalance. */
  availableCredits: number;
  /** New raw balance. */
  balance: number;
  /** New frozenBalance. */
  frozenBalance: number;
  reason: TeamCreditsChangeReason;
  actorUserId?: string | null;
  taskId?: string | null;
}

export interface UserCreditsChangedPayload {
  userId: string;
  delta: number;
  balance: number;
  reason: string;
}

export const PERSISTED_EVENT_TYPES: ReadonlySet<CollabEventType> = new Set([
  'node_patch',
  'task_status',
]);

export function isPersistedEvent(type: CollabEventType): boolean {
  return PERSISTED_EVENT_TYPES.has(type);
}
