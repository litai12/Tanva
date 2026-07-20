import type { MembershipBillingCycle } from './membership.types';

export type PaidUpgradeCycleSwitchSource =
  | 'order_metadata'
  | 'billing_cycle_mismatch'
  | 'none';

export interface ResolvePaidUpgradePeriodInput {
  orderCycleSwitch: unknown;
  currentPeriodType: string;
  targetBillingCycle: string;
  currentPeriodStartAt: Date;
  currentPeriodEndAt: Date;
  paidAt: Date;
  targetCycleDays: number;
}

export interface ResolvedPaidUpgradePeriod {
  cycleSwitch: boolean;
  cycleSwitchSource: PaidUpgradeCycleSwitchSource;
  periodType: MembershipBillingCycle;
  periodStartAt: Date;
  periodEndAt: Date;
}

function normalizeBillingCycle(value: string): MembershipBillingCycle {
  return value === 'yearly' ? 'yearly' : 'monthly';
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Resolve the paid upgrade period without trusting the order metadata alone.
 * A real cycle mismatch always opens the target cycle, even for legacy orders
 * whose membershipCycleSwitch marker is absent or false.
 */
export function resolvePaidUpgradePeriod(
  input: ResolvePaidUpgradePeriodInput,
): ResolvedPaidUpgradePeriod {
  if (!Number.isInteger(input.targetCycleDays) || input.targetCycleDays <= 0) {
    throw new Error(`Invalid target membership cycle days: ${input.targetCycleDays}`);
  }

  const currentCycle = normalizeBillingCycle(input.currentPeriodType);
  const targetCycle = normalizeBillingCycle(input.targetBillingCycle);
  const requestedByOrder = input.orderCycleSwitch === true;
  const inferredFromCycles = currentCycle !== targetCycle;
  const cycleSwitch = requestedByOrder || inferredFromCycles;
  const cycleSwitchSource: PaidUpgradeCycleSwitchSource = requestedByOrder
    ? 'order_metadata'
    : inferredFromCycles
      ? 'billing_cycle_mismatch'
      : 'none';

  if (!cycleSwitch) {
    return {
      cycleSwitch,
      cycleSwitchSource,
      periodType: currentCycle,
      periodStartAt: input.currentPeriodStartAt,
      periodEndAt: input.currentPeriodEndAt,
    };
  }

  return {
    cycleSwitch,
    cycleSwitchSource,
    periodType: targetCycle,
    periodStartAt: input.paidAt,
    periodEndAt: addDays(input.paidAt, input.targetCycleDays),
  };
}
