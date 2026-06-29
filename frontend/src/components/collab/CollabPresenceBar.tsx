import React from 'react';
import type { PresenceUser } from '@/collab/types';
import { colorFor } from '@/collab/presenceColors';
import { getDefaultAvatarColor, getDefaultAvatarInitial } from '@/utils/defaultAvatar';

interface Props {
  online: PresenceUser[];
  /** 当前用户 id，用于把"自己"标出来并排到最前。 */
  currentUserId?: string | null;
  variant?: 'fixed' | 'inline';
  fallbackUser?: { id: string; name?: string | null; avatarUrl?: string | null } | null;
  profilesByUserId?: Record<string, { name?: string | null; avatarUrl?: string | null }>;
}

function initials(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  // 中文取末字，英文取首字母
  const cjk = trimmed.match(/[一-龥]/);
  if (cjk) return trimmed.slice(-1);
  return trimmed.slice(0, 1).toUpperCase();
}

const PASTEL_AVATARS = [
  { bg: '#fee2e2', text: '#b91c1c' },
  { bg: '#ffedd5', text: '#c2410c' },
  { bg: '#fef3c7', text: '#b45309' },
  { bg: '#dcfce7', text: '#15803d' },
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#e0e7ff', text: '#4338ca' },
  { bg: '#f3e8ff', text: '#7e22ce' },
  { bg: '#fce7f3', text: '#be185d' },
];

function pastelFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PASTEL_AVATARS[hash % PASTEL_AVATARS.length];
}

/**
 * 团队项目在线成员头像条（"看见彼此在线"）。展示当前项目内的在线协作者头像，
 * hover 显示昵称。数据来自 usePresence().online（presence_join/leave + 握手快照）。
 */
const CollabPresenceBar: React.FC<Props> = ({
  online,
  currentUserId,
  variant = 'fixed',
  fallbackUser,
  profilesByUserId,
}) => {
  const users =
    online && online.length > 0
      ? online
      : fallbackUser?.id
        ? [
            {
              userId: fallbackUser.id,
              name: fallbackUser.name || fallbackUser.id.slice(0, 8),
              avatarUrl: fallbackUser.avatarUrl ?? null,
            },
          ]
        : [];
  if (users.length === 0) return null;
  // 自己排最前
  const withProfiles = users.map((u) => {
    const profile = profilesByUserId?.[u.userId];
    return profile
      ? {
          ...u,
          name: profile.name || u.name,
          avatarUrl: profile.avatarUrl ?? null,
        }
      : u;
  });
  const sorted = [...withProfiles].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return 0;
  });
  const shown = sorted.slice(0, 6);
  const extra = sorted.length - shown.length;

  return (
    <div
      className={`${variant === 'fixed' ? 'fixed z-[8000]' : 'relative z-[1]'} flex items-center`}
      // 放在顶部浮动栏【下方】右侧, 避免与团队/积分 pill 重叠。
      style={variant === 'fixed' ? { top: 72, right: 24, pointerEvents: 'none' } : { pointerEvents: 'none' }}
    >
      <div
        className={
          variant === 'fixed'
            ? 'flex items-center'
            : 'flex items-center'
        }
        style={{ pointerEvents: 'auto' }}
        title={`${users.length} 人在线协作`}
      >
        <div className="flex -space-x-2">
          {shown.map((u) => {
            const color = u.color ?? colorFor(u.userId);
            const pastel = getDefaultAvatarColor(u.userId || u.name);
            const isSelf = u.userId === currentUserId;
            return (
              <div
                key={u.userId}
                title={isSelf ? `${u.name}（你）` : u.name}
                className={`${variant === 'inline' || variant === 'fixed' ? 'h-10 w-10 shadow-lg' : 'h-8 w-8'} flex items-center justify-center overflow-hidden rounded-full border-2 border-white text-xs font-semibold`}
                style={{ background: u.avatarUrl ? color : pastel.bg, color: pastel.text }}
              >
                {u.avatarUrl ? (
                  <img src={u.avatarUrl} alt={u.name} className="h-full w-full object-cover" />
                ) : (
                  getDefaultAvatarInitial(u.name, u.userId)
                )}
              </div>
            );
          })}
          {extra > 0 && (
            <div
              className={`${variant === 'inline' || variant === 'fixed' ? 'h-10 w-10 shadow-lg' : 'h-8 w-8'} flex items-center justify-center rounded-full border-2 border-white bg-gray-500 text-xs font-semibold text-white`}
              title={`另有 ${extra} 人在线`}
            >
              +{extra}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CollabPresenceBar;
