import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const controller = readFileSync(resolve(process.cwd(), 'backend/src/payment/payment.controller.ts'), 'utf8');
const service = readFileSync(resolve(process.cwd(), 'backend/src/payment/payment.service.ts'), 'utf8');

assert.match(controller, /@Get\('membership-plans'\)/);
assert.match(service, /membershipPlanId/);
assert.match(service, /orderType:\s*dto\.orderType \?\? 'recharge'/);

console.log('payment membership create order tests passed');
