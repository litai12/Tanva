export const HIGHEST_TIER_YEARLY_RECHARGE_DISCOUNT_RATE = 0.8;

export type RechargeDiscountPlan = {
  id: string;
  billingCycle: string;
  sortOrder?: number | null;
  monthlyQuotaCredits?: number | null;
  price?: unknown;
  metadata?: unknown;
};

function normalizeBillingCycle(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMetadataObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 套餐层级与会员购买页保持一致：显式 tierRank 优先，其次使用运营排序，
 * 再以额度和价格兜底。调用方应先把候选限制在同一计费周期内。
 */
export function resolveRechargeDiscountPlanTierRank(plan: RechargeDiscountPlan): number {
  const metadataTierRank = toFiniteNumber(getMetadataObject(plan.metadata)?.tierRank);
  if (metadataTierRank !== null) return metadataTierRank;

  const sortOrder = toFiniteNumber(plan.sortOrder);
  if (sortOrder !== null && sortOrder !== 0) return sortOrder;

  const monthlyQuotaCredits = toFiniteNumber(plan.monthlyQuotaCredits);
  if (monthlyQuotaCredits !== null && monthlyQuotaCredits > 0) return monthlyQuotaCredits;

  return toFiniteNumber(plan.price) ?? 0;
}

export function isHighestTierYearlyRechargeDiscountEligible(
  membershipPlanId: string,
  activePlans: RechargeDiscountPlan[],
): boolean {
  const yearlyPlans = activePlans.filter((plan) => {
    const cycle = normalizeBillingCycle(plan.billingCycle);
    return cycle === 'yearly' || cycle === 'annual';
  });
  if (yearlyPlans.length === 0) return false;

  const subscribedPlan = yearlyPlans.find((plan) => plan.id === membershipPlanId);
  if (!subscribedPlan) return false;

  const highestTierRank = Math.max(
    ...yearlyPlans.map((plan) => resolveRechargeDiscountPlanTierRank(plan)),
  );
  return resolveRechargeDiscountPlanTierRank(subscribedPlan) === highestTierRank;
}
