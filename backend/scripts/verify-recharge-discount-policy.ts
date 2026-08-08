import assert from 'node:assert/strict';
import {
  HIGHEST_TIER_YEARLY_RECHARGE_DISCOUNT_RATE,
  isHighestTierYearlyRechargeDiscountEligible,
  resolveRechargeDiscountPlanTierRank,
} from '../src/payment/recharge-discount-policy';
import { PaymentService } from '../src/payment/payment.service';
import { PaymentMethod } from '../src/payment/dto/payment.dto';

const plans = [
  { id: 'monthly-high', billingCycle: 'monthly', sortOrder: 30, monthlyQuotaCredits: 60_000, price: 599 },
  { id: 'yearly-low', billingCycle: 'yearly', sortOrder: 40, monthlyQuotaCredits: 84_000, price: 662 },
  { id: 'yearly-mid', billingCycle: 'yearly', sortOrder: 50, monthlyQuotaCredits: 240_000, price: 1_910 },
  { id: 'yearly-high', billingCycle: 'yearly', sortOrder: 60, monthlyQuotaCredits: 720_000, price: 5_750 },
];

assert.equal(HIGHEST_TIER_YEARLY_RECHARGE_DISCOUNT_RATE, 0.8);
assert.equal(isHighestTierYearlyRechargeDiscountEligible('monthly-high', plans), false);
assert.equal(isHighestTierYearlyRechargeDiscountEligible('yearly-low', plans), false);
assert.equal(isHighestTierYearlyRechargeDiscountEligible('yearly-mid', plans), false);
assert.equal(isHighestTierYearlyRechargeDiscountEligible('yearly-high', plans), true);
assert.equal(isHighestTierYearlyRechargeDiscountEligible('inactive-history-plan', plans), false);

const explicitTierPlans = [
  { id: 'annual-visible-first', billingCycle: 'annual', sortOrder: 999, metadata: { tierRank: 1 } },
  { id: 'annual-real-highest', billingCycle: 'annual', sortOrder: 1, metadata: { tierRank: 3 } },
];
assert.equal(resolveRechargeDiscountPlanTierRank(explicitTierPlans[0]), 1);
assert.equal(isHighestTierYearlyRechargeDiscountEligible('annual-visible-first', explicitTierPlans), false);
assert.equal(isHighestTierYearlyRechargeDiscountEligible('annual-real-highest', explicitTierPlans), true);

async function verifyPaymentServiceIntegration() {
  let activeSubscriptionPlanId: string | null = 'yearly-mid';
  const prisma = {
    userMembershipSubscription: {
      findFirst: async () =>
        activeSubscriptionPlanId ? { membershipPlanId: activeSubscriptionPlanId } : null,
    },
  };
  const membershipService = {
    listActivePlans: async () => plans,
  };
  const paymentService = new PaymentService(
    prisma as never,
    { get: () => undefined } as never,
    {} as never,
    membershipService as never,
    {} as never,
  );

  const middleYearlyPackages = await paymentService.getRechargePackages('user-1');
  assert.equal(middleYearlyPackages.discountRate, 1);
  assert.equal(middleYearlyPackages.membershipDiscountApplied, false);
  assert.equal(middleYearlyPackages.packages[0].price, 25);
  assert.equal(middleYearlyPackages.packages[0].tag, null);
  await assert.rejects(
    paymentService.createOrder('user-1', {
      amount: 20,
      credits: 2_500,
      paymentMethod: PaymentMethod.ALIPAY,
    }),
    /积分充值金额与积分数量不匹配/,
  );

  activeSubscriptionPlanId = 'yearly-high';
  const highestYearlyPackages = await paymentService.getRechargePackages('user-1');
  assert.equal(highestYearlyPackages.discountRate, 0.8);
  assert.equal(highestYearlyPackages.membershipDiscountApplied, true);
  assert.equal(highestYearlyPackages.packages[0].price, 20);
  assert.equal(highestYearlyPackages.packages[0].originalPrice, 25);
  assert.equal(highestYearlyPackages.packages[0].tag, '最高档年卡 8 折');
  await assert.rejects(
    paymentService.createOrder('user-1', {
      amount: 25,
      credits: 2_500,
      paymentMethod: PaymentMethod.ALIPAY,
    }),
    /积分充值金额与最高档年卡折扣不匹配/,
  );

  activeSubscriptionPlanId = null;
  const freeUserPackages = await paymentService.getRechargePackages('user-1');
  assert.equal(freeUserPackages.discountRate, 1);
}

verifyPaymentServiceIntegration()
  .then(() => console.log('highest-tier yearly recharge discount policy verification passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
