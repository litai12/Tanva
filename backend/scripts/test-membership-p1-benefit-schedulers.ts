import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd().endsWith('/backend')
  ? process.cwd()
  : resolve(process.cwd(), 'backend');

const service = readFileSync(
  resolve(projectRoot, 'src/membership/membership.service.ts'),
  'utf8',
);
const creditsService = readFileSync(
  resolve(projectRoot, 'src/credits/credits.service.ts'),
  'utf8',
);
const scheduler = readFileSync(
  resolve(projectRoot, 'src/membership/membership-scheduler.service.ts'),
  'utf8',
);

assert.match(creditsService, /async issueFreeUserStarterQuotaCredits\(/);
assert.match(creditsService, /FREE_USER_STARTER_QUOTA_BUSINESS_TYPE/);
assert.match(creditsService, /freeUserMonthlyQuotaCredits/);
assert.match(service, /async decayDailyGiftCredits\(/);
assert.match(service, /businessType:\s*'gift_decay'/);
assert.match(service, /pauseGiftDecay/);
assert.match(service, /async issueDailyMembershipGiftCredits\(/);
assert.match(service, /businessType:\s*'membership_daily_gift'/);
assert.match(service, /async refreshYearlySubscriptionQuotaLots\(/);
assert.match(service, /businessType:\s*'membership_refresh'/);
assert.match(scheduler, /handleFreeStarterQuotaIssue/);
assert.match(scheduler, /handleGiftDecay/);
assert.match(scheduler, /handleDailyMembershipGiftIssue/);
assert.match(scheduler, /handleYearlyQuotaRefresh/);

console.log('membership p1 benefit scheduler tests passed');
