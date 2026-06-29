export type CreditLotSourceType =
  | 'subscription'
  | 'recharge'
  | 'gift'
  | 'promo'
  | 'manual';

export type CreditLotValidityType =
  | 'permanent'
  | 'fixed_window'
  | 'membership_bound';

export type CreditLotScopeType =
  | 'global'
  | 'service_type'
  | 'provider'
  | 'model';

export type CreditLotStatus =
  | 'pending'
  | 'active'
  | 'exhausted'
  | 'expired'
  | 'revoked';

export interface CreditLotCandidate {
  id: string;
  sourceType: CreditLotSourceType;
  validityType: CreditLotValidityType;
  scopeType?: CreditLotScopeType;
  scopeValue?: string | null;
  totalAmount: number;
  remainingAmount: number;
  grantedAt: Date;
  activeAt?: Date | null;
  expiresAt?: Date | null;
  priority?: number;
  status: CreditLotStatus;
}

export interface CreditConsumeScope {
  serviceType?: string | null;
  provider?: string | null;
  model?: string | null;
}

export interface CreditConsumePolicy {
  code: string;
  version: number;
  sorts: string[];
  validityPriority: Record<CreditLotValidityType, number>;
  sourcePriority: Record<CreditLotSourceType, number>;
}

export interface PersistedCreditConsumePolicyRecord {
  code: string;
  version: number;
  scopeType?: string | null;
  scopeValue?: string | null;
  sorts: unknown;
  validityPriority: unknown;
  sourcePriority: unknown;
}

export interface CreditLotDeduction {
  lotId: string;
  amount: number;
}

export interface CreditDeductionPlan {
  orderedLots: CreditLotCandidate[];
  deductions: CreditLotDeduction[];
  totalDeducted: number;
  sufficient: boolean;
  shortfall: number;
}

export const DEFAULT_CREDIT_CONSUME_POLICY_CODE = 'global_default';

const DEFAULT_POLICY: CreditConsumePolicy = {
  code: DEFAULT_CREDIT_CONSUME_POLICY_CODE,
  version: 1,
  sorts: [
    'scope_specificity_desc',
    'validity_priority_asc',
    'source_priority_asc',
    'expires_at_asc_nulls_last',
    'granted_at_asc',
    'custom_priority_asc',
  ],
  validityPriority: {
    membership_bound: 10,
    fixed_window: 20,
    permanent: 30,
  },
  sourcePriority: {
    subscription: 10,
    promo: 15,
    gift: 20,
    manual: 35,
    recharge: 40,
  },
};

export function getDefaultCreditConsumePolicy(): CreditConsumePolicy {
  return {
    code: DEFAULT_POLICY.code,
    version: DEFAULT_POLICY.version,
    sorts: [...DEFAULT_POLICY.sorts],
    validityPriority: { ...DEFAULT_POLICY.validityPriority },
    sourcePriority: { ...DEFAULT_POLICY.sourcePriority },
  };
}

export function hydrateCreditConsumePolicyRecord(
  record: PersistedCreditConsumePolicyRecord,
): CreditConsumePolicy {
  const fallback = getDefaultCreditConsumePolicy();

  return {
    code: record.code,
    version: Number.isFinite(record.version) ? record.version : fallback.version,
    sorts: normalizeSorts(record.sorts, fallback.sorts),
    validityPriority: normalizePriorityMap<CreditLotValidityType>(
      record.validityPriority,
      fallback.validityPriority,
      ['membership_bound', 'fixed_window', 'permanent'],
    ),
    sourcePriority: normalizePriorityMap<CreditLotSourceType>(
      record.sourcePriority,
      fallback.sourcePriority,
      ['promo', 'gift', 'manual', 'subscription', 'recharge'],
    ),
  };
}

export function selectCreditConsumePolicyRecord(
  records: PersistedCreditConsumePolicyRecord[],
  scope?: CreditConsumeScope,
): PersistedCreditConsumePolicyRecord | null {
  if (records.length === 0) return null;

  const ranked = [...records]
    .map((record) => ({
      record,
      rank: resolvePolicyScopeRank(record, scope),
    }))
    .filter((item) => item.rank >= 0)
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return (right.record.version ?? 0) - (left.record.version ?? 0);
    });

  return ranked[0]?.record ?? null;
}

export function isLotActiveAtTime(
  lot: CreditLotCandidate,
  now: Date,
): boolean {
  if (lot.status !== 'active') return false;
  if (!Number.isFinite(lot.remainingAmount) || lot.remainingAmount <= 0) return false;
  if (lot.activeAt && lot.activeAt.getTime() > now.getTime()) return false;
  if (lot.expiresAt && lot.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function matchesCreditConsumeScope(
  lot: CreditLotCandidate,
  scope?: CreditConsumeScope,
): boolean {
  const scopeType = lot.scopeType ?? 'global';
  const scopeValue = typeof lot.scopeValue === 'string' ? lot.scopeValue.trim() : '';

  if (scopeType === 'global' || !scopeValue) {
    return true;
  }

  if (!scope) {
    return false;
  }

  switch (scopeType) {
    case 'service_type':
      return scope.serviceType === scopeValue;
    case 'provider':
      return scope.provider === scopeValue;
    case 'model':
      return scope.model === scopeValue;
    default:
      return false;
  }
}

export function getCreditLotScopeSpecificity(
  lot: CreditLotCandidate,
  scope?: CreditConsumeScope,
): number {
  const scopeType = lot.scopeType ?? 'global';
  const scopeValue = typeof lot.scopeValue === 'string' ? lot.scopeValue.trim() : '';

  if (scopeType === 'global' || !scopeValue) return 0;
  if (!matchesCreditConsumeScope(lot, scope)) return -1;

  switch (scopeType) {
    case 'service_type':
      return 1;
    case 'provider':
      return 2;
    case 'model':
      return 3;
    default:
      return 0;
  }
}

export function listEligibleCreditLots(params: {
  lots: CreditLotCandidate[];
  now?: Date;
  scope?: CreditConsumeScope;
  policy?: CreditConsumePolicy;
}): CreditLotCandidate[] {
  const { lots, scope } = params;
  const now = params.now ?? new Date();
  const policy = params.policy ?? getDefaultCreditConsumePolicy();

  return [...lots]
    .filter((lot) => isLotActiveAtTime(lot, now))
    .filter((lot) => matchesCreditConsumeScope(lot, scope))
    .sort((left, right) => compareLots(left, right, policy, scope));
}

export function buildDeductionPlan(params: {
  lots: CreditLotCandidate[];
  amount: number;
  now?: Date;
  scope?: CreditConsumeScope;
  policy?: CreditConsumePolicy;
}): CreditDeductionPlan {
  const amount = Math.max(0, Math.floor(params.amount));
  const orderedLots = listEligibleCreditLots({
    lots: params.lots,
    now: params.now,
    scope: params.scope,
    policy: params.policy,
  });

  let remaining = amount;
  const deductions: CreditLotDeduction[] = [];

  for (const lot of orderedLots) {
    if (remaining <= 0) break;
    const amountToUse = Math.min(lot.remainingAmount, remaining);
    if (amountToUse <= 0) continue;

    deductions.push({
      lotId: lot.id,
      amount: amountToUse,
    });
    remaining -= amountToUse;
  }

  return {
    orderedLots,
    deductions,
    totalDeducted: amount - remaining,
    sufficient: remaining === 0,
    shortfall: remaining,
  };
}

function compareLots(
  left: CreditLotCandidate,
  right: CreditLotCandidate,
  policy: CreditConsumePolicy,
  scope?: CreditConsumeScope,
): number {
  const leftPriority = left.priority ?? 0;
  const rightPriority = right.priority ?? 0;
  if (leftPriority < 0 || rightPriority < 0) {
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  }

  for (const sortKey of policy.sorts) {
    const result = compareLotsBySortKey(left, right, sortKey, policy, scope);
    if (result !== 0) return result;
  }

  return left.id.localeCompare(right.id);
}

function compareLotsBySortKey(
  left: CreditLotCandidate,
  right: CreditLotCandidate,
  sortKey: string,
  policy: CreditConsumePolicy,
  scope?: CreditConsumeScope,
): number {
  switch (sortKey) {
    case 'expires_at_asc_nulls_last':
      return compareDatesAscNullsLast(left.expiresAt ?? null, right.expiresAt ?? null);
    case 'scope_specificity_desc':
      return (
        getCreditLotScopeSpecificity(right, scope) -
        getCreditLotScopeSpecificity(left, scope)
      );
    case 'validity_priority_asc':
      return (
        resolveValidityPriority(left.validityType, policy) -
        resolveValidityPriority(right.validityType, policy)
      );
    case 'source_priority_asc':
      return (
        resolveSourcePriority(left.sourceType, policy) -
        resolveSourcePriority(right.sourceType, policy)
      );
    case 'granted_at_asc':
      return left.grantedAt.getTime() - right.grantedAt.getTime();
    case 'custom_priority_asc':
      return (left.priority ?? 0) - (right.priority ?? 0);
    default:
      return 0;
  }
}

function compareDatesAscNullsLast(
  left: Date | null,
  right: Date | null,
): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.getTime() - right.getTime();
}

function resolveValidityPriority(
  value: CreditLotValidityType,
  policy: CreditConsumePolicy,
): number {
  return policy.validityPriority[value] ?? Number.MAX_SAFE_INTEGER;
}

function resolveSourcePriority(
  value: CreditLotSourceType,
  policy: CreditConsumePolicy,
): number {
  return policy.sourcePriority[value] ?? Number.MAX_SAFE_INTEGER;
}

function normalizeSorts(
  value: unknown,
  fallback: string[],
): string[] {
  if (!Array.isArray(value)) return [...fallback];

  const sorts = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return sorts.length > 0 ? sorts : [...fallback];
}

function normalizePriorityMap<T extends string>(
  value: unknown,
  fallback: Record<T, number>,
  keys: T[],
): Record<T, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback };
  }

  const source = value as Record<string, unknown>;
  const result = { ...fallback };

  for (const key of keys) {
    const rawValue = source[key];
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      result[key] = rawValue;
    }
  }

  return result;
}

function resolvePolicyScopeRank(
  record: PersistedCreditConsumePolicyRecord,
  scope?: CreditConsumeScope,
): number {
  const scopeType = typeof record.scopeType === 'string' ? record.scopeType : 'global';
  const scopeValue = typeof record.scopeValue === 'string' ? record.scopeValue : null;

  switch (scopeType) {
    case 'model':
      return scope?.model && scopeValue === scope.model ? 0 : -1;
    case 'provider':
      return scope?.provider && scopeValue === scope.provider ? 1 : -1;
    case 'service_type':
      return scope?.serviceType && scopeValue === scope.serviceType ? 2 : -1;
    case 'global':
      return 3;
    default:
      return -1;
  }
}
