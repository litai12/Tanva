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

assert.match(service, /async expireElapsedMemberships\(/);
assert.match(service, /validityType:\s*'membership_bound'/);
assert.match(service, /membership_expire/);
assert.match(service, /currentPlanCode:\s*'free'/);
assert.match(scheduler, /CronExpression\.EVERY_HOUR/);
assert.match(scheduler, /expireElapsedMemberships/);

console.log('membership p1 expiry tests passed');
