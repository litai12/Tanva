import React from 'react';
import type { PresenceUser } from '@/collab/types';
import { colorFor } from '@/collab/presenceColors';

interface Props {
  online: PresenceUser[];
  /** 当前用户 id，用于把"自己"标出来并排到最前。 */
  currentUserId?: string | null;
}

function initials(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  // 中文取末字，英文取首字母
  const cjk = trimmed.match(/[一-龥]/);
  if (cjk) return trimmed.slice(-1);
  return trimmed.slice(0, 1).toUpperCase();
}

/**
 * 团队项目在线成员头像条（"看见彼此在线"）。展示当前项目内的在线协作者头像，
 * hover 显示昵称。数据来自 usePresence().online（presence_join/leave + 握手快照）。
 */
const CollabPresenceBar: React.FC<Props> = ({ online, currentUserId }) => {
  if (!online || online.length === 0) return null;
  // 自己排最前
  const sorted = [...online].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return 0;
  });
  const shown = sorted.slice(0, 6);
  const extra = sorted.length - shown.length;

  return (
    <div
      className="fixed z-[8000] flex items-center"
      // 放在顶部浮动栏【下方】右侧, 避免与团队/积分 pill 重叠。
      style={{ top: 72, right: 24, pointerEvents: 'none' }}
    >
      <div
        className="flex items-center rounded-full bg-white/90 px-2.5 py-1.5 shadow-md backdrop-blur"
        style={{ pointerEvents: 'auto' }}
        title={`${online.length} 人在线协作`}
      >
        <div className="flex -space-x-2">
          {shown.map((u) => {
            const color = u.color ?? colorFor(u.userId);
            const isSelf = u.userId === currentUserId;
            return (
              <div
                key={u.userId}
                title={isSelf ? `${u.name}（你）` : u.name}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white"
                style={{ background: color }}
              >
                {initials(u.name)}
              </div>
            );
          })}
          {extra > 0 && (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gray-500 text-xs font-semibold text-white"
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
