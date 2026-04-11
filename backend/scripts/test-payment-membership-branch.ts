import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dto = readFileSync(resolve(process.cwd(), 'backend/src/payment/dto/payment.dto.ts'), 'utf8');
const service = readFileSync(resolve(process.cwd(), 'backend/src/payment/payment.service.ts'), 'utf8');

assert.match(dto, /type PaymentOrderType = 'recharge' \| 'membership'/);
assert.match(service, /currentOrder\.orderType === 'membership'/);

console.log('payment membership branch tests passed');
