import assert from 'node:assert/strict';
import { TANVA_CURRENCY_CONFIG, formatTanvaMoney, formatPaymentAmount } from './currency.js';

assert.deepEqual(TANVA_CURRENCY_CONFIG, { symbol: '¥', rate: 1, type: 'CNY' });
assert.equal(formatTanvaMoney(2), '¥2.00');
assert.equal(formatTanvaMoney(0.019311, 6), '¥0.019311');
assert.equal(formatTanvaMoney('8', 3), '¥8.000');
assert.equal(formatPaymentAmount(7.3, 'stripe'), '7.30');
assert.equal(formatPaymentAmount(7.3, 'alipay'), '¥7.30');
assert.equal(formatPaymentAmount(0.3, 'stripe'), '0.30');
console.log('Tanva RMB currency: ok');
