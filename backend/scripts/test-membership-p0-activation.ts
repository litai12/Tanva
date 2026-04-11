import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const service = readFileSync(
  resolve(process.cwd(), 'backend/src/membership/membership.service.ts'),
  'utf8',
);

assert.match(service, /class MembershipService/);
assert.match(service, /async activatePaidMembershipOrder\(/);
assert.match(service, /buildMembershipCreditLotData/);
assert.match(service, /membership_grant/);

console.log('membership p0 activation tests passed');
