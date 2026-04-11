import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd().endsWith('/backend')
  ? process.cwd()
  : resolve(process.cwd(), 'backend');

const adminController = readFileSync(
  resolve(projectRoot, 'src/admin/admin.controller.ts'),
  'utf8',
);
const creditsService = readFileSync(
  resolve(projectRoot, 'src/credits/credits.service.ts'),
  'utf8',
);
const membershipService = readFileSync(
  resolve(projectRoot, 'src/membership/membership.service.ts'),
  'utf8',
);
const paymentService = readFileSync(
  resolve(projectRoot, 'src/payment/payment.service.ts'),
  'utf8',
);
const policyService = readFileSync(
  resolve(projectRoot, 'src/business-policy/business-policy.service.ts'),
  'utf8',
);

assert.match(policyService, /MEMBERSHIP_CREDIT_POLICY_SETTING_KEY/);
assert.match(adminController, /@Get\('membership-credit-policy'\)/);
assert.match(adminController, /@Post\('membership-credit-policy'\)/);
assert.match(creditsService, /dailyRewardCredits/);
assert.match(creditsService, /dailyGiftCredits/);
assert.match(creditsService, /consecutive7DayRewardMultiplier/);
assert.match(policyService, /freeUserMonthlyQuotaCredits/);
assert.match(policyService, /consecutive7DayRewardMultiplier/);
assert.doesNotMatch(policyService, /consecutive7DayBonusCredits/);
assert.doesNotMatch(policyService, /dailyRewardExpireDays/);
assert.match(membershipService, /membershipRefreshCycleDays/);
assert.match(membershipService, /dailyGiftDecayCredits/);
assert.match(paymentService, /fixedCreditExpireDays/);

console.log('membership policy config tests passed');
