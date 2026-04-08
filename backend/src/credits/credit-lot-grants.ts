import type { Prisma } from '@prisma/client';

import type { CreditLotScopeType, CreditLotSourceType, CreditLotValidityType } from './credit-lot-policy';

interface CreditLotGrantBaseInput {
  accountId: string;
  amount: number;
  grantedAt?: Date;
  activeAt?: Date;
  orderId?: string | null;
  subscriptionId?: string | null;
  scopeType?: CreditLotScopeType;
  scopeValue?: string | null;
  metadata?: Prisma.InputJsonValue;
}

interface CreditLotGrantData {
  accountId: string;
  sourceType: CreditLotSourceType;
  validityType: CreditLotValidityType;
  scopeType: CreditLotScopeType;
  scopeValue: string | null;
  totalAmount: number;
  remainingAmount: number;
  grantedAt: Date;
  activeAt: Date;
  expiresAt: Date | null;
  durationDays: number | null;
  orderId: string | null;
  subscriptionId: string | null;
  status: 'active';
  priority: number;
  metadata?: Prisma.InputJsonValue;
}

export function buildRechargeCreditLotData(
  input: CreditLotGrantBaseInput & { expiresAt?: Date | null },
): CreditLotGrantData {
  return buildDurableLotData({
    ...input,
    sourceType: 'recharge',
  });
}

export function buildManualCreditLotData(
  input: CreditLotGrantBaseInput & { expiresAt?: Date | null },
): CreditLotGrantData {
  return buildDurableLotData({
    ...input,
    sourceType: 'manual',
  });
}

export function buildAdminGiftCreditLotData(
  input: CreditLotGrantBaseInput,
): CreditLotGrantData {
  return buildPermanentLotData({
    ...input,
    sourceType: 'gift',
  });
}

export function buildSignupCreditLotData(
  input: CreditLotGrantBaseInput,
): CreditLotGrantData {
  return buildPermanentLotData({
    ...input,
    sourceType: 'promo',
  });
}

export function buildDailyRewardCreditLotData(
  input: CreditLotGrantBaseInput & { expiresAt: Date | null },
): CreditLotGrantData {
  const grantedAt = input.grantedAt ?? new Date();
  const activeAt = input.activeAt ?? grantedAt;

  return {
    ...buildPermanentLotData({
      ...input,
      sourceType: 'gift',
    }),
    grantedAt,
    activeAt,
  };
}

export function buildMembershipCreditLotData(
  input: CreditLotGrantBaseInput & { expiresAt: Date; durationDays?: number | null },
): CreditLotGrantData {
  const grantedAt = input.grantedAt ?? new Date();
  const activeAt = input.activeAt ?? grantedAt;
  const durationDays =
    input.durationDays ??
    Math.max(1, Math.ceil((input.expiresAt.getTime() - grantedAt.getTime()) / (24 * 60 * 60 * 1000)));

  return {
    accountId: input.accountId,
    sourceType: 'subscription',
    validityType: 'membership_bound',
    scopeType: input.scopeType ?? 'global',
    scopeValue: input.scopeValue ?? null,
    totalAmount: input.amount,
    remainingAmount: input.amount,
    grantedAt,
    activeAt,
    expiresAt: input.expiresAt,
    durationDays,
    orderId: input.orderId ?? null,
    subscriptionId: input.subscriptionId ?? null,
    status: 'active',
    priority: 0,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function buildFreeMonthlyQuotaCreditLotData(
  input: CreditLotGrantBaseInput & { expiresAt: Date; durationDays?: number | null },
): CreditLotGrantData {
  const grantedAt = input.grantedAt ?? new Date();
  const activeAt = input.activeAt ?? grantedAt;
  const durationDays =
    input.durationDays ??
    Math.max(1, Math.ceil((input.expiresAt.getTime() - grantedAt.getTime()) / (24 * 60 * 60 * 1000)));

  return {
    accountId: input.accountId,
    sourceType: 'subscription',
    validityType: 'fixed_window',
    scopeType: input.scopeType ?? 'global',
    scopeValue: input.scopeValue ?? null,
    totalAmount: input.amount,
    remainingAmount: input.amount,
    grantedAt,
    activeAt,
    expiresAt: input.expiresAt,
    durationDays,
    orderId: input.orderId ?? null,
    subscriptionId: input.subscriptionId ?? null,
    status: 'active',
    priority: -100,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function buildPermanentLotData(
  input: CreditLotGrantBaseInput & { sourceType: CreditLotSourceType },
): CreditLotGrantData {
  const grantedAt = input.grantedAt ?? new Date();
  const activeAt = input.activeAt ?? grantedAt;

  return {
    accountId: input.accountId,
    sourceType: input.sourceType,
    validityType: 'permanent',
    scopeType: input.scopeType ?? 'global',
    scopeValue: input.scopeValue ?? null,
    totalAmount: input.amount,
    remainingAmount: input.amount,
    grantedAt,
    activeAt,
    expiresAt: null,
    durationDays: null,
    orderId: input.orderId ?? null,
    subscriptionId: input.subscriptionId ?? null,
    status: 'active',
    priority: 0,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function buildDurableLotData(
  input: CreditLotGrantBaseInput & { sourceType: CreditLotSourceType; expiresAt?: Date | null },
): CreditLotGrantData {
  if (!input.expiresAt) {
    return buildPermanentLotData(input);
  }

  const grantedAt = input.grantedAt ?? new Date();
  const activeAt = input.activeAt ?? grantedAt;
  const durationDays = Math.max(
    1,
    Math.ceil((input.expiresAt.getTime() - grantedAt.getTime()) / (24 * 60 * 60 * 1000)),
  );

  return {
    accountId: input.accountId,
    sourceType: input.sourceType,
    validityType: 'fixed_window',
    scopeType: input.scopeType ?? 'global',
    scopeValue: input.scopeValue ?? null,
    totalAmount: input.amount,
    remainingAmount: input.amount,
    grantedAt,
    activeAt,
    expiresAt: input.expiresAt,
    durationDays,
    orderId: input.orderId ?? null,
    subscriptionId: input.subscriptionId ?? null,
    status: 'active',
    priority: 0,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
