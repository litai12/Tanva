import assert from 'node:assert/strict';
import { resolvePaidUpgradePeriod } from '../src/membership/membership-cycle-guard';

const currentStart = new Date('2026-06-17T03:49:25.000Z');
const currentEnd = new Date('2026-07-17T03:49:25.000Z');
const paidAt = new Date('2026-06-22T03:59:45.863Z');

const missingMarker = resolvePaidUpgradePeriod({
  orderCycleSwitch: undefined,
  currentPeriodType: 'monthly',
  targetBillingCycle: 'yearly',
  currentPeriodStartAt: currentStart,
  currentPeriodEndAt: currentEnd,
  paidAt,
  targetCycleDays: 360,
});
assert.equal(missingMarker.cycleSwitch, true);
assert.equal(missingMarker.cycleSwitchSource, 'billing_cycle_mismatch');
assert.equal(missingMarker.periodType, 'yearly');
assert.equal(missingMarker.periodStartAt.toISOString(), paidAt.toISOString());
assert.equal(missingMarker.periodEndAt.toISOString(), '2027-06-17T03:59:45.863Z');

const falseMarker = resolvePaidUpgradePeriod({
  orderCycleSwitch: false,
  currentPeriodType: 'monthly',
  targetBillingCycle: 'yearly',
  currentPeriodStartAt: currentStart,
  currentPeriodEndAt: currentEnd,
  paidAt,
  targetCycleDays: 360,
});
assert.equal(falseMarker.cycleSwitch, true);
assert.equal(falseMarker.cycleSwitchSource, 'billing_cycle_mismatch');

const explicitMarker = resolvePaidUpgradePeriod({
  orderCycleSwitch: true,
  currentPeriodType: 'yearly',
  targetBillingCycle: 'yearly',
  currentPeriodStartAt: currentStart,
  currentPeriodEndAt: currentEnd,
  paidAt,
  targetCycleDays: 360,
});
assert.equal(explicitMarker.cycleSwitch, true);
assert.equal(explicitMarker.cycleSwitchSource, 'order_metadata');
assert.equal(explicitMarker.periodStartAt.toISOString(), paidAt.toISOString());

const retainedPeriod = resolvePaidUpgradePeriod({
  orderCycleSwitch: false,
  currentPeriodType: 'yearly',
  targetBillingCycle: 'yearly',
  currentPeriodStartAt: currentStart,
  currentPeriodEndAt: currentEnd,
  paidAt,
  targetCycleDays: 360,
});
assert.equal(retainedPeriod.cycleSwitch, false);
assert.equal(retainedPeriod.cycleSwitchSource, 'none');
assert.equal(retainedPeriod.periodStartAt, currentStart);
assert.equal(retainedPeriod.periodEndAt, currentEnd);

assert.throws(
  () =>
    resolvePaidUpgradePeriod({
      orderCycleSwitch: true,
      currentPeriodType: 'monthly',
      targetBillingCycle: 'yearly',
      currentPeriodStartAt: currentStart,
      currentPeriodEndAt: currentEnd,
      paidAt,
      targetCycleDays: 0,
    }),
  /Invalid target membership cycle days/,
);

console.log('membership cycle guard verification passed');
