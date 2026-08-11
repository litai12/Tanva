import assert from 'node:assert/strict';
import { buildRechargeBonusCreditLotData } from '../src/credits/credit-lot-grants';
import { PaymentService } from '../src/payment/payment.service';
import { PaymentMethod } from '../src/payment/dto/payment.dto';
import { MembershipService } from '../src/membership/membership.service';
import { AdminService } from '../src/admin/admin.service';
import {
  calculateRechargeGrant,
  RECHARGE_BONUS_POLICY_VERSION,
  RECHARGE_BONUS_RATE,
  resolveRechargeOrderGrant,
} from '../src/payment/recharge-bonus-policy';
import {
  findHighestTierYearlyPlan,
  isHighestTierYearlyPlan,
} from '../src/membership/vip-entitlement-policy';

assert.equal(RECHARGE_BONUS_RATE, 0.2);
assert.deepEqual(calculateRechargeGrant(2_500, false), {
  baseCredits: 2_500,
  bonusCredits: 0,
  totalCredits: 2_500,
});
assert.deepEqual(calculateRechargeGrant(2_500, true), {
  baseCredits: 2_500,
  bonusCredits: 500,
  totalCredits: 3_000,
});
assert.deepEqual(calculateRechargeGrant(10_000, true), {
  baseCredits: 10_000,
  bonusCredits: 2_000,
  totalCredits: 12_000,
});
assert.throws(() => calculateRechargeGrant(0, true), /positive integer/);

const tierPlans = [
  { id: 'monthly-high', billingCycle: 'monthly', sortOrder: 30, price: 599 },
  { id: 'yearly-low', billingCycle: 'yearly', sortOrder: 10, price: 699 },
  { id: 'yearly-high', billingCycle: 'yearly', sortOrder: 30, price: 5999 },
];
assert.equal(findHighestTierYearlyPlan(tierPlans)?.id, 'yearly-high');
assert.equal(isHighestTierYearlyPlan('yearly-low', tierPlans), false);
assert.equal(isHighestTierYearlyPlan('yearly-high', tierPlans), true);

const bonusSnapshot = {
  rechargeBonusPolicyVersion: RECHARGE_BONUS_POLICY_VERSION,
  rechargeBaseCredits: 2_500,
  rechargeBonusCredits: 500,
  rechargeTotalCredits: 3_000,
};
assert.deepEqual(resolveRechargeOrderGrant(3_000, bonusSnapshot), {
  baseCredits: 2_500,
  bonusCredits: 500,
  totalCredits: 3_000,
});
assert.deepEqual(resolveRechargeOrderGrant(2_500, null), {
  baseCredits: 2_500,
  bonusCredits: 0,
  totalCredits: 2_500,
});
assert.throws(
  () => resolveRechargeOrderGrant(3_000, { ...bonusSnapshot, rechargeBonusCredits: 499 }),
  /snapshot is invalid/,
);

const permanentBonusLot = buildRechargeBonusCreditLotData({
  accountId: 'account-1',
  amount: 500,
  orderId: 'order-1',
});
assert.equal(permanentBonusLot.sourceType, 'gift');
assert.equal(permanentBonusLot.validityType, 'permanent');
assert.equal(permanentBonusLot.expiresAt, null);
assert.equal(permanentBonusLot.durationDays, null);

async function verifyPaymentServiceIntegration() {
  let createdOrderData: Record<string, unknown> | null = null;
  let bonusEligible = false;
  const prisma = {
    paymentOrder: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdOrderData = data;
        return {
          id: 'order-1',
          createdAt: new Date('2026-08-11T00:00:00.000Z'),
          ...data,
        };
      },
    },
  };
  const paymentService = new PaymentService(
    prisma as never,
    { get: () => undefined } as never,
    {} as never,
    {
      getRechargeBonusEligibility: async () => ({
        eligible: bonusEligible,
        source: bonusEligible ? 'highest_yearly_membership' : null,
      }),
    } as never,
    {} as never,
  );
  (paymentService as unknown as { generateAlipayQrCode: () => Promise<string> })
    .generateAlipayQrCode = async () => 'data:image/png;base64,test';

  const packages = await paymentService.getRechargePackages('free-user');
  assert.equal(packages.discountRate, 1);
  assert.equal(packages.membershipDiscountApplied, false);
  assert.equal(packages.bonusRate, 0);
  assert.equal(packages.rechargeBonusEligible, false);
  assert.equal(packages.packages[0].price, 25);
  assert.equal(packages.packages[0].originalPrice, 25);
  assert.equal(packages.packages[0].credits, 2_500);
  assert.equal(packages.packages[0].bonusCredits, 0);
  assert.equal(packages.packages[0].totalCredits, 2_500);
  assert.deepEqual(
    packages.packages.map((item) => item.price),
    [25, 50, 100, 500, 1_000, 5_000],
  );
  assert.deepEqual(
    packages.packages.map((item) => item.totalCredits),
    [2_500, 5_000, 10_000, 50_000, 100_000, 500_000],
  );
  assert.equal(packages.packages.some((item) => item.price === 200), false);

  await assert.rejects(
    paymentService.createOrder('user-1', {
      amount: 20,
      credits: 2_500,
      paymentMethod: PaymentMethod.ALIPAY,
    }),
    /积分充值金额与积分数量不匹配/,
  );

  const ordinaryOrder = await paymentService.createOrder('user-1', {
    amount: 25,
    credits: 2_500,
    paymentMethod: PaymentMethod.ALIPAY,
  });
  assert.equal(ordinaryOrder.amount, 25);
  assert.equal(ordinaryOrder.credits, 2_500);
  let metadata = createdOrderData?.metadata as Record<string, unknown>;
  assert.equal(metadata.rechargeBonusEligible, false);
  assert.equal(metadata.rechargeBonusCredits, 0);

  bonusEligible = true;
  const eligiblePackages = await paymentService.getRechargePackages('eligible-user');
  assert.equal(eligiblePackages.rechargeBonusEligible, true);
  assert.equal(eligiblePackages.bonusRate, 0.2);
  assert.deepEqual(
    eligiblePackages.packages.map((item) => item.totalCredits),
    [3_000, 6_000, 12_000, 60_000, 120_000, 600_000],
  );

  const order = await paymentService.createOrder('eligible-user', {
    amount: 25,
    credits: 2_500,
    paymentMethod: PaymentMethod.ALIPAY,
  });
  assert.equal(order.amount, 25);
  assert.equal(order.credits, 3_000);
  metadata = createdOrderData?.metadata as Record<string, unknown>;
  assert.equal(metadata.rechargeBonusEligible, true);
  assert.equal(metadata.rechargeBaseCredits, 2_500);
  assert.equal(metadata.rechargeBonusCredits, 500);
  assert.equal(metadata.rechargeTotalCredits, 3_000);
  assert.equal(metadata.rechargeBonusPolicyVersion, RECHARGE_BONUS_POLICY_VERSION);
}

async function verifyEligibilityMatrixAndWhitelistEntitlement() {
  let user = {
    vipEntitlementWhitelist: false,
    vipRechargeBonusEnabled: false,
  };
  let membershipPlanId: string | null = null;
  const plans = [
    {
      id: 'yearly-low',
      code: 'vip_69_yearly',
      name: '年卡基础',
      billingCycle: 'yearly',
      sortOrder: 10,
      monthlyQuotaCredits: 6_900,
      dailyGiftCredits: 10,
      signupBonusCredits: 0,
      price: 699,
      metadata: { priceVersion: '2026-08-v2', tierRank: 10 },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'yearly-high',
      code: 'vip_599_yearly',
      name: '年卡旗舰',
      billingCycle: 'yearly',
      sortOrder: 30,
      monthlyQuotaCredits: 59_900,
      dailyGiftCredits: 30,
      signupBonusCredits: 0,
      price: 5_999,
      metadata: { priceVersion: '2026-08-v2', tierRank: 30, pauseGiftDecay: true },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const prisma = {
    user: {
      findUnique: async () => user,
    },
    userMembershipSubscription: {
      findFirst: async () =>
        membershipPlanId ? { membershipPlanId } : null,
      count: async () => 0,
    },
    membershipPlan: {
      findMany: async () => plans,
      findUnique: async ({ where }: { where: { id: string } }) =>
        plans.find((plan) => plan.id === where.id) ?? null,
    },
    membershipEntitlementSnapshot: {
      findUnique: async () => null,
    },
  };
  const service = new MembershipService(prisma as never, {} as never);

  assert.deepEqual(await service.getRechargeBonusEligibility('ordinary'), {
    eligible: false,
    source: null,
  });

  membershipPlanId = 'yearly-low';
  assert.equal((await service.getRechargeBonusEligibility('lower-yearly')).eligible, false);

  membershipPlanId = 'yearly-high';
  assert.deepEqual(await service.getRechargeBonusEligibility('highest-yearly'), {
    eligible: true,
    source: 'highest_yearly_membership',
  });

  membershipPlanId = null;
  user = { vipEntitlementWhitelist: true, vipRechargeBonusEnabled: false };
  assert.equal((await service.getRechargeBonusEligibility('whitelist-no-bonus')).eligible, false);
  const entitlement = await service.getMembershipEntitlement('whitelist-no-bonus');
  assert.equal(entitlement.membershipStatus, 'active');
  assert.equal(entitlement.currentPlanCode, 'vip_599_yearly');
  assert.equal(entitlement.hasActiveSubscription, false);
  assert.equal(entitlement.isVipEntitlementWhitelisted, true);
  assert.equal(entitlement.vipRechargeBonusEnabled, false);

  user = { vipEntitlementWhitelist: false, vipRechargeBonusEnabled: true };
  assert.deepEqual(await service.getRechargeBonusEligibility('whitelist-with-bonus'), {
    eligible: true,
    source: 'vip_whitelist',
  });
}

async function verifyConfigurableUnifiedWhitelist() {
  let stored = {
    id: 'user-whitelist',
    phone: '13800000000',
    email: null,
    name: '白名单用户',
    noWatermark: true,
    vipEntitlementWhitelist: false,
    vipRechargeBonusEnabled: false,
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
  };
  const prisma = {
    user: {
      update: async ({ data }: { data: Partial<typeof stored> }) => {
        stored = { ...stored, ...data, updatedAt: new Date() };
        return stored;
      },
      findMany: async () => [stored],
      count: async () => 1,
    },
  };
  const service = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const legacyWatermarkUser = await service.getWhitelist();
  assert.deepEqual(legacyWatermarkUser.users[0].tags, ['去水印']);

  const configured = await service.upsertWhitelistUser('user-whitelist', {
    noWatermark: true,
    vipEntitlementWhitelist: true,
    vipRechargeBonusEnabled: false,
  });
  assert.deepEqual(configured.tags, ['去水印', '最高档年卡权益']);
  assert.equal(configured.vipRechargeBonusEnabled, false);

  const bonusConfigured = await service.upsertWhitelistUser('user-whitelist', {
    noWatermark: false,
    vipEntitlementWhitelist: true,
    vipRechargeBonusEnabled: true,
  });
  assert.deepEqual(bonusConfigured.tags, ['最高档年卡权益', '充值到账 120%']);

  await assert.rejects(
    service.upsertWhitelistUser('user-whitelist', {
      noWatermark: false,
      vipEntitlementWhitelist: false,
      vipRechargeBonusEnabled: false,
    }),
    /至少选择一项白名单权益/,
  );

  const removed = await service.removeWhitelistUser('user-whitelist');
  assert.deepEqual(removed.tags, []);
  assert.equal(stored.noWatermark, false);
  assert.equal(stored.vipEntitlementWhitelist, false);
  assert.equal(stored.vipRechargeBonusEnabled, false);
}

async function verifyPaymentSuccessSplitAndIdempotency() {
  let orderStatus = 'pending';
  const createdLots: Array<Record<string, unknown>> = [];
  const createdTransactions: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];
  const orderMetadata = {
    rechargeBonusPolicyVersion: RECHARGE_BONUS_POLICY_VERSION,
    rechargeBonusRate: RECHARGE_BONUS_RATE,
    rechargeBaseCredits: 2_500,
    rechargeBonusCredits: 500,
    rechargeTotalCredits: 3_000,
  };
  const tx = {
    $queryRaw: async () => [],
    paymentOrder: {
      findUnique: async () => ({
        id: 'order-paid-1',
        userId: 'user-1',
        orderNo: 'PAY-BONUS-1',
        orderType: 'recharge',
        // Always return the stale pending snapshot to simulate two concurrent
        // processors that both read before either transaction commits.
        status: 'pending',
        credits: 3_000,
        paymentMethod: PaymentMethod.ALIPAY,
        tradeNo: null,
        metadata: orderMetadata,
      }),
      count: async () => 0,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (orderStatus === 'paid') return { count: 0 };
        if (data.status === 'paid') orderStatus = 'paid';
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    creditAccount: {
      findUnique: async () => ({
        id: 'account-1',
        userId: 'user-1',
        balance: 100,
        totalEarned: 100,
      }),
      create: async () => {
        throw new Error('existing account should be reused');
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        accountUpdates.push(data);
        return data;
      },
    },
    creditLot: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdLots.push(data);
        return { id: `lot-${createdLots.length}`, ...data };
      },
    },
    creditTransaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdTransactions.push(data);
        return data;
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
  };
  let referralRewards = 0;
  const paymentService = new PaymentService(
    prisma as never,
    { get: () => undefined } as never,
    {
      rewardInviterForInviteeFirstRechargeInTransaction: async () => {
        referralRewards += 1;
      },
    } as never,
    {} as never,
    {
      getMembershipCreditPolicy: async () => ({ fixedCreditExpireDays: 730 }),
    } as never,
  );

  const processPaymentSuccess = (
    paymentService as unknown as {
      processPaymentSuccess: (
        orderId: string,
        userId: string,
        credits: number,
        options?: Record<string, unknown>,
      ) => Promise<void>;
    }
  ).processPaymentSuccess.bind(paymentService);

  await processPaymentSuccess('order-paid-1', 'user-1', 3_000, {
    source: 'verification',
    paymentMethod: PaymentMethod.ALIPAY,
    paidAt: new Date('2026-08-11T00:00:00.000Z'),
  });
  assert.equal(createdLots.length, 2);
  assert.equal(createdLots[0].sourceType, 'recharge');
  assert.equal(createdLots[0].totalAmount, 2_500);
  assert.equal(createdLots[1].sourceType, 'gift');
  assert.equal(createdLots[1].validityType, 'permanent');
  assert.equal(createdLots[1].totalAmount, 500);
  assert.equal(createdLots[1].expiresAt, null);
  assert.deepEqual(
    createdTransactions.map((item) => item.amount),
    [2_500, 500],
  );
  assert.deepEqual(accountUpdates[0], {
    balance: 3_100,
    totalEarned: 3_100,
  });
  assert.equal(referralRewards, 1);

  await processPaymentSuccess('order-paid-1', 'user-1', 3_000);
  assert.equal(createdLots.length, 2);
  assert.equal(createdTransactions.length, 2);
  assert.equal(accountUpdates.length, 1);
  assert.equal(referralRewards, 1);
}

Promise.all([
  verifyPaymentServiceIntegration(),
  verifyEligibilityMatrixAndWhitelistEntitlement(),
  verifyConfigurableUnifiedWhitelist(),
  verifyPaymentSuccessSplitAndIdempotency(),
])
  .then(() => console.log('recharge 20% permanent bonus policy verification passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
