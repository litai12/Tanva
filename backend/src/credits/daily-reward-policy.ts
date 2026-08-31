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
