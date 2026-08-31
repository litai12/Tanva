import assert from 'node:assert/strict';

import {
  diffDailyRewardBusinessDays,
  getDailyRewardBusinessDayAnchor,
  getDailyRewardExpiresAt,
  isRetainedVipDailyReward,
} from './daily-reward-policy';

const afterReset = new Date(2026, 7, 31, 15, 26, 28);
assert.deepEqual(
  getDailyRewardBusinessDayAnchor(afterReset),
  new Date(2026, 7, 31, 3, 0, 0),
);
assert.deepEqual(
  getDailyRewardExpiresAt(afterReset),
  new Date(2026, 8, 1, 3, 0, 0),
);

const beforeReset = new Date(2026, 7, 31, 1, 30, 0);
assert.deepEqual(
  getDailyRewardBusinessDayAnchor(beforeReset),
  new Date(2026, 7, 30, 3, 0, 0),
);
assert.deepEqual(
  getDailyRewardExpiresAt(beforeReset),
  new Date(2026, 7, 31, 3, 0, 0),
);

assert.equal(
  diffDailyRewardBusinessDays(
    new Date(2026, 8, 1, 2, 59, 59),
    new Date(2026, 7, 31, 3, 0, 0),
  ),
  0,
);
assert.equal(
  diffDailyRewardBusinessDays(
    new Date(2026, 8, 1, 3, 0, 0),
    new Date(2026, 7, 31, 3, 0, 0),
  ),
  1,
);

assert.equal(isRetainedVipDailyReward({ tierCode: 'vip_69' }), true);
assert.equal(isRetainedVipDailyReward({ tierCode: 'vip_599' }), true);
assert.equal(isRetainedVipDailyReward({ retentionPolicy: 'vip_decay_after_entitlement' }), true);
assert.equal(isRetainedVipDailyReward({ retentionPolicy: 'vip_permanent' }), true);
assert.equal(isRetainedVipDailyReward({ tierCode: 'free' }), false);
assert.equal(isRetainedVipDailyReward(null), false);

console.log('daily reward policy checks passed');
