export const DAILY_REWARD_RESET_HOUR = 3;

/**
 * 签到按本地时间凌晨 3 点切换业务日。
 */
export function getDailyRewardBusinessDayAnchor(date: Date): Date {
  const anchor = new Date(date);
  anchor.setMinutes(0, 0, 0);

  if (anchor.getHours() < DAILY_REWARD_RESET_HOUR) {
    anchor.setDate(anchor.getDate() - 1);
  }

  anchor.setHours(DAILY_REWARD_RESET_HOUR, 0, 0, 0);
  return anchor;
}

/**
 * 当次签到积分只在当前签到业务日有效，并在下一个业务日开始时失效。
 */
export function getDailyRewardExpiresAt(grantedAt: Date): Date {
  const expiresAt = getDailyRewardBusinessDayAnchor(grantedAt);
  expiresAt.setDate(expiresAt.getDate() + 1);
  return expiresAt;
}

export function diffDailyRewardBusinessDays(current: Date, previous: Date): number {
  const currentAnchor = getDailyRewardBusinessDayAnchor(current);
  const previousAnchor = getDailyRewardBusinessDayAnchor(previous);
  return Math.floor((currentAnchor.getTime() - previousAnchor.getTime()) / (24 * 60 * 60 * 1000));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 有效月卡、年卡或 VIP 白名单领取的签到积分属于永久会员权益。
 * retentionPolicy 用于新数据，tierCode 用于兼容已经发放的历史 VIP 签到批次。
 */
export function isRetainedVipDailyReward(metadata: unknown): boolean {
  const record = asRecord(metadata);
  if (record?.retentionPolicy === 'vip_permanent') return true;

  const tierCode = typeof record?.tierCode === 'string'
    ? record.tierCode.trim().toLowerCase()
    : '';
  return tierCode.length > 0 && tierCode !== 'free';
}
