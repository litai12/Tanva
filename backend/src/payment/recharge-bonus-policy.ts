export const RECHARGE_BONUS_RATE = 0.2;
export const RECHARGE_BONUS_POLICY_VERSION = 'qualified_recharge_bonus_20_permanent_v2';

export type RechargeGrantBreakdown = {
  baseCredits: number;
  bonusCredits: number;
  totalCredits: number;
};

const toNonNegativeInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const getMetadataObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function calculateRechargeGrant(
  baseCredits: number,
  bonusEligible: boolean,
): RechargeGrantBreakdown {
  if (!Number.isInteger(baseCredits) || baseCredits <= 0) {
    throw new RangeError('Recharge base credits must be a positive integer');
  }
  const bonusCredits = bonusEligible
    ? Math.floor(baseCredits * RECHARGE_BONUS_RATE)
    : 0;
  return {
    baseCredits,
    bonusCredits,
    totalCredits: baseCredits + bonusCredits,
  };
}

/**
 * New orders snapshot their split in metadata. Historical orders do not have
 * that snapshot and must keep their original all-recharge grant semantics.
 */
export function resolveRechargeOrderGrant(
  orderCredits: number,
  metadata: unknown,
): RechargeGrantBreakdown {
  if (!Number.isInteger(orderCredits) || orderCredits <= 0) {
    throw new RangeError('Recharge order credits must be a positive integer');
  }

  const record = getMetadataObject(metadata);
  if (record?.rechargeBonusPolicyVersion !== RECHARGE_BONUS_POLICY_VERSION) {
    return { baseCredits: orderCredits, bonusCredits: 0, totalCredits: orderCredits };
  }

  const baseCredits = toNonNegativeInteger(record.rechargeBaseCredits);
  const bonusCredits = toNonNegativeInteger(record.rechargeBonusCredits);
  const totalCredits = toNonNegativeInteger(record.rechargeTotalCredits);
  if (
    baseCredits === null ||
    baseCredits <= 0 ||
    bonusCredits === null ||
    totalCredits === null ||
    baseCredits + bonusCredits !== totalCredits ||
    totalCredits !== orderCredits
  ) {
    throw new RangeError('Recharge bonus snapshot is invalid');
  }

  return { baseCredits, bonusCredits, totalCredits };
}
