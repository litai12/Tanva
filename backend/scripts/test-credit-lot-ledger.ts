import assert from 'node:assert/strict';

import type { CreditLotCandidate } from '../src/credits/credit-lot-policy';
import {
  applyLotDeductionsToSnapshots,
  applyLotRestorationsToSnapshots,
  buildHybridCreditDeductionPlan,
} from '../src/credits/credit-lot-ledger';

function iso(input: string): Date {
  return new Date(input);
}

function lot(
  id: string,
  overrides: Partial<CreditLotCandidate> = {},
): CreditLotCandidate {
  return {
    id,
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
  const lots: CreditLotCandidate[] = [
    lot('membership', {
      sourceType: 'subscription',
      validityType: 'membership_bound',
      remainingAmount: 50,
      expiresAt: iso('2026-04-20T00:00:00.000Z'),
    }),
    lot('gift', {
      sourceType: 'gift',
      validityType: 'fixed_window',
      remainingAmount: 70,
      expiresAt: iso('2026-04-15T00:00:00.000Z'),
    }),
  ];

  const plan = buildHybridCreditDeductionPlan({
    accountBalance: 200,
    amount: 150,
    lots,
    now: iso('2026-04-08T00:00:00.000Z'),
  });

  assert.equal(plan.sufficient, true);
  assert.equal(plan.totalDeducted, 150);
  assert.deepEqual(plan.deductions, [
    { kind: 'lot', lotId: 'membership', amount: 50 },
    { kind: 'lot', lotId: 'gift', amount: 70 },
    { kind: 'legacy_balance', amount: 30 },
  ]);

  const updatedLots = applyLotDeductionsToSnapshots({
    lots,
    deductions: plan.deductions,
  });

  assert.deepEqual(
    updatedLots.map((item: { id: string; remainingAmount: number; status: string }) => ({
      id: item.id,
      remainingAmount: item.remainingAmount,
      status: item.status,
    })),
    [
      { id: 'membership', remainingAmount: 0, status: 'exhausted' },
      { id: 'gift', remainingAmount: 0, status: 'exhausted' },
    ],
  );

  const restoredLots = applyLotRestorationsToSnapshots({
    lots: updatedLots,
    deductions: plan.deductions,
  });

  assert.deepEqual(
    restoredLots.map((item: { id: string; remainingAmount: number; status: string }) => ({
      id: item.id,
      remainingAmount: item.remainingAmount,
      status: item.status,
    })),
    [
      { id: 'membership', remainingAmount: 50, status: 'active' },
      { id: 'gift', remainingAmount: 70, status: 'active' },
    ],
  );

  const insufficientPlan = buildHybridCreditDeductionPlan({
    accountBalance: 80,
    amount: 120,
    lots,
    now: iso('2026-04-08T00:00:00.000Z'),
  });

  assert.equal(insufficientPlan.sufficient, false);
  assert.equal(insufficientPlan.totalDeducted, 80);
  assert.equal(insufficientPlan.shortfall, 40);
}

run();
console.log('credit lot ledger tests passed');
