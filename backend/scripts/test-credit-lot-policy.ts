import assert from 'node:assert/strict';

import {
  buildDeductionPlan,
  getDefaultCreditConsumePolicy,
  type CreditLotCandidate,
} from '../src/credits/credit-lot-policy';

function iso(input: string): Date {
  return new Date(input);
}

function buildLot(overrides: Partial<CreditLotCandidate> & { id: string }): CreditLotCandidate {
  return {
    id: overrides.id,
    sourceType: overrides.sourceType ?? 'gift',
    validityType: overrides.validityType ?? 'fixed_window',
    scopeType: overrides.scopeType ?? 'global',
    scopeValue: overrides.scopeValue ?? null,
    totalAmount: overrides.totalAmount ?? 100,
    remainingAmount: overrides.remainingAmount ?? 100,
    grantedAt: overrides.grantedAt ?? iso('2026-04-01T00:00:00.000Z'),
    activeAt: overrides.activeAt ?? iso('2026-04-01T00:00:00.000Z'),
    expiresAt: overrides.expiresAt ?? iso('2026-04-30T00:00:00.000Z'),
    priority: overrides.priority ?? 0,
    status: overrides.status ?? 'active',
  };
}

function run(): void {
  const policy = getDefaultCreditConsumePolicy();
  const now = iso('2026-04-08T00:00:00.000Z');

  const lots: CreditLotCandidate[] = [
    buildLot({
      id: 'expired-lot',
      remainingAmount: 60,
      expiresAt: iso('2026-04-01T00:00:00.000Z'),
    }),
    buildLot({
      id: 'permanent-lot',
      sourceType: 'recharge',
      validityType: 'permanent',
      remainingAmount: 100,
      expiresAt: null,
    }),
    buildLot({
      id: 'gift-lot',
      sourceType: 'gift',
      validityType: 'fixed_window',
      remainingAmount: 70,
      expiresAt: iso('2026-04-15T00:00:00.000Z'),
    }),
    buildLot({
      id: 'membership-lot',
      sourceType: 'subscription',
      validityType: 'membership_bound',
      remainingAmount: 50,
      expiresAt: iso('2026-04-20T00:00:00.000Z'),
    }),
  ];

  const plan = buildDeductionPlan({
    lots,
    amount: 120,
    now,
    policy,
  });

  assert.equal(plan.totalDeducted, 120);
  assert.deepEqual(
    plan.deductions.map((item: { lotId: string; amount: number }) => ({
      lotId: item.lotId,
      amount: item.amount,
    })),
    [
      { lotId: 'membership-lot', amount: 50 },
      { lotId: 'gift-lot', amount: 70 },
    ],
  );

  assert.equal(
    plan.orderedLots.some((lot: { id: string }) => lot.id === 'expired-lot'),
    false,
    'expired lots must not be considered',
  );

  const sameValidityPlan = buildDeductionPlan({
    lots: [
      buildLot({
        id: 'later-expire-gift',
        sourceType: 'gift',
        validityType: 'fixed_window',
        remainingAmount: 30,
        expiresAt: iso('2026-04-25T00:00:00.000Z'),
      }),
      buildLot({
        id: 'sooner-expire-gift',
        sourceType: 'gift',
        validityType: 'fixed_window',
        remainingAmount: 30,
        expiresAt: iso('2026-04-09T00:00:00.000Z'),
      }),
    ],
    amount: 20,
    now,
    policy,
  });

  assert.deepEqual(sameValidityPlan.deductions, [
    {
      lotId: 'sooner-expire-gift',
      amount: 20,
    },
  ]);

  const insufficient = buildDeductionPlan({
    lots: [
      buildLot({
        id: 'small-lot',
        sourceType: 'gift',
        validityType: 'fixed_window',
        remainingAmount: 10,
      }),
    ],
    amount: 50,
    now,
    policy,
  });

  assert.equal(insufficient.sufficient, false);
  assert.equal(insufficient.shortfall, 40);
}

run();
console.log('credit lot policy tests passed');
