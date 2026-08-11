import type { Prisma } from '@prisma/client';

export const MEMBERSHIP_PRICE_VERSION = '2026-08-v2';

export type MembershipPlanTierCandidate = {
  id: string;
  billingCycle: string;
  sortOrder?: number | null;
  monthlyQuotaCredits?: number | null;
  price?: unknown;
  metadata?: unknown;
};

type VipEntitlementClient = Pick<
  Prisma.TransactionClient,
  'user' | 'membershipPlan' | 'userMembershipSubscription'
>;

const normalizeBillingCycle = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getMetadataObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** 套餐层级与会员购买页一致：tierRank → sortOrder → 月额度 → 价格。 */
export function resolveMembershipPlanTierRank(plan: MembershipPlanTierCandidate): number {
  const metadataTierRank = toFiniteNumber(getMetadataObject(plan.metadata)?.tierRank);
  if (metadataTierRank !== null) return metadataTierRank;

  const sortOrder = toFiniteNumber(plan.sortOrder);
  if (sortOrder !== null && sortOrder !== 0) return sortOrder;

  const monthlyQuotaCredits = toFiniteNumber(plan.monthlyQuotaCredits);
  if (monthlyQuotaCredits !== null && monthlyQuotaCredits > 0) return monthlyQuotaCredits;

  return toFiniteNumber(plan.price) ?? 0;
}

export function findHighestTierYearlyPlan<T extends MembershipPlanTierCandidate>(
  plans: T[],
): T | null {
  const yearlyPlans = plans.filter((plan) => {
    const cycle = normalizeBillingCycle(plan.billingCycle);
    return cycle === 'yearly' || cycle === 'annual';
  });
  if (yearlyPlans.length === 0) return null;

  return yearlyPlans.reduce((highest, plan) => {
    const rankDelta = resolveMembershipPlanTierRank(plan) - resolveMembershipPlanTierRank(highest);
    if (rankDelta > 0) return plan;
    if (rankDelta < 0) return highest;
    return Number(plan.price ?? 0) > Number(highest.price ?? 0) ? plan : highest;
  });
}

export function isHighestTierYearlyPlan(
  membershipPlanId: string,
  activePlans: MembershipPlanTierCandidate[],
): boolean {
  const highestPlan = findHighestTierYearlyPlan(activePlans);
  return highestPlan?.id === membershipPlanId;
}

export async function findVipWhitelistHighestYearlyPlan(
  client: VipEntitlementClient,
  userId: string,
) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { vipEntitlementWhitelist: true },
  });
  if (user?.vipEntitlementWhitelist !== true) return null;

  const activePlans = await client.membershipPlan.findMany({
    where: {
      isActive: true,
      metadata: {
        path: ['priceVersion'],
        equals: MEMBERSHIP_PRICE_VERSION,
      },
    },
  });
  return findHighestTierYearlyPlan(activePlans);
}

/**
 * 功能权益使用的有效套餐。白名单优先提升到最高档年卡；否则返回真实有效订阅套餐。
 * 该函数不创建订阅、积分批次或权益快照，因此白名单不会触发周期积分发放。
 */
export async function resolveEffectiveMembershipPlan(
  client: VipEntitlementClient,
  userId: string,
  now = new Date(),
) {
  const whitelistPlan = await findVipWhitelistHighestYearlyPlan(client, userId);
  if (whitelistPlan) {
    return { plan: whitelistPlan, source: 'vip_whitelist' as const };
  }

  const subscription = await client.userMembershipSubscription.findFirst({
    where: {
      userId,
      status: 'active',
      currentPeriodStartAt: { lte: now },
      currentPeriodEndAt: { gt: now },
    },
    select: { membershipPlanId: true },
    orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
  });
  if (!subscription?.membershipPlanId) {
    return { plan: null, source: null };
  }

  const plan = await client.membershipPlan.findUnique({
    where: { id: subscription.membershipPlanId },
  });
  return { plan, source: plan ? ('subscription' as const) : null };
}
