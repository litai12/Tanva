import assert from 'node:assert/strict';
import { AiController } from '../ai/ai.controller';
import { AdminService } from '../admin/admin.service';
import { CreditsService } from '../credits/credits.service';
import { getDailyRewardExpiresAt } from '../credits/daily-reward-policy';

async function main() {
  const user = { id: 'sd2-user', role: 'user', noWatermark: false, vipEntitlementWhitelist: false, seedance2AccessWhitelist: true, vipRechargeBonusEnabled: false };
  const prisma: any = {
    user: {
      findUnique: async () => user,
      findFirst: async ({ where }: any) => where.vipEntitlementWhitelist && user.vipEntitlementWhitelist ? user : null,
      update: async ({ data }: any) => Object.assign(user, data),
    },
    userMembershipSubscription: { findFirst: async () => null },
    membershipEntitlementSnapshot: { findUnique: async () => null },
    systemSetting: { findUnique: async () => null },
  };
  const ai: any = Object.assign(Object.create(AiController.prototype), {
    prisma, usersService: { findById: async () => user },
  });
  const credits: any = Object.assign(Object.create(CreditsService.prototype), {
    prisma,
    businessPolicyService: { getMembershipCreditPolicy: async () => ({ dailyRewardCredits: 50, consecutive7DayRewardMultiplier: 1 }) },
  });
  const admin: any = Object.assign(Object.create(AdminService.prototype), { prisma });
  const req = { user: { id: user.id, role: 'user' } };
  assert.deepEqual(await ai.resolveSeedance2CombinedAccess(user.id, req), { allowed: true, byWhitelist: true, byVip: false, byAdmin: false });
  assert.equal(await ai.canSkipWatermark(req), false, 'SD2 access must not grant watermark removal');
  const rule = await credits.resolveDailyRewardRuleForUser(prisma, user.id);
  assert.equal(rule.baseCredits, 50);
  assert.equal(rule.tierCode, 'free');
  assert.equal(rule.isVipEntitled, false);
  assert.equal(await credits.hasActiveVipEntitlement(prisma, user.id, new Date()), false, 'SD2-only user must enter daily-credit expiry');
  assert.deepEqual(getDailyRewardExpiresAt(new Date(2026, 8, 7, 12)), new Date(2026, 8, 8, 3));
  const lot = { id: 'daily-lot', remainingAmount: 20, grantedAt: new Date(2026, 8, 7, 12), expiresAt: new Date(2026, 8, 8, 3) };
  let balance = 120; // 20 unused daily credits plus 100 other credits.
  const transactions: any[] = [];
  prisma.creditLot = {
    findMany: async () => [lot],
    update: async ({ data }: any) => Object.assign(lot, data),
  };
  prisma.creditTransaction = {
    updateMany: async () => ({ count: 1 }),
    create: async ({ data }: any) => { transactions.push(data); return data; },
  };
  prisma.creditAccount = { update: async ({ data }: any) => { balance = data.balance; } };
  assert.deepEqual(await credits.expireDailyRewardLotsForLockedAccount(
    prisma, { id: 'account', userId: user.id, balance }, new Date(2026, 8, 8, 3),
  ), { expiredLots: 1, expiredCredits: 20, balanceAfter: 100 });
  assert.equal(balance, 100, 'Only unused daily credits are removed');
  assert.equal(lot.remainingAmount, 0);
  assert.equal(transactions[0].amount, -20);
  const saved = await admin.upsertWhitelistUser(user.id, { seedance2AccessWhitelist: true });
  assert.deepEqual(saved.tags, ['SD2 使用权限']);
  await admin.removeWhitelistUser(user.id);
  assert.equal(user.seedance2AccessWhitelist, false);
  assert.equal((await ai.resolveSeedance2CombinedAccess(user.id, req)).allowed, false);
  user.vipEntitlementWhitelist = true;
  assert.equal(await credits.hasActiveVipEntitlement(prisma, user.id, new Date()), true, 'Legacy VIP retention remains supported');
  console.log('SD2 whitelist: independent access, ordinary 50-credit reward, expiry eligibility, save and revoke passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
