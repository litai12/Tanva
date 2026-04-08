import assert from 'node:assert/strict';

import { getDefaultCreditConsumePolicy, listEligibleCreditLots } from '../src/credits/credit-lot-policy';

function date(input: string): Date {
  return new Date(input);
}

function run(): void {
  const ordered = listEligibleCreditLots({
    lots: [
      {
        id: 'gift_lot',
        sourceType: 'gift',
        validityType: 'fixed_window',
        scopeType: 'global',
        scopeValue: null,
        totalAmount: 50,
        remainingAmount: 50,
        grantedAt: date('2026-04-08T00:00:00.000Z'),
        activeAt: date('2026-04-08T00:00:00.000Z'),
        expiresAt: date('2026-04-15T00:00:00.000Z'),
        priority: 0,
        status: 'active',
      },
      {
        id: 'fixed_lot',
        sourceType: 'recharge',
        validityType: 'fixed_window',
        scopeType: 'global',
        scopeValue: null,
        totalAmount: 1000,
        remainingAmount: 1000,
        grantedAt: date('2026-04-08T00:00:00.000Z'),
        activeAt: date('2026-04-08T00:00:00.000Z'),
        expiresAt: date('2028-04-08T00:00:00.000Z'),
        priority: 0,
        status: 'active',
      },
      {
        id: 'monthly_lot',
        sourceType: 'subscription',
        validityType: 'fixed_window',
        scopeType: 'global',
        scopeValue: null,
        totalAmount: 500,
        remainingAmount: 500,
        grantedAt: date('2026-04-08T00:00:00.000Z'),
        activeAt: date('2026-04-08T00:00:00.000Z'),
        expiresAt: date('2026-05-08T00:00:00.000Z'),
        priority: -100,
        status: 'active',
      },
      {
        id: 'vip_monthly_lot',
        sourceType: 'subscription',
        validityType: 'membership_bound',
        scopeType: 'global',
        scopeValue: null,
        totalAmount: 7000,
        remainingAmount: 7000,
        grantedAt: date('2026-04-08T00:00:00.000Z'),
        activeAt: date('2026-04-08T00:00:00.000Z'),
        expiresAt: date('2026-05-08T00:00:00.000Z'),
        priority: 0,
        status: 'active',
      },
    ],
    now: date('2026-04-09T00:00:00.000Z'),
    policy: getDefaultCreditConsumePolicy(),
  });

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['vip_monthly_lot', 'monthly_lot', 'gift_lot', 'fixed_lot'],
  );
}

run();
console.log('credit consume priority doc order tests passed');
