import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, MoreHorizontal, Reply, RotateCcw, Send, X } from 'lucide-react';
import type { CanvasComment, CanvasCommentThread } from '@/services/canvasCommentsApi';
import type { MentionCandidate } from '@/hooks/useNodeComments';

export interface ComposerHandle {
  /** 在输入框追加 @某人 并聚焦（用于「回复」自动引用作者）。 */
  addMention: (cand: MentionCandidate) => void;
}

interface Props {
  nodeId: string;
  threads: CanvasCommentThread[];
  currentUserId: string | null;
  members: MentionCandidate[];
  onCreateThread: (nodeId: string, body: string, mentions?: string[]) => Promise<unknown>;
  onReply: (threadId: string, body: string, mentions?: string[]) => Promise<unknown>;
  onEdit: (commentId: string, body: string, mentions?: string[]) => Promise<unknown>;
  onRemove: (commentId: string) => Promise<unknown>;
  onResolve: (threadId: string, resolved: boolean) => Promise<unknown>;
  onClose: () => void;
}

function relTime(iso: string): string {
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

function initials(name: string | null): string {
  const n = (name ?? '').trim();
  if (!n) return '?';
  return n.slice(0, 1).toUpperCase();
}

/** 高亮正文中的 @提及（简单按 @ 到空白的子串着色，纯文本渲染，无 HTML 注入）。 */
function renderBody(body: string): React.ReactNode {
  const parts = body.split(/(@[^\s@]+)/g);
  return parts.map((p, i) =>
    p.startsWith('@') ? (
      <span key={i} style={{ color: '#2563eb', fontWeight: 600 }}>
        {p}
      </span>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    ),
  );
}

const Avatar: React.FC<{ name: string | null; url: string | null }> = ({ name, url }) => (
  <div
    style={{
      width: 24,
      height: 24,
      borderRadius: '50%',
      background: url ? `center/cover no-repeat url(${url})` : '#94a3b8',
      color: 'white',
      fontSize: 11,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 auto',
    }}
  >
    {!url && initials(name)}
  </div>
);

/** 带 @ 自动补全的输入框。提交时回传文本与已选 mention userId。 */
const Composer = forwardRef<
  ComposerHandle,
  {
    members: MentionCandidate[];
    placeholder: string;
    autoFocus?: boolean;
    initialValue?: string;
    submitLabel?: React.ReactNode;
    onSubmit: (body: string, mentions: string[]) => Promise<unknown>;
    onCancel?: () => void;
  }
>(({ members, placeholder, autoFocus, initialValue, submitLabel, onSubmit, onCancel }, ref) => {
  const [value, setValue] = useState(initialValue ?? '');
  const [mentionIds, setMentionIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    addMention: (cand: MentionCandidate) => {
      setValue((v) => {
        const needsSpace = v.length > 0 && !v.endsWith(' ');
        return `${v}${needsSpace ? ' ' : ''}@${cand.name ?? cand.id} `;
      });
      setMentionIds((prev) => new Set(prev).add(cand.id));
      requestAnimationFrame(() => taRef.current?.focus());
    },
  }));

  const candidates = useMemo(() => {
    if (query == null) return [];
    const q = query.toLowerCase();
    return members.filter((m) => (m.name ?? '').toLowerCase().includes(q)).slice(0, 6);
  }, [query, members]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    setQuery(m ? m[1] : null);
  };

  const pickMention = (cand: MentionCandidate) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([^\s@]*)$/, `@${cand.name ?? cand.id} `);
    const after = value.slice(caret);
    setValue(before + after);
    setMentionIds((prev) => new Set(prev).add(cand.id));
    setQuery(null);
    requestAnimationFrame(() => ta?.focus());
  };

  const submit = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      // 仅保留正文里仍出现 @name 的 mention。
      const kept = [...mentionIds].filter((id) => {
        const m = members.find((x) => x.id === id);
        return m && value.includes(`@${m.name ?? m.id}`);
      });
      await onSubmit(body, kept);
      setValue('');
      setMentionIds(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        <textarea
          ref={taRef}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={onChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '6px 8px',
            fontSize: 13,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          title="发送 (⌘/Ctrl+Enter)"
          style={{
            border: 'none',
            background: value.trim() ? '#2563eb' : '#cbd5e1',
            color: 'white',
            borderRadius: 8,
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: value.trim() ? 'pointer' : 'default',
            flex: '0 0 auto',
          }}
        >
          {submitLabel ?? <Send size={15} />}
        </button>
      </div>
      {onCancel && (
        <button
          onClick={onCancel}
          style={{
            marginTop: 4,
            fontSize: 12,
            color: '#64748b',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          取消
        </button>
      )}
      {candidates.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            width: 200,
            zIndex: 5,
            overflow: 'hidden',
          }}
        >
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => pickMention(c)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
              }}
            >
              <Avatar name={c.name} url={c.avatarUrl} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name ?? c.id.slice(0, 8)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
Composer.displayName = 'Composer';

const CommentRow: React.FC<{
  comment: CanvasComment;
  currentUserId: string | null;
  members: MentionCandidate[];
  menuOpen: boolean;
  onToggleMenu: (open: boolean) => void;
  onReplyTo: (author: MentionCandidate) => void;
  onEdit: (commentId: string, body: string, mentions?: string[]) => Promise<unknown>;
  onRemove: (commentId: string) => Promise<unknown>;
}> = ({ comment, currentUserId, members, menuOpen, onToggleMenu, onReplyTo, onEdit, onRemove }) => {
  const [editing, setEditing] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const mine = currentUserId != null && comment.author.id === currentUserId;

  // 菜单用 portal 渲染到 body，按钮位置定位 —— 避免被面板滚动容器(overflow)截断。
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 4, left: r.right - 96 });
  }, [menuOpen]);

  return (
    <div style={{ display: 'flex', gap: 8, padding: '6px 0' }}>
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
            <Composer
              members={members}
              placeholder="编辑评论…"
              autoFocus
              initialValue={comment.body}
              onSubmit={async (body, mentions) => {
                await onEdit(comment.id, body, mentions);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
};

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

const NodeCommentThreadPanel: React.FC<Props> = ({
  nodeId,
  threads,
  currentUserId,
  members,
  onCreateThread,
  onReply,
  onEdit,
  onRemove,
  onResolve,
  onClose,
}) => {
  const composerRef = useRef<ComposerHandle | null>(null);
  // 同一时刻只允许一个评论的「更多」菜单打开。
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // 点击菜单以外区域关闭菜单（data-comment-ui 标记菜单与触发按钮）。
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
  // 单一对话：把该节点的所有线程合并成一条会话（历史多线程数据也并到一起按时间排序）。
  const sortedThreads = [...threads].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const messages = sortedThreads
    .flatMap((t) => t.comments)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const hasThreads = sortedThreads.length > 0;
  const anyUnresolved = sortedThreads.some((t) => !t.resolved);
  const allResolved = hasThreads && !anyUnresolved;
  // 新消息追加到目标线程：优先最早的未解决线程；都已解决则追加到最近一条（后端会自动重开）。
  const targetThread =
    sortedThreads.find((t) => !t.resolved) ?? sortedThreads[sortedThreads.length - 1] ?? null;

  const submit = (body: string, mentions: string[]) =>
    targetThread ? onReply(targetThread.id, body, mentions) : onCreateThread(nodeId, body, mentions);

  const toggleResolve = async () => {
    // 整段会话一起解决/重开。
    if (anyUnresolved) {
      for (const t of sortedThreads) if (!t.resolved) await onResolve(t.id, true);
    } else {
      for (const t of sortedThreads) if (t.resolved) await onResolve(t.id, false);
    }
  };

  return (
    <div
      style={{
        width: 300,
        maxHeight: 440,
        display: 'flex',
        flexDirection: 'column',
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>评论</span>
        {allResolved && (
          <span style={{ fontSize: 11, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Check size={12} /> 已解决
          </span>
        )}
        {hasThreads && (
          <button
            onClick={() => void toggleResolve()}
            title={anyUnresolved ? '标记为已解决' : '重新打开'}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: anyUnresolved ? '#16a34a' : '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 12,
            }}
          >
            {anyUnresolved ? <Check size={14} /> : <RotateCcw size={13} />}
            {anyUnresolved ? '解决' : '重开'}
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            marginLeft: hasThreads ? 4 : 'auto',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: '#94a3b8',
          }}
        >
          <X size={16} />
        </button>
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', padding: '4px 12px' }}
        onScroll={() => openMenuId && setOpenMenuId(null)}
      >
        {messages.length === 0 && (
          <div style={{ fontSize: 13, color: '#94a3b8', padding: '12px 0' }}>
            还没有评论，写下第一条吧。
          </div>
        )}
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
            onRemove={onRemove}
          />
        ))}
      </div>

      <div style={{ borderTop: '1px solid #f1f5f9', padding: '8px 12px' }}>
        <Composer
          ref={composerRef}
          members={members}
          placeholder={hasThreads ? '回复…（输入 @ 提及成员）' : '写评论…'}
          onSubmit={submit}
        />
      </div>
    </div>
  );
};

export default NodeCommentThreadPanel;
