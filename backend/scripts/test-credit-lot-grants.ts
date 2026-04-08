import assert from 'node:assert/strict';

import {
  buildDailyRewardCreditLotData,
  buildManualCreditLotData,
  buildRechargeCreditLotData,
  buildSignupCreditLotData,
} from '../src/credits/credit-lot-grants';

function iso(input: string): Date {
  return new Date(input);
}

function run(): void {
  const grantedAt = iso('2026-04-08T12:00:00.000Z');

  const rechargeLot = buildRechargeCreditLotData({
    accountId: 'acct_1',
    amount: 2000,
    grantedAt,
    orderId: 'order_1',
    metadata: {
      orderNo: 'PAY123',
    },
  });

  assert.equal(rechargeLot.accountId, 'acct_1');
  assert.equal(rechargeLot.sourceType, 'recharge');
  assert.equal(rechargeLot.validityType, 'permanent');
  assert.equal(rechargeLot.totalAmount, 2000);
  assert.equal(rechargeLot.remainingAmount, 2000);
  assert.equal(rechargeLot.orderId, 'order_1');
  assert.equal(rechargeLot.expiresAt, null);

  const manualLot = buildManualCreditLotData({
    accountId: 'acct_2',
    amount: 888,
    grantedAt,
    metadata: {
      adminId: 'admin_1',
      description: '运营补偿',
    },
  });

  assert.equal(manualLot.sourceType, 'manual');
  assert.equal(manualLot.validityType, 'permanent');
  assert.equal(manualLot.totalAmount, 888);
  assert.equal(manualLot.remainingAmount, 888);
  assert.equal(manualLot.expiresAt, null);
  assert.deepEqual(manualLot.metadata, {
    adminId: 'admin_1',
    description: '运营补偿',
  });

  const expiringRechargeLot = buildRechargeCreditLotData({
    accountId: 'acct_2b',
    amount: 1200,
    grantedAt,
    expiresAt: iso('2028-04-07T12:00:00.000Z'),
  });

  assert.equal(expiringRechargeLot.sourceType, 'recharge');
  assert.equal(expiringRechargeLot.validityType, 'fixed_window');
  assert.equal(expiringRechargeLot.expiresAt?.toISOString(), '2028-04-07T12:00:00.000Z');

  const expiringManualLot = buildManualCreditLotData({
    accountId: 'acct_2c',
    amount: 300,
    grantedAt,
    expiresAt: iso('2026-10-05T12:00:00.000Z'),
  });

  assert.equal(expiringManualLot.sourceType, 'manual');
  assert.equal(expiringManualLot.validityType, 'fixed_window');
  assert.equal(expiringManualLot.expiresAt?.toISOString(), '2026-10-05T12:00:00.000Z');

  const signupLot = buildSignupCreditLotData({
    accountId: 'acct_3',
    amount: 500,
    grantedAt,
    metadata: {
      reason: 'new_user_signup',
    },
  });

  assert.equal(signupLot.sourceType, 'promo');
  assert.equal(signupLot.validityType, 'permanent');
  assert.equal(signupLot.totalAmount, 500);
  assert.equal(signupLot.remainingAmount, 500);
  assert.equal(signupLot.expiresAt, null);

  const freeDailyRewardLot = buildDailyRewardCreditLotData({
    accountId: 'acct_4',
    amount: 50,
    grantedAt,
    expiresAt: iso('2026-04-15T12:00:00.000Z'),
    metadata: {
      reason: 'daily_reward',
    },
  });

  assert.equal(freeDailyRewardLot.sourceType, 'gift');
  assert.equal(freeDailyRewardLot.validityType, 'fixed_window');
  assert.equal(freeDailyRewardLot.expiresAt?.toISOString(), '2026-04-15T12:00:00.000Z');

  const paidDailyRewardLot = buildDailyRewardCreditLotData({
    accountId: 'acct_5',
    amount: 120,
    grantedAt,
    expiresAt: null,
    metadata: {
      reason: 'daily_reward',
    },
  });

  assert.equal(paidDailyRewardLot.sourceType, 'gift');
  assert.equal(paidDailyRewardLot.validityType, 'permanent');
  assert.equal(paidDailyRewardLot.expiresAt, null);
}

run();
console.log('credit lot grant tests passed');
