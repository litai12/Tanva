// 协作在线成员/光标的配色。统一口径，供 usePresence 与 CollabPresenceBar 共用，
// 避免两处各自维护调色板/哈希导致行为漂移。

export const PRESENCE_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
];

/** 单个 userId 的"首选色"：稳定哈希落到调色板（可能与他人撞色）。 */
export function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return PRESENCE_PALETTE[Math.abs(h) % PRESENCE_PALETTE.length];
}

/**
 * 给一组在线 userId 分配【互不重复】的颜色。
 * - 以每个 id 的首选色（colorFor）为起点做线性探测，撞色则顺延到下一个空闲色，
 *   既保证不重复，又尽量保留各自的"惯用色"（无人撞色时 = colorFor 结果）。
 * - 先按 id 排序，使分配结果对同一在线集合稳定（不随事件到达顺序抖动）。
 * - 在线人数超过调色板容量（>10）时无法再保证唯一，回退首选色（允许重复）。
 */
export function assignUniqueColors(userIds: string[]): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = {};
  const ids = [...new Set(userIds)].sort();
  for (const id of ids) {
    const start = PRESENCE_PALETTE.indexOf(colorFor(id));
    let chosen: string | null = null;
    for (let i = 0; i < PRESENCE_PALETTE.length; i++) {
      const cand = PRESENCE_PALETTE[(start + i) % PRESENCE_PALETTE.length];
      if (!used.has(cand)) {
        chosen = cand;
        break;
      }
    }
    if (!chosen) chosen = colorFor(id); // 人数 > 调色板容量，允许重复
    used.add(chosen);
    result[id] = chosen;
  }
  return result;
}
