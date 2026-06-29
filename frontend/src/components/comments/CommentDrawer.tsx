import React, { useMemo, useState } from 'react';
import { ArrowDownUp, Check, ImageIcon, MessageCircle, Search, X } from 'lucide-react';
import { useCanvasComments } from '@/contexts/CanvasCommentsContext';
import { useCommentStore } from '@/stores/commentStore';
import { useAuthStore } from '@/stores/authStore';
import { useCollab } from '@/collab/CollabContext';
import { usePresence } from '@/hooks/usePresence';
import { useTeamPresenceProfiles } from '@/hooks/useTeamPresenceProfiles';
import CollabPresenceBar from '@/components/collab/CollabPresenceBar';
import type { CanvasCommentThread } from '@/services/canvasCommentsApi';
import { Avatar, relTime } from './CommentThreadPopup';

/** 线程的「首条」展示信息（标题/作者/预览）。 */
function threadSummary(t: CanvasCommentThread) {
  const live = t.comments.filter((c) => !c.deleted);
  const first = live[0] ?? t.comments[0] ?? null;
  const last = live[live.length - 1] ?? first;
  const replies = live.length;
  const imageCount = live.reduce((acc, c) => acc + (c.imageUrls?.length ?? 0), 0);
  return { first, last, replies, imageCount };
}

const CommentDrawer: React.FC = () => {
  const active = useCommentStore((s) => s.active);
  const exit = useCommentStore((s) => s.exit);
  const requestFocus = useCommentStore((s) => s.requestFocus);
  const openThreadId = useCommentStore((s) => s.openThreadId);
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ?? null;
  const collab = useCollab();
  const presence = usePresence(collab ?? undefined);
  const teamPresenceProfiles = useTeamPresenceProfiles();

  const { threads } = useCanvasComments();
  const [queryText, setQueryText] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  const list = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    const filtered = threads
      .filter((t) => t.comments.some((c) => !c.deleted)) // 全部删完的不显示
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

  if (!active) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        top: 64,
        bottom: 16,
        width: 340,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 14,
        boxShadow: '0 12px 40px rgba(0,0,0,0.16)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 14,
          zIndex: 2,
        }}
      >
        <CollabPresenceBar
          online={presence.online}
          currentUserId={currentUserId}
          variant="inline"
          fallbackUser={currentUser ?? null}
          profilesByUserId={teamPresenceProfiles}
        />
      </div>
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '54px 14px 8px',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>评论</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setSortDesc((v) => !v)}
            title={sortDesc ? '最新在前' : '最早在前'}
            style={iconBtn}
          >
            <ArrowDownUp size={16} />
          </button>
          <button onClick={exit} title="关闭评论" style={iconBtn}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div style={{ padding: '0 14px 8px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#f1f5f9',
            borderRadius: 10,
            padding: '6px 10px',
          }}
        >
          <Search size={15} color="#94a3b8" />
          <input
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="搜索"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 13,
            }}
          />
          {queryText && (
            <button onClick={() => setQueryText('')} style={{ ...iconBtn, width: 18, height: 18 }}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 提示 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 14px 8px',
          color: '#94a3b8',
          fontSize: 12,
        }}
      >
        <MessageCircle size={14} />
        点击画板任意位置，可添加评论。
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
        {list.length === 0 && (
          <div style={{ padding: '24px 16px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
            {queryText ? '没有匹配的评论' : '还没有评论'}
          </div>
        )}
        {list.map((t) => {
          const { first, replies, imageCount } = threadSummary(t);
          if (!first) return null;
          const selected = openThreadId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => requestFocus(t.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: selected ? '#eff6ff' : 'transparent',
                borderRadius: 10,
                padding: '10px 10px',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar name={first.author.name} url={first.author.avatarUrl} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                  {first.author.name ?? first.author.id.slice(0, 8)}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{relTime(first.createdAt)}</span>
                {t.resolved && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: '#16a34a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      fontSize: 11,
                    }}
                  >
                    <Check size={12} /> 已解决
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: '#334155',
                  marginTop: 4,
                  paddingLeft: 32,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {first.body || (imageCount > 0 ? '' : '（无内容）')}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 4,
                  paddingLeft: 32,
                  fontSize: 11,
                  color: '#94a3b8',
                }}
              >
                {imageCount > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <ImageIcon size={12} /> {imageCount} 张图片
                  </span>
                )}
                {replies > 1 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <MessageCircle size={12} /> {replies}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
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

export default CommentDrawer;
