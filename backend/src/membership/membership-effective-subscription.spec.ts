import assert from 'node:assert/strict';
import { MembershipService } from './membership.service';

// 复现 2026-10-24 线上事故：订阅 currentPeriodEndAt 已过、cron 尚未把 status 改为 expired。
// 会员展示/下单/激活必须与积分侧共用“生效订阅”口径。

const DAY = 24 * 60 * 60 * 1000;

function matchesDate(value: Date, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond.lte && !(value <= cond.lte)) return false;
  if (cond.lt && !(value < cond.lt)) return false;
  if (cond.gte && !(value >= cond.gte)) return false;
  if (cond.gt && !(value > cond.gt)) return false;
  return true;
}

function matchesSubscription(sub: any, where: any = {}): boolean {
  if (where.id !== undefined && sub.id !== where.id) return false;
  if (where.userId !== undefined && sub.userId !== where.userId) return false;
  if (where.status !== undefined && sub.status !== where.status) return false;
  return (
    matchesDate(sub.currentPeriodStartAt, where.currentPeriodStartAt) &&
    matchesDate(sub.currentPeriodEndAt, where.currentPeriodEndAt)
  );
}

function createHarness(now: Date) {
  const plan = {
    id: 'plan-199',
    code: 'vip_199_monthly',
    name: '199 月卡',
    billingCycle: 'monthly',
    price: 199,
    monthlyQuotaCredits: 20000,
    signupBonusCredits: 0,
    dailyGiftCredits: 100,
    sortOrder: 20,
    metadata: { priceVersion: '2026-08-v2' },
    isActive: true,
  };
  const subscriptions: any[] = [
    {
      id: 'sub-elapsed',
      userId: 'u1',
      membershipPlanId: plan.id,
      status: 'active',
      periodType: 'monthly',
      currentPeriodStartAt: new Date(now.getTime() - 30 * DAY - 10 * 60 * 1000),
      currentPeriodEndAt: new Date(now.getTime() - 10 * 60 * 1000),
      expiredAt: null,
      renewalCount: 0,
      createdAt: new Date(now.getTime() - 30 * DAY),
    },
  ];
  const snapshot: any = {
    userId: 'u1',
    currentPlanCode: plan.code,
    membershipStatus: 'active',
    currentPeriodStartAt: subscriptions[0].currentPeriodStartAt,
    currentPeriodEndAt: subscriptions[0].currentPeriodEndAt,
    pauseGiftDecay: false,
  };
  const account = { id: 'acc1', userId: 'u1', balance: 0, totalEarned: 0 };

  const prisma: any = {
    $queryRaw: async () => [],
    user: {
      findUnique: async () => ({ vipEntitlementWhitelist: false, vipRechargeBonusEnabled: false }),
      findFirst: async () => null,
    },
    membershipPlan: {
      findFirst: async ({ where }: any) => (where.code === plan.code ? plan : null),
      findUnique: async ({ where }: any) => (where.id === plan.id ? plan : null),
      findMany: async () => [plan],
    },
    userMembershipSubscription: {
      findFirst: async ({ where }: any) =>
        subscriptions
          .filter((sub) => matchesSubscription(sub, where))
          .sort((a, b) => b.currentPeriodEndAt.getTime() - a.currentPeriodEndAt.getTime())[0] ?? null,
      findMany: async ({ where }: any) => subscriptions.filter((sub) => matchesSubscription(sub, where)),
      count: async ({ where }: any) => subscriptions.filter((sub) => matchesSubscription(sub, where)).length,
      update: async ({ where, data }: any) => Object.assign(subscriptions.find((s) => s.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const rows = subscriptions.filter((sub) => matchesSubscription(sub, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      create: async ({ data }: any) => {
        const row = { id: `sub-${subscriptions.length + 1}`, renewalCount: 0, createdAt: now, ...data };
        subscriptions.push(row);
        return row;
      },
    },
    membershipEntitlementSnapshot: {
      findUnique: async () => snapshot,
      upsert: async ({ update }: any) => Object.assign(snapshot, update),
    },
    membershipSubscriptionChange: { findFirst: async () => null },
    creditAccount: {
      findUnique: async () => account,
      update: async ({ data }: any) => Object.assign(account, data),
    },
    creditLot: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => ({ id: 'lot-new', ...data }),
    },
    creditTransaction: { create: async () => ({}) },
    paymentOrder: {
      findUnique: async () => ({
        id: 'order-1',
        orderType: 'membership',
        membershipPlanId: plan.id,
        subscriptionId: null,
        planSnapshot: null,
        metadata: { membershipTransitionType: 'subscribe' },
      }),
    },
  };

  const service: any = Object.assign(Object.create(MembershipService.prototype), {
    prisma,
    businessPolicyService: {
      getMembershipCreditPolicy: async () => ({ membershipRefreshCycleDays: 30 }),
    },
  });
  service.getNextChange = async () => null;
  service.getCreditBalances = async () => ({
    freeCredits: 0, rechargeCredits: 0, subscriptionCredits: 0, giftCredits: 0, fixedCredits: 0, totalCredits: 0,
  });

  return { service, prisma, subscriptions, snapshot };
}

async function main() {
  const now = new Date();

  {
    const { service } = createHarness(now);
    const current = await service.getCurrentMembership('u1');
    assert.equal(current.subscription, null, '已过结束时间的订阅不能再展示为当前会员');
    assert.equal(current.plan, null);
    assert.equal(current.entitlement.membershipStatus, 'inactive', '不能沿用滞后的 active 快照');
    assert.equal(current.entitlement.hasActiveSubscription, false, '购买页闸门必须与积分侧口径一致');

    const preview = await service.getUserTransitionPreview('u1', 'vip_199_monthly');
    assert.equal(preview.actionType, 'subscribe', '到期后可直接重新购买同档套餐');
  }

  {
    const { service, prisma, subscriptions } = createHarness(now);
    const result = await service.activatePaidMembershipOrder({
      tx: prisma,
      orderId: 'order-1',
      userId: 'u1',
      paidAt: now,
    });
    const elapsed = subscriptions.find((s) => s.id === 'sub-elapsed');
    assert.equal(elapsed.status, 'expired', '激活前先结算已到期订阅');
    const created = subscriptions.find((s) => s.id === result.subscriptionId);
    assert.notEqual(result.subscriptionId, 'sub-elapsed', '不能在已到期订阅上顺延');
    assert.equal(created.currentPeriodStartAt.getTime(), now.getTime());
    assert.equal(created.currentPeriodEndAt.getTime(), now.getTime() + 30 * DAY, '新周期从支付时刻起算完整 30 天');
  }

  {
    const { service, prisma, subscriptions } = createHarness(now);
    prisma.paymentOrder.findUnique = async () => ({
      id: 'order-2',
      orderType: 'membership',
      membershipPlanId: 'plan-199',
      subscriptionId: null,
      planSnapshot: null,
      metadata: { membershipTransitionType: 'upgrade' },
    });
    const result = await service.activatePaidMembershipOrder({
      tx: prisma,
      orderId: 'order-2',
      userId: 'u1',
      paidAt: now,
    });
    const created = subscriptions.find((s) => s.id === result.subscriptionId);
    assert.equal(created.status, 'active', '升级单支付时原订阅已到期，按新开通激活而不是报错');
    assert.equal(created.currentPeriodEndAt.getTime(), now.getTime() + 30 * DAY);
  }

  console.log('membership effective subscription spec passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
