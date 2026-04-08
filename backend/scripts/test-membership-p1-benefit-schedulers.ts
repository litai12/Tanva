import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const service = readFileSync(
  resolve(process.cwd(), 'backend/src/membership/membership.service.ts'),
  'utf8',
);
const scheduler = readFileSync(
  resolve(process.cwd(), 'backend/src/membership/membership-scheduler.service.ts'),
  'utf8',
);

assert.match(service, /async decayDailyGiftCredits\(/);
assert.match(service, /businessType:\s*'gift_decay'/);
assert.match(service, /pauseGiftDecay/);
assert.match(service, /async refreshYearlySubscriptionQuotaLots\(/);
assert.match(service, /businessType:\s*'membership_refresh'/);
assert.match(scheduler, /handleGiftDecay/);
assert.match(scheduler, /handleYearlyQuotaRefresh/);

console.log('membership p1 benefit scheduler tests passed');
