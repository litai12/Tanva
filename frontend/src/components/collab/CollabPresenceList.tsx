import React from 'react';
import type { PresenceUser } from '@/collab/types';

interface Props {
  online: PresenceUser[];
  currentUserId?: string | null;
  degraded?: boolean;
}

function initials(name: string): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  const m = trimmed.match(/[A-Za-z一-龥]/g);
  if (!m) return trimmed.slice(0, 1).toUpperCase();
  return m.slice(0, 2).join('').toUpperCase();
}

const CollabPresenceList: React.FC<Props> = ({ online, currentUserId, degraded }) => {
  if (online.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        zIndex: 8500,
        pointerEvents: 'none',
      }}
    >
      {degraded && (
        <span
          title="实时协作降级（Redis 不可用），仅同实例可见"
          style={{
            fontSize: 11,
            background: 'rgba(234,179,8,0.95)',
            color: '#1f2937',
            padding: '2px 6px',
            borderRadius: 4,
            marginRight: 6,
            pointerEvents: 'auto',
          }}
        >
          降级
        </span>
      )}
      {online.map((u) => {
        const isSelf = u.userId === currentUserId;
        return (
          <div
            key={u.userId}
            title={isSelf ? `${u.name} (我)` : u.name}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: u.color ?? '#3b82f6',
              color: 'white',
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: isSelf ? '2px solid #1f2937' : '2px solid white',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              marginLeft: -6,
              pointerEvents: 'auto',
            }}
          >
            {initials(u.name)}
          </div>
        );
      })}
    </div>
  );
};

export default CollabPresenceList;
