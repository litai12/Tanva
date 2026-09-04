export interface FreeCreditDecayLotLike {
  sourceType: string;
  validityType: string;
  metadata?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** gift 通常属于每日免费积分衰减池；签到 gift 单独按业务日整批清理。 */
export function isFreeCreditDecayLot(lot: FreeCreditDecayLotLike): boolean {
  const metadata = asRecord(lot.metadata);

  if (lot.sourceType === 'gift') {
    // 签到积分单独按凌晨 3 点业务日边界整批清理；不能再叠加每日 50 衰减。
    if (metadata?.reason === 'daily_reward') return false;
    return true;
  }

  // 注册赠送是永久 promo 批次，但仍属于非付费积分；只要用户不是
  // 有效 VIP/白名单，就应进入每日免费积分衰减池。
  if (lot.sourceType === 'promo') return true;

  if (lot.sourceType !== 'subscription' || lot.validityType !== 'fixed_window') {
    return false;
  }

  const grantedBy = typeof metadata?.grantedBy === 'string' ? metadata.grantedBy : '';
  const grantType = typeof metadata?.grantType === 'string' ? metadata.grantType : '';
  return (
    grantedBy === 'free_user_monthly_quota' ||
    grantedBy === 'free_user_starter_quota' ||
    grantType === 'free_user_starter_quota'
  );
}
