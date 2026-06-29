import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, MoreHorizontal, Reply, RotateCcw, Trash2, X } from 'lucide-react';
import type { CanvasComment, CanvasCommentThread } from '@/services/canvasCommentsApi';
import type { MentionCandidate, ReplyInput } from '@/contexts/CanvasCommentsContext';
import { getDefaultAvatarColor, getDefaultAvatarInitial } from '@/utils/defaultAvatar';
import CommentComposer, { type ComposerHandle } from './CommentComposer';

interface Props {
  thread: CanvasCommentThread;
  currentUserId: string | null;
  members: MentionCandidate[];
  onReply: (threadId: string, input: ReplyInput) => Promise<unknown>;
  onEdit: (commentId: string, input: ReplyInput) => Promise<unknown>;
  onRemove: (commentId: string) => Promise<unknown>;
  onDeleteThread: (threadId: string) => Promise<unknown>;
  onResolve: (threadId: string, resolved: boolean) => Promise<unknown>;
  onClose: () => void;
}

export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString();
}

export function initials(name: string | null): string {
  const n = (name ?? '').trim();
  return n ? n.slice(0, 1).toUpperCase() : '?';
}

/** 高亮正文中的 @提及（纯文本渲染，无 HTML 注入）。 */
export function renderBody(body: string): React.ReactNode {
  return body.split(/(@[^\s@]+)/g).map((p, i) =>
    p.startsWith('@') ? (
      <span key={i} style={{ color: '#2563eb', fontWeight: 600 }}>
        {p}
      </span>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    ),
  );
}

export const Avatar: React.FC<{ name: string | null; url: string | null; size?: number }> = ({
  name,
  url,
  size = 24,
}) => {
  const fallback = getDefaultAvatarColor(name);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: url ? `center/cover no-repeat url(${url})` : fallback.bg,
        color: fallback.text,
        fontSize: size * 0.45,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
      }}
    >
      {!url && getDefaultAvatarInitial(name)}
    </div>
  );
};

export const CommentImages: React.FC<{ urls: string[] }> = ({ urls }) =>
  urls.length === 0 ? null : (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          <div
            style={{
              width: 138,
              height: 136,
              borderRadius: 6,
              background: `center/cover no-repeat url(${u})`,
              border: 'none',
            }}
          />
        </a>
      ))}
    </div>
  );

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 14px',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 13,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const CommentRow: React.FC<{
  comment: CanvasComment;
  currentUserId: string | null;
  members: MentionCandidate[];
  menuOpen: boolean;
  onToggleMenu: (open: boolean) => void;
  onReplyTo: (author: MentionCandidate) => void;
  onEdit: (commentId: string, input: ReplyInput) => Promise<unknown>;
  onRemove: (commentId: string) => Promise<unknown>;
}> = ({ comment, currentUserId, members, menuOpen, onToggleMenu, onReplyTo, onEdit, onRemove }) => {
  const [editing, setEditing] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const mine = currentUserId != null && comment.author.id === currentUserId;

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 4, left: r.right - 96 });
  }, [menuOpen]);

  return (
    <div style={{ display: 'flex', gap: 8, padding: '7px 0' }}>
      <Avatar name={comment.author.name} url={comment.author.avatarUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {comment.author.name ?? comment.author.id.slice(0, 8)}
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{relTime(comment.createdAt)}</span>
          {!comment.deleted && (
            <div style={{ marginLeft: 'auto' }}>
              <button
                ref={btnRef}
                data-comment-ui
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMenu(!menuOpen);
                }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}
              >
                <MoreHorizontal size={15} />
              </button>
              {menuOpen &&
                menuPos &&
                createPortal(
                  <div
                    data-comment-ui
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'fixed',
                      top: menuPos.top,
                      left: menuPos.left,
                      background: 'white',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
                      zIndex: 10000,
                      minWidth: 96,
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      onClick={() => {
                        onToggleMenu(false);
                        onReplyTo({
                          id: comment.author.id,
                          name: comment.author.name,
                          avatarUrl: comment.author.avatarUrl,
                        });
                      }}
                      style={{ ...menuItemStyle, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <Reply size={13} /> 回复
                    </button>
                    {mine && (
                      <>
                        <button onClick={() => { onToggleMenu(false); setEditing(true); }} style={menuItemStyle}>
                          编辑
                        </button>
                        <button
                          onClick={() => { onToggleMenu(false); void onRemove(comment.id); }}
                          style={{ ...menuItemStyle, color: '#dc2626' }}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>,
                  document.body,
                )}
            </div>
          )}
        </div>
        {editing ? (
          <div style={{ marginTop: 4 }}>
            <CommentComposer
              members={members}
              placeholder="编辑评论…"
              autoFocus
              initialValue={comment.body}
              initialImages={comment.imageUrls}
              onSubmit={async (body, mentions, imageUrls) => {
                await onEdit(comment.id, { body, mentions, imageUrls });
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: 13,
                color: comment.deleted ? '#94a3b8' : '#0f172a',
                fontStyle: comment.deleted ? 'italic' : 'normal',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {comment.deleted ? '该评论已删除' : renderBody(comment.body)}
            </div>
            {!comment.deleted && <CommentImages urls={comment.imageUrls} />}
          </>
        )}
      </div>
    </div>
  );
};

/** 单线程评论 popup（画布上 pin 展开）。 */
const CommentThreadPopup: React.FC<Props> = ({
  thread,
  currentUserId,
  members,
  onReply,
  onEdit,
  onRemove,
  onDeleteThread,
  onResolve,
  onClose,
}) => {
  const composerRef = useRef<ComposerHandle | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDeleteThread =
    currentUserId != null && thread.createdById === currentUserId;

  // 删除某条评论：若删除后整条会话无存活评论，则直接删除整个线程（连带 pin）。
  const handleRemove = async (commentId: string) => {
    const liveCount = thread.comments.filter((c) => !c.deleted).length;
    if (liveCount <= 1) {
      await onDeleteThread(thread.id);
      onClose();
    } else {
      await onRemove(commentId);
    }
  };

  useEffect(() => {
    if (!openMenuId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-comment-ui]')) return;
      setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openMenuId]);

  const messages = [...thread.comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const currentMember = members.find((m) => m.id === currentUserId) ?? null;

  return (
    <div
      style={{
        width: 360,
        maxHeight: 430,
        display: 'flex',
        flexDirection: 'column',
        background: 'white',
        border: 'none',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 16px 8px',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>评论</span>
        {thread.resolved && (
          <span style={{ fontSize: 11, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Check size={12} /> 已解决
          </span>
        )}
        {confirmDelete ? (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>删除整条评论？</span>
            <button
              onClick={async () => {
                await onDeleteThread(thread.id);
                onClose();
              }}
              style={{
                border: 'none',
                background: '#dc2626',
                color: 'white',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              删除
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}
            >
              取消
            </button>
          </span>
        ) : (
          <>
            <button
              onClick={() => void onResolve(thread.id, !thread.resolved)}
              title={thread.resolved ? '重新打开' : '标记为已解决'}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: thread.resolved ? '#f59e0b' : '#16a34a',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 12,
              }}
            >
              {thread.resolved ? <RotateCcw size={13} /> : <Check size={14} />}
              {thread.resolved ? '重开' : '解决'}
            </button>
            {canDeleteThread && (
              <button
                onClick={() => setConfirmDelete(true)}
                title="删除整条评论"
                style={{ marginLeft: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              onClick={onClose}
              title="关闭"
              style={{ marginLeft: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 8px' }}
        onScroll={() => openMenuId && setOpenMenuId(null)}
      >
        {messages.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            menuOpen={openMenuId === c.id}
            onToggleMenu={(open) => setOpenMenuId(open ? c.id : null)}
            onReplyTo={(author) => composerRef.current?.addMention(author)}
            currentUserId={currentUserId}
            members={members}
            onEdit={onEdit}
            onRemove={handleRemove}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 16px 16px' }}>
        <Avatar name={currentMember?.name ?? null} url={currentMember?.avatarUrl ?? null} />
        <CommentComposer
          ref={composerRef}
          members={members}
          placeholder="回复"
          variant="threadReply"
          onSubmit={(body, mentions, imageUrls) => onReply(thread.id, { body, mentions, imageUrls })}
        />
      </div>
    </div>
  );
};

export default CommentThreadPopup;
