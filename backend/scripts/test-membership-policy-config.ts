import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const adminController = readFileSync(
  resolve(process.cwd(), 'backend/src/admin/admin.controller.ts'),
  'utf8',
);
const creditsService = readFileSync(
  resolve(process.cwd(), 'backend/src/credits/credits.service.ts'),
  'utf8',
);
const membershipService = readFileSync(
  resolve(process.cwd(), 'backend/src/membership/membership.service.ts'),
  'utf8',
);
const paymentService = readFileSync(
  resolve(process.cwd(), 'backend/src/payment/payment.service.ts'),
  'utf8',
);
const policyService = readFileSync(
  resolve(process.cwd(), 'backend/src/business-policy/business-policy.service.ts'),
  'utf8',
);

assert.match(policyService, /MEMBERSHIP_CREDIT_POLICY_SETTING_KEY/);
assert.match(adminController, /@Get\('membership-credit-policy'\)/);
assert.match(adminController, /@Post\('membership-credit-policy'\)/);
assert.match(creditsService, /dailyRewardCredits/);
assert.match(creditsService, /fixedCreditExpireDays/);
assert.match(membershipService, /membershipRefreshCycleDays/);
assert.match(membershipService, /dailyGiftDecayCredits/);
assert.match(paymentService, /fixedCreditExpireDays/);

console.log('membership policy config tests passed');
