import assert from 'node:assert/strict';

import {
  getDefaultCreditConsumePolicy,
  hydrateCreditConsumePolicyRecord,
} from '../src/credits/credit-lot-policy';

function run(): void {
  const defaultPolicy = getDefaultCreditConsumePolicy();

  const hydrated = hydrateCreditConsumePolicyRecord({
    code: 'global_default',
    version: 3,
    sorts: [
      'scope_specificity_desc',
      'validity_priority_asc',
      'source_priority_asc',
      'expires_at_asc_nulls_last',
    ],
    validityPriority: {
      membership_bound: 5,
      fixed_window: 15,
      permanent: 25,
    },
    sourcePriority: {
      promo: 1,
      gift: 2,
      manual: 3,
      subscription: 4,
      recharge: 5,
    },
  });

  assert.equal(hydrated.code, 'global_default');
  assert.equal(hydrated.version, 3);
  assert.deepEqual(hydrated.sorts, [
    'scope_specificity_desc',
    'validity_priority_asc',
    'source_priority_asc',
    'expires_at_asc_nulls_last',
  ]);
  assert.equal(hydrated.validityPriority.membership_bound, 5);
  assert.equal(hydrated.sourcePriority.recharge, 5);

  const fallback = hydrateCreditConsumePolicyRecord({
    code: 'broken_policy',
    version: 9,
    sorts: null,
    validityPriority: null,
    sourcePriority: null,
  });

  assert.equal(fallback.code, 'broken_policy');
  assert.equal(fallback.version, 9);
  assert.deepEqual(fallback.sorts, defaultPolicy.sorts);
  assert.deepEqual(fallback.validityPriority, defaultPolicy.validityPriority);
  assert.deepEqual(fallback.sourcePriority, defaultPolicy.sourcePriority);
  assert.equal(defaultPolicy.sourcePriority.subscription, 10);
  assert.equal(defaultPolicy.sourcePriority.gift, 20);
}

run();
console.log('credit consume policy config tests passed');
