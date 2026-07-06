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
  | 'comment_changed'
  | 'team_projects_changed'
  | 'comment_marker_move'
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
  avatarUrl?: string | null;
  color?: string;
  x: number;
  y: number;
  viewport?: { zoom?: number; offsetX?: number; offsetY?: number };
}

export interface PresenceUserPayload {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  color?: string;
}

export interface NodePatchPayload {
  upsertNodes?: unknown[];
  removeNodeIds?: string[];
  upsertEdges?: unknown[];
  removeEdgeIds?: string[];
}

/**
 * 画布(Paper.js)图片对象的协作 patch。仅同步「图片」对象(有稳定 imageId 的 Raster/Group)：
 * 移动/缩放=upsertImages 携带 {imageId, bounds, ...}; 插入=携带完整快照; 删除=removeImageIds。
 * 笔迹/涂鸦不走此通道(无逐笔 id, 走保存+广播, 且本在规格"不做"列表)。
 */
export interface CanvasPatchPayload {
  upsertImages?: unknown[];
  removeImageIds?: string[];
  upsertPaths?: unknown[];
  removePathIds?: string[];
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
  avatarUrl?: string | null;
  kind: ToastKind;
  text: string;
}

export interface AccessRevokedPayload {
  reason?: string;
}

export type CommentChangeAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'resolved'
  | 'reopened'
  | 'moved';

/**
 * 评论变更失效通知（invalidate 风格）：评论本身已落 PostgreSQL，此事件只通知其他在线
 * 成员「该节点的评论变了，去重新拉取」，不携带完整线程树，避免乱序/软删占位/作者信息不全。
 * 发起者本端不依赖此事件刷新——mutation 成功后直接更新本地 store（个人模式无 WS 时也能即时显示）。
 */
export interface CommentChangedPayload {
  action: CommentChangeAction;
  nodeId?: string | null;
  threadId: string;
  commentId?: string;
}

export type TeamProjectsChangeAction =
  | 'created'
  | 'deleted'
  | 'renamed'
  | 'shared'
  | 'unshared';

/**
 * 团队项目列表变更失效通知（invalidate 风格，对齐 comment_changed）：项目本身已落库，
 * 此事件只通知该团队的其他在线成员「团队项目列表变了，去重新拉取」，不携带完整列表，
 * 避免乱序/权限差异。发起者本端 mutation 成功后已直接更新本地 store，不依赖此事件。
 */
export interface TeamProjectsChangedPayload {
  teamId: string;
  action: TeamProjectsChangeAction;
  projectId: string;
  actorUserId?: string | null;
}

export interface CommentMarkerMovePayload {
  threadId: string;
  x: number;
  y: number;
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
  'canvas_patch',
  'task_status',
]);

export function isPersistedEvent(type: CollabEventType): boolean {
  return PERSISTED_EVENT_TYPES.has(type);
}
