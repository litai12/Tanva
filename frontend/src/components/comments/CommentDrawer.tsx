import React, { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Check,
  ImageIcon,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';
import { useCanvasComments } from '@/contexts/CanvasCommentsContext';
import { useCommentStore } from '@/stores/commentStore';
import type { CanvasCommentThread } from '@/services/canvasCommentsApi';
import { Avatar, relTime } from './CommentThreadPopup';
import CommentComposer from './CommentComposer';

function threadSummary(t: CanvasCommentThread) {
  const live = t.comments.filter((c) => !c.deleted);
  const first = live[0] ?? t.comments[0] ?? null;
  const replies = live.length;
  const imageCount = live.reduce((acc, c) => acc + (c.imageUrls?.length ?? 0), 0);
  return { first, replies, imageCount };
}

const CommentDrawer: React.FC = () => {
  const active = useCommentStore((s) => s.active);
  const exit = useCommentStore((s) => s.exit);
  const requestFocus = useCommentStore((s) => s.requestFocus);
  const openThreadId = useCommentStore((s) => s.openThreadId);

  const { threads, members, createThread, reply } = useCanvasComments();
  const [queryText, setQueryText] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  const list = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    const filtered = threads
      .filter((t) => t.comments.some((c) => !c.deleted))
      .filter((t) => {
        if (!q) return true;
        return t.comments.some(
          (c) =>
            !c.deleted &&
            ((c.body ?? '').toLowerCase().includes(q) ||
              (c.author.name ?? '').toLowerCase().includes(q)),
        );
      });
    filtered.sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      return sortDesc ? bt - at : at - bt;
    });
    return filtered;
  }, [threads, queryText, sortDesc]);

  const selectedThread = openThreadId ? threads.find((thread) => thread.id === openThreadId) ?? null : null;

  if (!active) return null;

  return (
    <aside style={drawerStyle}>
      <header style={headerStyle}>
        <span style={titleStyle}>评论</span>
        <button type="button" onClick={exit} title="关闭评论" style={headerCloseBtnStyle}>
          <X size={18} strokeWidth={2.1} />
        </button>
      </header>

      <div style={searchRowStyle}>
        <div style={searchBoxStyle}>
          <Search size={15} color="#94a3b8" />
          <input
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="搜索"
            style={searchInputStyle}
          />
          {queryText && (
            <button
              type="button"
              onClick={() => setQueryText('')}
              style={{ ...iconBtn, width: 18, height: 18 }}
              title="清空搜索"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSortDesc((v) => !v)}
          title={sortDesc ? '最新在前' : '最早在前'}
          style={iconBtn}
        >
          <ArrowDownUp size={16} />
        </button>
      </div>

      <div style={hintStyle}>
        <MessageCircle size={15} />
        <span>点击页面任意位置，可添加评论。</span>
      </div>

      <div style={listStyle}>
        {list.length === 0 && (
          <div style={emptyStyle}>{queryText ? '没有匹配的评论' : '还没有评论'}</div>
        )}
        {list.map((thread) => {
          const { first, replies, imageCount } = threadSummary(thread);
          if (!first) return null;
          const selected = openThreadId === thread.id;
          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => requestFocus(thread.id)}
              style={{
                ...itemStyle,
                background: selected ? '#f4f6f8' : 'transparent',
              }}
            >
              <div style={metaRowStyle}>
                <Avatar
                  name={first.author.name}
                  url={first.author.avatarUrl}
                  userId={first.author.id}
                />
                <span style={nameStyle}>{first.author.name ?? first.author.id.slice(0, 8)}</span>
                <span style={timeStyle}>{relTime(first.createdAt)}</span>
                {thread.resolved && (
                  <span style={resolvedStyle}>
                    <Check size={12} /> 已解决
                  </span>
                )}
              </div>
              <div style={bodyStyle}>{first.body || (imageCount > 0 ? '' : '（无内容）')}</div>
              {(imageCount > 0 || replies > 1) && (
                <div style={statsStyle}>
                  {imageCount > 0 && (
                    <span style={statItemStyle}>
                      <ImageIcon size={12} /> {imageCount} 张图片
                    </span>
                  )}
                  {replies > 1 && (
                    <span style={statItemStyle}>
                      <MessageCircle size={12} /> {replies}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div style={composerWrapStyle}>
        {selectedThread && (
          <div style={replyTargetStyle}>
            <span style={replyTargetTextStyle}>回复当前评论</span>
          </div>
        )}
        <CommentComposer
          members={members}
          placeholder={selectedThread ? '回复' : '写评论...'}
          variant="drawer"
          onSubmit={async (body, mentions, imageUrls) => {
            if (selectedThread) {
              await reply(selectedThread.id, { body, mentions, imageUrls });
              return;
            }
            const created = await createThread({ body, mentions, imageUrls });
            if (created) requestFocus(created.id);
          }}
        />
      </div>
    </aside>
  );
};

const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  right: 0,
  top: 0,
  bottom: 0,
  width: 340,
  zIndex: 60,
  display: 'flex',
  flexDirection: 'column',
  background: '#ffffff',
  borderLeft: '1px solid #e5e7eb',
  boxShadow: 'none',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  minHeight: 60,
  display: 'flex',
  alignItems: 'center',
  padding: '0 26px',
  borderBottom: '1px solid #e5e7eb',
  position: 'relative',
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  lineHeight: '20px',
  color: '#0f172a',
};

const searchRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '14px 26px 10px',
};

const searchBoxStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: '#f1f5f9',
  borderRadius: 16,
  padding: '8px 12px',
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 13,
  color: '#334155',
};

const hintStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 26px 14px',
  color: '#64748b',
  fontSize: 12,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '0 26px 12px',
};

const emptyStyle: React.CSSProperties = {
  padding: '24px 16px',
  color: '#94a3b8',
  fontSize: 13,
  textAlign: 'center',
};

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: 'none',
  borderRadius: 8,
  padding: '12px 10px',
  marginBottom: 8,
  cursor: 'pointer',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const nameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: '#0f172a',
};

const timeStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#94a3b8',
};

const resolvedStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: '#16a34a',
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  fontSize: 11,
};

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#1f2937',
  marginTop: 6,
  paddingLeft: 32,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};

const statsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 8,
  paddingLeft: 32,
  fontSize: 12,
  color: '#94a3b8',
};

const statItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
};

const composerWrapStyle: React.CSSProperties = {
  flex: '0 0 auto',
  padding: '12px 26px 18px',
  borderTop: '1px solid #e5e7eb',
  background: '#ffffff',
};

const replyTargetStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 18,
  marginBottom: 8,
};

const replyTargetTextStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: '#64748b',
};

const iconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: '#64748b',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const headerCloseBtnStyle: React.CSSProperties = {
  ...iconBtn,
  width: 32,
  height: 32,
  padding: 0,
  lineHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'absolute',
  right: 16,
  top: '50%',
  transform: 'translateY(-50%)',
};

export default CommentDrawer;
