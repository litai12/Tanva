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
const paymentService = readFileSync(
  resolve(process.cwd(), 'backend/src/payment/payment.service.ts'),
  'utf8',
);

assert.match(controller, /@Get\('plans'\)/);
assert.match(controller, /@Get\('me'\)/);
assert.match(controller, /@Post\('orders'\)/);
assert.match(controller, /@Get\('orders'\)/);
assert.match(service, /async getMembershipPlansPage\(/);
assert.match(service, /async getMembershipMe\(/);
assert.match(paymentService, /async createMembershipOrderByPlanCode\(/);
assert.match(paymentService, /async getMembershipOrders\(/);

console.log('membership task api tests passed');
