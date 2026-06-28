export type CollabEventType =
  | 'cursor'
  | 'node_patch'
  | 'canvas_patch'
  | 'node_lock'
  | 'task_status'
  | 'toast'
  | 'presence_join'
  | 'presence_leave'
  | 'access_revoked'
  | 'connected'
  | 'snapshot_required'
  | 'comment_changed'
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
  // 画布世界坐标（Paper project 坐标），与各端的平移/缩放/窗口无关。
  // 接收端用本地视口把它投影回自己的屏幕坐标，从而做到跨视窗对齐。
  x: number;
  y: number;
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

/** 画布图片对象协作 patch：移动/缩放/插入=upsertImages(含 imageId+bounds[+快照]); 删除=removeImageIds。 */
export interface CanvasImagePatchPayload {
  upsertImages?: Array<Record<string, unknown>>;
  removeImageIds?: string[];
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

export type TeamCreditsChangeReason =
  | 'reserve'
  | 'deduct'
  | 'release'
  | 'topup'
  | 'admin_adjust'
  | 'subscription_grant';

export interface TeamCreditsChangedPayload {
  teamId: string;
  delta: number;
  balance: number;
  frozenBalance: number;
  availableCredits: number;
  reason: TeamCreditsChangeReason;
  actorUserId?: string | null;
  taskId?: string | null;
}

export type CommentChangeAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'resolved'
  | 'reopened';

/** 评论变更失效通知：只说明「某节点评论变了」，收到后 debounce refetch，不做增量合并。 */
export interface CommentChangedPayload {
  action: CommentChangeAction;
  nodeId: string;
  threadId: string;
  commentId?: string;
}

export type CollabListener = (envelope: CollabEnvelope) => void;
