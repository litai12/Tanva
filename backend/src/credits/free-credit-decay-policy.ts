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

/** gift 即免费积分；recharge/manual/会员额度均不属于每日免费积分衰减池。 */
export function isFreeCreditDecayLot(lot: FreeCreditDecayLotLike): boolean {
  const metadata = asRecord(lot.metadata);

  if (lot.sourceType === 'gift') {
    return true;
  }

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
