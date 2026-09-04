import assert from 'node:assert/strict';

import { isFreeCreditDecayLot } from './free-credit-decay-policy';

assert.equal(
  isFreeCreditDecayLot({ sourceType: 'gift', validityType: 'fixed_window', metadata: { reason: 'daily_reward' } }),
  false,
);
assert.equal(
  isFreeCreditDecayLot({ sourceType: 'gift', validityType: 'permanent', metadata: { grantedBy: 'referral_reward' } }),
  true,
);
assert.equal(
  isFreeCreditDecayLot({
    sourceType: 'subscription',
    validityType: 'fixed_window',
    metadata: { grantedBy: 'free_user_starter_quota' },
  }),
  true,
);
assert.equal(
  isFreeCreditDecayLot({ sourceType: 'recharge', validityType: 'permanent', metadata: { grantType: 'recharge_base' } }),
  false,
);
assert.equal(
  isFreeCreditDecayLot({
    sourceType: 'recharge',
    validityType: 'permanent',
    metadata: { grantType: 'recharge_bonus', permanent: true },
  }),
  false,
);
assert.equal(
  isFreeCreditDecayLot({
    sourceType: 'gift',
    validityType: 'permanent',
    metadata: { permanent: true },
  }),
  true,
);
assert.equal(
  isFreeCreditDecayLot({ sourceType: 'promo', validityType: 'permanent' }),
  true,
);
assert.equal(
  isFreeCreditDecayLot({ sourceType: 'subscription', validityType: 'membership_bound' }),
  false,
);
assert.equal(
  isFreeCreditDecayLot({
    sourceType: 'gift',
    validityType: 'permanent',
    metadata: { reason: 'daily_reward', retentionPolicy: 'current_vip_only' },
  }),
  false,
);

console.log('free credit decay policy checks passed');
