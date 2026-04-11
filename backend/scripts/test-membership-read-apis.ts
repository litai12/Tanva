import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const controller = readFileSync(
  resolve(process.cwd(), 'backend/src/membership/membership.controller.ts'),
  'utf8',
);
const service = readFileSync(
  resolve(process.cwd(), 'backend/src/membership/membership.service.ts'),
  'utf8',
);

assert.match(controller, /@Controller\('membership'\)/);
assert.match(controller, /@Get\('current'\)/);
assert.match(controller, /@Get\('entitlement'\)/);
assert.match(service, /async getCurrentMembership\(/);
assert.match(service, /async getMembershipEntitlement\(/);
assert.match(service, /currentPlanCode/);

console.log('membership read api tests passed');
