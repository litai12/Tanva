import {
  buildDeductionPlan,
  getDefaultCreditConsumePolicy,
  type CreditDeductionPlan,
  type CreditConsumePolicy,
  type CreditConsumeScope,
  type CreditLotCandidate,
  type CreditLotStatus,
} from './credit-lot-policy';

export interface HybridCreditDeduction {
  kind: 'lot' | 'legacy_balance';
  lotId?: string;
  amount: number;
}

export interface HybridCreditDeductionPlan {
  orderedLots: CreditLotCandidate[];
  deductions: HybridCreditDeduction[];
  totalDeducted: number;
  sufficient: boolean;
  shortfall: number;
}

export function buildHybridCreditDeductionPlan(params: {
  accountBalance: number;
  amount: number;
  lots: CreditLotCandidate[];
  now?: Date;
  scope?: CreditConsumeScope;
  policy?: CreditConsumePolicy;
}): HybridCreditDeductionPlan {
  const requestedAmount = Math.max(0, Math.floor(params.amount));
  const accountBalance = Math.max(0, Math.floor(params.accountBalance));
  const cappedAmount = Math.min(requestedAmount, accountBalance);
  const policy = params.policy ?? getDefaultCreditConsumePolicy();

  const lotPlan: CreditDeductionPlan = buildDeductionPlan({
    lots: params.lots,
    amount: cappedAmount,
    now: params.now,
    scope: params.scope,
    policy,
  });

  const deductions: HybridCreditDeduction[] = lotPlan.deductions.map((item) => ({
    kind: 'lot',
    lotId: item.lotId,
    amount: item.amount,
  }));

  const legacyAmount = cappedAmount - lotPlan.totalDeducted;
  if (legacyAmount > 0) {
    deductions.push({
      kind: 'legacy_balance',
      amount: legacyAmount,
    });
  }

  return {
    orderedLots: lotPlan.orderedLots,
    deductions,
    totalDeducted: cappedAmount,
    sufficient: cappedAmount === requestedAmount,
    shortfall: requestedAmount - cappedAmount,
  };
}

export function applyLotDeductionsToSnapshots(params: {
  lots: CreditLotCandidate[];
  deductions: HybridCreditDeduction[];
}): CreditLotCandidate[] {
  const deductionByLotId = new Map<string, number>();

  for (const deduction of params.deductions) {
    if (deduction.kind !== 'lot' || !deduction.lotId || deduction.amount <= 0) continue;
    deductionByLotId.set(
      deduction.lotId,
      (deductionByLotId.get(deduction.lotId) ?? 0) + deduction.amount,
    );
  }

  return params.lots.map((lot) => {
    const usedAmount = deductionByLotId.get(lot.id) ?? 0;
    if (usedAmount <= 0) return { ...lot };

    const remainingAmount = Math.max(0, lot.remainingAmount - usedAmount);
    const status: CreditLotStatus = remainingAmount <= 0 ? 'exhausted' : lot.status;

    return {
      ...lot,
      remainingAmount,
      status,
    };
  });
}

export function applyLotRestorationsToSnapshots(params: {
  lots: CreditLotCandidate[];
  deductions: HybridCreditDeduction[];
}): CreditLotCandidate[] {
  const restoreByLotId = new Map<string, number>();

  for (const deduction of params.deductions) {
    if (deduction.kind !== 'lot' || !deduction.lotId || deduction.amount <= 0) continue;
    restoreByLotId.set(
      deduction.lotId,
      (restoreByLotId.get(deduction.lotId) ?? 0) + deduction.amount,
    );
  }

  return params.lots.map((lot) => {
    const restoreAmount = restoreByLotId.get(lot.id) ?? 0;
    if (restoreAmount <= 0) return { ...lot };

    const remainingAmount = Math.min(lot.totalAmount, lot.remainingAmount + restoreAmount);
    const status: CreditLotStatus = remainingAmount > 0 && lot.status === 'exhausted'
      ? 'active'
      : lot.status;

    return {
      ...lot,
      remainingAmount,
      status,
    };
  });
}
