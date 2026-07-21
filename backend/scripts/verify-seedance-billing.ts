import assert from 'node:assert/strict';
import { calculateSeedance20BillingDuration } from '../src/ai/services/seedance20-pricing';

assert.deepEqual(calculateSeedance20BillingDuration(5, []), {
  outputDurationSec: 5,
  inputVideoDurationSec: 0,
  billingDurationSec: 5,
});

assert.deepEqual(calculateSeedance20BillingDuration(5, [5]), {
  outputDurationSec: 5,
  inputVideoDurationSec: 5,
  billingDurationSec: 10,
});

assert.deepEqual(calculateSeedance20BillingDuration(4, [2.345, 3.456]), {
  outputDurationSec: 4,
  inputVideoDurationSec: 5.801,
  billingDurationSec: 9.801,
});

assert.throws(
  () => calculateSeedance20BillingDuration(0, [5]),
  /output duration must be a positive number/,
);
assert.throws(
  () => calculateSeedance20BillingDuration(5, [Number.NaN]),
  /reference video durations must be positive numbers/,
);

console.log('Seedance billing duration verification passed');
