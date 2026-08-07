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

async function previewFor(snapshot: Record<string, unknown>) {
  const currentPlan = plan({ id: 'old-plan', code: 'old', price: { toString: () => '120', valueOf: () => 120 }, sortOrder: 10 });
  const targetPlan = plan({
    id: 'new-plan',
    code: 'new',
    billingCycle: snapshot.billingCycle === 'yearly' ? 'yearly' : 'monthly',
    price: { toString: () => '200', valueOf: () => 200 },
    sortOrder: 20,
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
        currentPeriodStartAt: activeStart,
        currentPeriodEndAt: activeEnd,
        lastOrderId: 'old-order',
        snapshot,
      }),
    },
    paymentOrder: {
      findFirst: async () => ({ amount: { toString: () => '80', valueOf: () => 80 } }),
    },
  };
  const service = new MembershipService(prisma as never, {} as never);
  return service.getUserTransitionPreview('user', 'new');
}

async function main() {
  const pricedMonthly = await previewFor({
    id: 'old-plan', code: 'old', name: '旧月费', billingCycle: 'monthly', price: '120',
    monthlyQuotaCredits: 1200, signupBonusCredits: 0, dailyGiftCredits: 0,
    metadata: { priceVersion: '2026-08-v2' },
  });
  assert.equal(pricedMonthly.actionType, 'upgrade');
  assert.equal(pricedMonthly.currentPlanPriceVersion, '2026-08-v2');
  assert.ok(pricedMonthly.remainingValue > 50 && pricedMonthly.remainingValue < 70);
  assert.ok(pricedMonthly.payableAmount > 130 && pricedMonthly.payableAmount < 150);

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
