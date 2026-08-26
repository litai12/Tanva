import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MembershipService } from '../src/membership/membership.service';
import { PaymentService } from '../src/payment/payment.service';

const now = Date.now();
const activeStart = new Date(now - 15 * 24 * 60 * 60 * 1000);
const activeEnd = new Date(now + 15 * 24 * 60 * 60 * 1000);

function plan(overrides: Record<string, unknown>) {
  return {
    id: 'plan-id',
    code: 'plan',
    name: '套餐',
    billingCycle: 'monthly',
    price: { toString: () => '200', valueOf: () => 200 },
    monthlyQuotaCredits: 1200,
    signupBonusCredits: 0,
    dailyGiftCredits: 0,
    sortOrder: 20,
    metadata: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function previewFor(
  snapshot: Record<string, unknown>,
  options: {
    currentSortOrder?: number;
    targetSortOrder?: number;
    targetBillingCycle?: 'monthly' | 'yearly';
    targetPlanCode?: string;
  } = {},
) {
  const isYearly = snapshot.billingCycle === 'yearly';
  const periodStart = isYearly ? new Date(now - 180 * 24 * 60 * 60 * 1000) : activeStart;
  const periodEnd = isYearly ? new Date(now + 180 * 24 * 60 * 60 * 1000) : activeEnd;
  const currentPlan = plan({
    id: 'old-plan',
    code: 'old',
    price: { toString: () => '120', valueOf: () => 120 },
    sortOrder: options.currentSortOrder ?? 10,
    metadata: snapshot.metadata ?? null,
  });
  const targetPlan = plan({
    id: 'new-plan',
    code: 'new',
    billingCycle: options.targetBillingCycle ?? (snapshot.billingCycle === 'yearly' ? 'yearly' : 'monthly'),
    price: { toString: () => '200', valueOf: () => 200 },
    sortOrder: options.targetSortOrder ?? 20,
    metadata: {
      priceVersion: '2026-08-v2',
      ...(options.targetPlanCode ? { planCode: options.targetPlanCode } : {}),
    },
  });
  const prisma = {
    membershipPlan: {
      findFirst: async () => targetPlan,
      findUnique: async () => currentPlan,
    },
    userMembershipSubscription: {
      findFirst: async () => ({
        id: 'subscription',
        userId: 'user',
        membershipPlanId: 'old-plan',
        status: 'active',
        periodType: snapshot.billingCycle,
        currentPeriodStartAt: periodStart,
        currentPeriodEndAt: periodEnd,
        lastOrderId: 'old-order',
        snapshot,
      }),
    },
    paymentOrder: {
      findFirst: async () => ({ amount: { toString: () => '80', valueOf: () => 80 } }),
    },
    creditTransaction: {
      findMany: async () => Array.from({ length: 6 }, (_, index) => ({
        metadata: {
          annualCycleStartAt: periodStart.toISOString(),
          annualInstallmentIndex: index + 1,
        },
      })),
    },
  };
  const service = new MembershipService(prisma as never, {
    getMembershipCreditPolicy: async () => ({ membershipRefreshCycleDays: 30 }),
  } as never);
  return service.getUserTransitionPreview('user', 'new');
}

async function verifyLegacyReplacementActivation() {
  const paidAt = new Date('2026-08-26T08:00:00.000Z');
  const originalEndAt = new Date('2026-09-10T08:00:00.000Z');
  const targetPlan = plan({
    id: 'new-plan',
    code: 'vip_199_monthly',
    name: '专业进阶',
    price: { toString: () => '199', valueOf: () => 199 },
    monthlyQuotaCredits: 20000,
    signupBonusCredits: 2000,
    sortOrder: 20,
    metadata: { priceVersion: '2026-08-v2', pauseGiftDecay: true },
  });
  const targetSnapshot = {
    id: targetPlan.id,
    code: targetPlan.code,
    name: targetPlan.name,
    billingCycle: targetPlan.billingCycle,
    price: '199',
    monthlyQuotaCredits: targetPlan.monthlyQuotaCredits,
    signupBonusCredits: targetPlan.signupBonusCredits,
    dailyGiftCredits: targetPlan.dailyGiftCredits,
    metadata: targetPlan.metadata,
  };
  const subscription = {
    id: 'subscription',
    userId: 'user',
    membershipPlanId: 'old-plan',
    status: 'active',
    periodType: 'monthly',
    currentPeriodStartAt: new Date('2026-08-11T08:00:00.000Z'),
    currentPeriodEndAt: originalEndAt,
    activatedAt: new Date('2026-08-11T08:00:00.000Z'),
    renewalCount: 2,
    lastOrderId: 'old-order',
    snapshot: {
      id: 'old-plan',
      code: 'legacy_old-plan',
      name: '旧专业月费',
      billingCycle: 'monthly',
      price: '199',
      monthlyQuotaCredits: 20000,
      signupBonusCredits: 2000,
      dailyGiftCredits: 100,
      metadata: { priceVersion: 'legacy' },
    },
  };
  const account = {
    id: 'account', userId: 'user', balance: 15000, totalEarned: 50000, totalSpent: 35000,
    createdAt: paidAt, updatedAt: paidAt, lastDailyRewardAt: null, consecutiveDays: 0, lastCheckInDate: null,
  };
  const oldMembershipLot = {
    id: 'old-membership-lot', accountId: account.id, sourceType: 'subscription',
    validityType: 'membership_bound', scopeType: 'global', scopeValue: null,
    totalAmount: 22000, remainingAmount: 5000, grantedAt: subscription.currentPeriodStartAt,
    activeAt: subscription.currentPeriodStartAt, expiresAt: originalEndAt, durationDays: 30,
    subscriptionId: subscription.id, orderId: 'old-order', status: 'active', priority: 0,
    metadata: {}, createdAt: subscription.currentPeriodStartAt, updatedAt: subscription.currentPeriodStartAt,
  };
  const rechargeLot = { id: 'recharge-lot', remainingAmount: 10000, status: 'active' };
  let createdLot: Record<string, unknown> | null = null;
  let entitlement: Record<string, unknown> | null = null;
  const transactions: Array<Record<string, unknown>> = [];
  const changes: Array<Record<string, unknown>> = [];
  const order = {
    id: 'new-order', userId: 'user', orderType: 'membership', membershipPlanId: targetPlan.id,
    subscriptionId: null, planSnapshot: targetSnapshot,
    metadata: {
      membershipTransitionType: 'upgrade', membershipCycleSwitch: true,
      legacyPlanReplacement: true, currentMembershipPlanId: 'old-plan',
    },
  };

  const tx = {
    $queryRaw: async () => [],
    paymentOrder: { findUnique: async () => order },
    membershipPlan: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === targetPlan.id ? targetPlan : { metadata: { priceVersion: 'legacy' } },
    },
    userMembershipSubscription: {
      findFirst: async () => subscription,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(subscription, data),
      findUnique: async () => subscription,
    },
    membershipSubscriptionChange: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        changes.push(data);
        return data;
      },
    },
    creditAccount: {
      findUnique: async () => account,
      create: async () => account,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(account, data),
    },
    creditLot: {
      findMany: async () => [oldMembershipLot],
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        assert.equal(where.id, oldMembershipLot.id, '独立充值 lot 不应被旧套餐换购清理');
        return Object.assign(oldMembershipLot, data);
      },
      updateMany: async () => {
        throw new Error('旧套餐换购不应顺延旧会员积分 lot');
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdLot = { id: 'new-membership-lot', createdAt: paidAt, updatedAt: paidAt, ...data };
        return createdLot;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'new-membership-lot' ? createdLot : null,
      count: async () => 0,
    },
    creditTransaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        transactions.push(data);
        return data;
      },
    },
    membershipEntitlementSnapshot: {
      upsert: async ({ update }: { update: Record<string, unknown> }) => {
        entitlement = { userId: 'user', ...update };
        return entitlement;
      },
      findUnique: async () => entitlement,
    },
  };
  const service = new MembershipService(tx as never, {
    getMembershipCreditPolicy: async () => ({ membershipRefreshCycleDays: 30 }),
  } as never);
  const result = await service.activatePaidMembershipOrder({
    tx: tx as never, userId: 'user', orderId: order.id, paidAt,
  });

  assert.equal(result.grantedCredits, 22000);
  assert.equal(oldMembershipLot.status, 'expired');
  assert.equal(oldMembershipLot.remainingAmount, 0);
  assert.equal(rechargeLot.remainingAmount, 10000);
  assert.equal(account.balance, 32000);
  assert.equal(subscription.currentPeriodStartAt.toISOString(), paidAt.toISOString());
  assert.equal(subscription.currentPeriodEndAt.toISOString(), '2026-09-25T08:00:00.000Z');
  assert.notEqual(subscription.currentPeriodEndAt.toISOString(), originalEndAt.toISOString());
  assert.equal(subscription.activatedAt.toISOString(), paidAt.toISOString());
  assert.equal(subscription.renewalCount, 0);
  assert.equal(changes[0]?.reason, 'user_legacy_monthly_plan_replacement');
  assert.equal(transactions.filter((item) => item.businessType === 'membership_expire').length, 1);
  assert.equal(transactions.filter((item) => item.businessType === 'membership_cycle_switch').length, 1);
}

async function main() {
  await verifyLegacyReplacementActivation();

  const pricedMonthly = await previewFor({
    id: 'old-plan', code: 'old', name: '旧月费', billingCycle: 'monthly', price: '120',
    monthlyQuotaCredits: 1200, signupBonusCredits: 0, dailyGiftCredits: 0,
    metadata: { priceVersion: '2026-08-v2' },
  });
  assert.equal(pricedMonthly.actionType, 'upgrade');
  assert.equal(pricedMonthly.currentPlanPriceVersion, '2026-08-v2');
  assert.equal(pricedMonthly.remainingValue, 0);
  assert.equal(pricedMonthly.payableAmount, 200);

  const legacyMonthlyReplacement = await previewFor({
    id: 'old-plan', code: 'old-monthly', name: '旧专业月费', billingCycle: 'monthly', price: '199',
    monthlyQuotaCredits: 22000, signupBonusCredits: 0, dailyGiftCredits: 0,
    metadata: { priceVersion: 'legacy', planCode: 'vip_199' },
  }, { currentSortOrder: 20, targetSortOrder: 20, targetPlanCode: 'vip_199' });
  assert.equal(legacyMonthlyReplacement.actionType, 'upgrade');
  assert.equal(legacyMonthlyReplacement.legacyPlanReplacement, true);
  assert.equal(legacyMonthlyReplacement.cycleSwitch, true);
  assert.equal(legacyMonthlyReplacement.remainingValue, 0);
  assert.equal(legacyMonthlyReplacement.payableAmount, 200);

  const legacyProfessionalToLowerAnnual = await previewFor({
    id: 'old-plan', code: 'old-monthly', name: '旧专业月费', billingCycle: 'monthly', price: '199',
    monthlyQuotaCredits: 22000, signupBonusCredits: 0, dailyGiftCredits: 0,
    metadata: { priceVersion: 'legacy', planCode: 'vip_199' },
  }, {
    currentSortOrder: 20,
    targetSortOrder: 40,
    targetBillingCycle: 'yearly',
    targetPlanCode: 'vip_69_yearly',
  });
  assert.equal(legacyProfessionalToLowerAnnual.actionType, 'downgrade');

  const legacyAnnual = await previewFor({
    id: 'old-plan', code: 'old-yearly', name: '旧年费', billingCycle: 'yearly', price: '1200',
    monthlyQuotaCredits: 12000, signupBonusCredits: 0, dailyGiftCredits: 0, metadata: { priceVersion: 'legacy' },
  });
  assert.equal(legacyAnnual.remainingValue, 0);
  assert.equal(legacyAnnual.payableAmount, 200);

  const installmentAnnual = await previewFor({
    id: 'old-plan', code: 'new-yearly', name: '新年费', billingCycle: 'yearly', price: '1200',
    monthlyQuotaCredits: 12000, signupBonusCredits: 0, dailyGiftCredits: 0,
    metadata: { priceVersion: '2026-08-v2', creditIssuanceMode: 'yearly_monthly_installments' },
  });
  assert.ok(installmentAnnual.remainingValue > 500 && installmentAnnual.remainingValue < 700);
  assert.ok(installmentAnnual.payableAmount < 0 || installmentAnnual.payableAmount === 0);

  for (const actionType of ['renew', 'downgrade']) {
    const paymentService = Object.create(PaymentService.prototype) as PaymentService & {
      membershipService: { getUserTransitionPreview: () => Promise<Record<string, unknown>> };
      prisma: { membershipPlan: { findFirst: () => Promise<Record<string, unknown>> } };
    };
    paymentService.membershipService = {
      getUserTransitionPreview: async () => ({ actionType }),
    };
    paymentService.prisma = {
      membershipPlan: { findFirst: async () => ({ id: 'target-plan' }) },
    };
    await assert.rejects(
      () => paymentService.createMembershipOrderByPlanCode('user', { planCode: 'target', paymentMethod: 'alipay' }),
      /仅支持购买更高档位/,
    );
  }

  const serviceSource = readFileSync(
    resolve(process.cwd(), 'src/membership/membership.service.ts'),
    'utf8',
  );
  assert.match(
    serviceSource,
    /status: 'active', currentPeriodEndAt: \{ gt: new Date\(\) \}/,
    '已过期但尚未被定时任务收口的订阅不得阻塞新购',
  );

  console.log('membership coverage upgrade verification passed');
}

void main();
