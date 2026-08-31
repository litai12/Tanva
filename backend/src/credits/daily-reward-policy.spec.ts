import assert from 'node:assert/strict';

import {
  diffDailyRewardBusinessDays,
  getDailyRewardBusinessDayAnchor,
  getDailyRewardExpiresAt,
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

console.log('daily reward policy checks passed');
