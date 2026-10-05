import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Module, ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import cookie from '@fastify/cookie';
import { DesktopChatController } from './desktop-chat.controller';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { BusinessPolicyService } from '../business-policy/business-policy.service';
import { TeamCreditLedgerService } from '../team-credits/team-credit-ledger.service';
import { DesktopChatService, readBoundedJson } from './desktop-chat.service';
import { DESKTOP_CHAT_MODEL, MAX_REQUEST_BYTES, upstreamDiagnostic, usageId, validateCompletion } from './desktop-chat.protocol';
import { createDeepSeekPricingSnapshot, estimateDeepSeekReservation, calculateDeepSeekUsage, roundUpDeepSeekCredits } from './deepseek-pricing';
import { GatewayConsumptionOrdersService } from '../consumption-orders/gateway-consumption-orders.service';
import { signGatewayRequest } from '../consumption-orders/gateway-consumption.protocol';
// Real PostgreSQL transactions, row/advisory locks and actual credit services.
// Only external HTTP is stubbed; refuse a production datasource explicitly.
const dbUrl = process.env.DESKTOP_CHAT_TEST_DATABASE_URL;
if (!dbUrl || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/desktop_chat_test(?:\?|$)/.test(dbUrl)) throw new Error('Set DESKTOP_CHAT_TEST_DATABASE_URL to isolated 127.0.0.1/desktop_chat_test');
Logger.overrideLogger(['error']);
const db = new PrismaService({ datasources: { db: { url: dbUrl } } });
const config = { get: (key: string) => ({ NODE_ENV: 'test', REDIS_URL: '', NEW_API_BASE_URL: 'https://fixture.invalid', NEW_API_KEY: 'fixture-only', JWT_ACCESS_SECRET: 'isolated-desktop-chat' } as Record<string, string>)[key] } as ConfigService;
const credits = new CreditsService(db, config, new BusinessPolicyService(db), {} as any);
const ledger = new TeamCreditLedgerService(db);
const prefix = randomUUID();
let calls = 0, mode = 'success'; let sent: any; let inspect: (() => Promise<void>) | undefined;
const completion = { id: 'fixture', model: DESKTOP_CHAT_MODEL, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '检查文件', reasoning_content: '保留字段', tool_calls: [{ id: 'next', type: 'function', function: { name: 'inspect', arguments: '{}' } }] } }], usage: { prompt_tokens: 18171, completion_tokens: 285, total_tokens: 18456, prompt_tokens_details: { cached_tokens: 0 } } };
const fetchFixture: typeof fetch = async (input: any, init: any) => {
  if (String(input).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: DESKTOP_CHAT_MODEL }] }));
  calls++; sent = JSON.parse(init.body); await new Promise(resolve => setTimeout(resolve, 30)); if (inspect) await inspect();
  if (mode === 'disconnect') throw new Error('fixture disconnect');
  if (mode === 'empty') return new Response(JSON.stringify({ choices: [{ message: {} }] }));
  if (/^\d+$/.test(mode)) return new Response(JSON.stringify({ error: { message: 'Bearer fixture-sensitive-key https://user:secret@gateway.invalid/private' } }), { status: Number(mode), headers: { 'x-oneapi-request-id': 'safe-rejection-id' } });
  if (mode === 'signature-rejected') return new Response(JSON.stringify({ error: 'tanva_invalid_order_signature', secret: 'fixture-sensitive-key' }), { status: 401 });
  if (mode === 'pricing-not-configured') return new Response(JSON.stringify({ error: { message: 'DeepSeek Flash CNY token pricing requires peak ModelRatio=1; apply the model pricing configuration patch (request id: 202610050918419893130388268d9d6vDBMi2cu)' }, secret: 'fixture-sensitive-key' }), { status: 400 });
  return new Response(JSON.stringify(completion), { headers: { 'content-type': 'application/json', 'x-oneapi-request-id': 'fixture-upstream-id' } });
};
function service() { const s = new DesktopChatService(config, db, credits, ledger); (s as any).fetchImpl = fetchFixture; return s; }
const chat = service();
const body = { model: DESKTOP_CHAT_MODEL, stream: false, tools: [{ type: 'function', function: { name: 'inspect', parameters: { type: 'object', properties: {} } } }], tool_choice: 'auto', parallel_tool_calls: true, messages: [
  { role: 'user', content: [{ type: 'text', text: '检查截图' }, { type: 'image_url', image_url: { url: 'https://fixture.invalid/shot.png' } }] },
  { role: 'assistant', content: null, tool_calls: [{ id: 'previous', type: 'function', function: { name: 'inspect', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'previous', content: '{"ok":true}' },
] };
function headers(key: string, teamId?: string) { return { 'idempotency-key': `${prefix}:${key}`, 'x-tanva-task-id': `${prefix}:task`, 'x-tanva-conversation-id': `${prefix}:conversation`, ...(teamId ? { 'x-tanva-team-id': teamId } : {}) }; }
const reserve = estimateDeepSeekReservation(createDeepSeekPricingSnapshot(new Date()), body).creditsReserved;
const exactNanos = BigInt(calculateDeepSeekUsage(createDeepSeekPricingSnapshot(new Date()), completion.usage).exactCreditNanos);
const charged = roundUpDeepSeekCredits(exactNanos.toString());
const request = (user: string, key: string) => chat.request(user, `${prefix}:${key}`);
const uid = (user: string, key: string) => usageId(user, `${prefix}:${key}`);
async function code(promise: Promise<any>, expected: string) { await assert.rejects(promise, (error: any) => error.getResponse?.().code === expected); }
async function user(amount = 1000) {
  const user = await db.user.create({ data: { phone: `test-${randomUUID()}`, passwordHash: 'not-real', name: 'Fixture' } });
  const account = await db.creditAccount.create({ data: { userId: user.id, balance: amount, totalEarned: amount } });
  await db.creditLot.create({ data: { accountId: account.id, sourceType: 'recharge', validityType: 'permanent', totalAmount: amount, remainingAmount: amount } });
  return { id: user.id, account: account.id };
}
async function balance(id: string) { return (await db.creditAccount.findUniqueOrThrow({ where: { userId: id } })).balance; }
async function teamBalance(id: string) { return db.teamCreditAccount.findUniqueOrThrow({ where: { teamId: id } }); }
async function run() {
  const pricingMessage = 'DeepSeek Flash CNY token pricing requires peak ModelRatio=1; apply the model pricing configuration patch';
  for (const message of [pricingMessage, `${pricingMessage} (request id: strict_safe-id:1)`]) {
    assert.equal(upstreamDiagnostic(400, { error: { message } }).errorCode, 'UPSTREAM_PRICING_NOT_CONFIGURED');
  }
  for (const message of [`prefix ${pricingMessage}`, `${pricingMessage} suffix`,
    `${pricingMessage} (request id: secret value)`, `${pricingMessage} (request id: ${'x'.repeat(129)})`]) {
    assert.equal(upstreamDiagnostic(400, { error: { message } }).errorCode, 'UPSTREAM_INVALID_REQUEST');
    assert.ok(!JSON.stringify(upstreamDiagnostic(400, { error: { message } })).includes('request id:'));
  }
  await db.$connect(); const owner = await user(10000);
  await db.creditLot.create({ data: { accountId: owner.account, sourceType: 'gift', validityType: 'permanent', totalAmount: 50, remainingAmount: 50, metadata: { reason: 'daily_reward' } } });
  await db.creditAccount.update({ where: { id: owner.account }, data: { balance: 10050, totalEarned: 10050 } });
  const model = (await chat.models(owner.id)).models[0]; assert.equal(model.pricing.unit, 'token'); assert.equal(model.pricing.priceCurrency, 'CNY'); assert.equal(model.supportsVision, true);
  const concurrent = await Promise.allSettled(Array.from({ length: 8 }, () => chat.complete(owner.id, body, headers('first'))));
  assert(concurrent.some(r => r.status === 'fulfilled'), JSON.stringify(concurrent.map((r: any) => r.reason?.message)));
  assert.equal(calls, 1); assert.equal(await balance(owner.id), 10050 - charged);
  assert.equal(await db.creditTransaction.count({ where: { apiUsageId: uid(owner.id, 'first'), type: 'spend' } }), 1);
  assert.equal((await db.creditLot.findFirstOrThrow({ where: { accountId: owner.account, sourceType: 'gift' } })).remainingAmount, 50 - charged);
  const firstReceipt = await request(owner.id, 'first');
  assert.equal(firstReceipt.billing?.upstreamRequestId, 'fixture-upstream-id');
  assert.equal(firstReceipt.billing?.exactCreditNanos, exactNanos.toString());
  assert.deepEqual(sent, body); assert.deepEqual(firstReceipt.response, completion);
  assert.deepEqual((await service().complete(owner.id, body, headers('first'))).usage, completion.usage); assert.equal(calls, 1);
  await code(chat.complete(owner.id, { ...body, temperature: 0.1 }, headers('first')), 'TANVA_IDEMPOTENCY_CONFLICT');
  await code(chat.complete(owner.id, body, headers('first', 'other-team')), 'TANVA_IDEMPOTENCY_CONFLICT');
  await Promise.all(Array.from({ length: 7 }, (_, i) => chat.complete(owner.id, body, headers(`tiny-${i}`))));
  assert.equal(await balance(owner.id), 10050 - charged * 8);
  const lots = await db.creditLot.findMany({ where: { accountId: owner.account } });
  assert.equal(lots.reduce((sum, lot) => sum + lot.remainingAmount, 0), await balance(owner.id));
  assert(lots.every(lot => lot.remainingAmount >= 0 && lot.remainingAmount <= lot.totalAmount));
  // Sequential reservation spanning sources refunds its recharge tail first.
  const sourceOwner = await user();
  await db.creditLot.create({ data: { accountId: sourceOwner.account, sourceType: 'gift', validityType: 'permanent', totalAmount: 5, remainingAmount: 5, metadata: { reason: 'daily_reward' } } });
  await db.creditAccount.update({ where: { id: sourceOwner.account }, data: { balance: 1005, totalEarned: 1005 } });
  const sourceResult = await chat.complete(sourceOwner.id, body, headers('sources'));
  const sourceCharge = sourceResult.tanvaReceipt.creditsCharged;
  assert.equal((await db.creditLot.findFirstOrThrow({ where: { accountId: sourceOwner.account, sourceType: 'gift' } })).remainingAmount, 5 - sourceCharge);
  assert.equal((await db.creditLot.findFirstOrThrow({ where: { accountId: sourceOwner.account, sourceType: 'recharge' } })).remainingAmount, 1000);
  const another = await user(); await assert.rejects(chat.request(another.id, `${prefix}:first`), (e: any) => e.getStatus?.() === 404);
  const beforeReject = await balance(owner.id);
  mode = '400'; await code(chat.complete(owner.id, body, headers('rejected')), 'TANVA_REQUEST_FAILED'); assert.equal(await balance(owner.id), beforeReject);
  assert.equal((await request(owner.id, 'rejected')).creditsCharged, 0); const rejectedCalls = calls;
  await code(service().complete(owner.id, body, headers('rejected')), 'TANVA_REQUEST_FAILED'); assert.equal(calls, rejectedCalls);
  for (const [upstreamStatus, httpStatus, errorCode] of [
    [400, 422, 'UPSTREAM_INVALID_REQUEST'], [401, 502, 'UPSTREAM_AUTH_FAILED'],
    [402, 502, 'UPSTREAM_QUOTA_EXHAUSTED'], [403, 502, 'UPSTREAM_AUTH_FAILED'],
    [404, 502, 'UPSTREAM_MODEL_UNAVAILABLE'], [405, 502, 'UPSTREAM_PROTOCOL_UNSUPPORTED'],
    [413, 413, 'UPSTREAM_REQUEST_TOO_LARGE'], [415, 502, 'UPSTREAM_PROTOCOL_UNSUPPORTED'],
    [422, 422, 'UPSTREAM_INVALID_REQUEST'], [429, 429, 'UPSTREAM_RATE_LIMITED'],
  ] as const) {
    mode = String(upstreamStatus); const key = `safe-rejected-${upstreamStatus}`;
    const before = await balance(owner.id);
    const checkError = (error: any) => {
      assert.equal(error.getStatus(), httpStatus);
      const payload = error.getResponse();
      assert.equal(payload.code, 'TANVA_REQUEST_FAILED'); assert.equal(payload.receipt.status, 'failed');
      assert.equal(payload.receipt.errorCode, errorCode); assert.equal(payload.receipt.upstreamStatus, upstreamStatus);
      assert.equal(payload.message, payload.receipt.errorMessage);
      assert.equal(payload.receipt.requestId, `${prefix}:${key}`);
      assert.equal(payload.receipt.billing.upstreamRequestId, 'safe-rejection-id');
      assert.ok(!JSON.stringify(payload).includes('fixture-sensitive-key'));
      assert.ok(!JSON.stringify(payload).includes('gateway.invalid'));
      return true;
    };
    await assert.rejects(chat.complete(owner.id, body, headers(key)), checkError);
    assert.equal(await balance(owner.id), before);
    const submitted = calls;
    await assert.rejects(service().complete(owner.id, body, headers(key)), checkError);
    assert.equal(calls, submitted, 'confirmed failed request replay must not call the supplier again');
    assert.ok(!JSON.stringify((await db.apiUsageRecord.findUniqueOrThrow({ where: { id: uid(owner.id, key) } })).requestParams).includes('fixture-sensitive-key'));
  }
  mode = 'signature-rejected';
  await assert.rejects(chat.complete(owner.id, body, headers('signature-rejected')), (error: any) => {
    assert.equal(error.getStatus(), 502); assert.equal(error.getResponse().receipt.errorCode, 'GATEWAY_ORDER_SIGNATURE_INVALID'); return true;
  });
  mode = 'pricing-not-configured';
  await assert.rejects(chat.complete(owner.id, body, headers('pricing-not-configured')), (error: any) => {
    assert.equal(error.getStatus(), 502); assert.equal(error.getResponse().receipt.errorCode, 'UPSTREAM_PRICING_NOT_CONFIGURED');
    assert.match(error.getResponse().message, /管理员同步模型计价配置/);
    assert.ok(!JSON.stringify(error.getResponse()).includes('ModelRatio')); return true;
  });
  console.log('PASS: confirmed 4xx diagnostics and strict pricing-message suffix mapping, safe JSON persistence, failed replay without another supplier submission');
  for (const outcome of ['503', '409', '425', 'disconnect', 'empty']) {
    mode = outcome; const before = await balance(owner.id); const key = `unknown-${outcome}`;
    await code(chat.complete(owner.id, body, headers(key)), 'TANVA_REQUEST_PENDING'); assert.equal(await balance(owner.id), before - reserve);
    const receipt = await request(owner.id, key); assert.equal(receipt.status, 'reconciliation_required');
    assert.equal(receipt.creditsCharged, 0); assert.equal(receipt.creditsReserved, reserve); const count = calls;
    await code(service().complete(owner.id, body, headers(key)), 'TANVA_REQUEST_PENDING'); assert.equal(calls, count);
  }
  mode = 'success';
  const team = await db.team.create({ data: { ownerId: owner.id, name: `${prefix}:team`, memberships: { create: { userId: owner.id, role: 'owner', creditQuotaTotal: 1000 } }, creditAccount: { create: { balance: 1000, totalEarned: 1000 } } } });
  const personal = await balance(owner.id);
  inspect = async () => { const acc = await teamBalance(team.id); assert.equal(acc.frozenBalance, reserve); assert.equal(acc.balance, 1000); assert.equal(await balance(owner.id), personal); };
  const beforeTeam = calls; await Promise.allSettled(Array.from({ length: 8 }, () => chat.complete(owner.id, body, headers('team-first', team.id))));
  const teamCharge = charged;
  assert.equal(calls, beforeTeam + 1); assert.equal((await teamBalance(team.id)).balance, 1000 - teamCharge); assert.equal((await teamBalance(team.id)).frozenBalance, 0);
  assert.equal(await balance(owner.id), personal); assert.equal((await request(owner.id, 'team-first')).creditsCharged, teamCharge);
  assert.equal(await db.teamCreditLedger.count({ where: { taskId: uid(owner.id, 'team-first'), entryType: 'deduct' } }), 1);
  inspect = undefined; mode = '400'; await code(chat.complete(owner.id, body, headers('team-reject', team.id)), 'TANVA_REQUEST_FAILED');
  assert.equal((await teamBalance(team.id)).balance, 1000 - teamCharge); assert.equal((await teamBalance(team.id)).frozenBalance, 0);
  assert.equal((await db.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: team.id, userId: owner.id } } })).creditUsedTotal, teamCharge);
  mode = '503'; await code(chat.complete(owner.id, body, headers('team-unknown', team.id)), 'TANVA_REQUEST_PENDING');
  assert.equal((await request(owner.id, 'team-unknown')).creditsReserved, reserve);
  await db.teamCreditLedger.updateMany({ where: { taskId: uid(owner.id, 'team-unknown'), entryType: 'reserve' }, data: { reserveExpiresAt: new Date(0) } });
  await ledger.releaseExpiredReserves(); assert.equal((await teamBalance(team.id)).frozenBalance, reserve);
  mode = 'success'; await db.teamMembership.update({ where: { teamId_userId: { teamId: team.id, userId: owner.id } }, data: { creditQuotaTotal: teamCharge + reserve } });
  const beforeQuota = calls; await assert.rejects(chat.complete(owner.id, body, headers('team-quota', team.id)), (e: any) => e.getStatus?.() === 403);
  assert.equal(calls, beforeQuota); assert.equal(await db.apiUsageRecord.count({ where: { id: uid(owner.id, 'team-quota') } }), 0);
  assert.equal(await db.teamCreditLedger.count({ where: { taskId: uid(owner.id, 'team-quota') } }), 0); assert.equal((await teamBalance(team.id)).frozenBalance, reserve);
  await assert.rejects(chat.complete(another.id, body, headers('unauthorized', team.id)), (e: any) => e.getStatus?.() === 403); assert.equal(calls, beforeQuota);
  const limited = await user(reserve); const beforeLimited = calls;
  const competition = await Promise.allSettled([chat.complete(limited.id, body, headers('limited-one')), chat.complete(limited.id, body, headers('limited-two'))]);
  assert.equal(competition.filter(r => r.status === 'fulfilled').length, 1); assert.equal(calls, beforeLimited + 1); assert.equal(await balance(limited.id), reserve - teamCharge);
  await db.teamMembership.update({ where: { teamId_userId: { teamId: team.id, userId: owner.id } }, data: { creditQuotaTotal: 1000 } });
  await db.$executeRawUnsafe(`CREATE FUNCTION fixture_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."responseStatus"='success' AND NEW.id='${uid(owner.id, 'recover')}' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fixture_completion_failure BEFORE UPDATE ON "ApiUsageRecord" FOR EACH ROW EXECUTE FUNCTION fixture_fail_completion()');
  try {
    await code(chat.complete(owner.id, body, headers('recover', team.id)), 'TANVA_REQUEST_PENDING');
    assert.equal((await teamBalance(team.id)).balance, 1000 - teamCharge); assert.equal((await teamBalance(team.id)).frozenBalance, reserve * 2);
    const row = await db.apiUsageRecord.findUniqueOrThrow({ where: { id: uid(owner.id, 'recover') } });
    assert.deepEqual((row.requestParams as any).desktopChat.response, completion);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER fixture_completion_failure ON "ApiUsageRecord"'); await db.$executeRawUnsafe('DROP FUNCTION fixture_fail_completion()'); }
  const beforeRecovery = calls; assert.equal((await service().request(owner.id, `${prefix}:recover`)).status, 'completed');
  assert.equal(calls, beforeRecovery); assert.equal((await teamBalance(team.id)).balance, 1000 - charged * 2); assert.equal((await teamBalance(team.id)).frozenBalance, reserve);
  await service().complete(owner.id, body, headers('recover', team.id)); assert.equal(calls, beforeRecovery);
  await db.$executeRawUnsafe(`CREATE FUNCTION fixture_fail_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='refund' AND NEW."apiUsageId"='${uid(owner.id, 'refund-recover')}' THEN RAISE EXCEPTION 'fixture refund failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fixture_refund_failure BEFORE INSERT ON "CreditTransaction" FOR EACH ROW EXECUTE FUNCTION fixture_fail_refund()');
  mode = '400'; const beforeRefund = await balance(owner.id);
  try {
    await code(chat.complete(owner.id, body, headers('refund-recover')), 'TANVA_REQUEST_PENDING');
    assert.equal(await balance(owner.id), beforeRefund - reserve);
    const row = await db.apiUsageRecord.findUniqueOrThrow({ where: { id: uid(owner.id, 'refund-recover') } });
    assert.equal((row.requestParams as any).desktopChat.rejectionConfirmed, true);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER fixture_refund_failure ON "CreditTransaction"'); await db.$executeRawUnsafe('DROP FUNCTION fixture_fail_refund()'); }
  const beforeRefundRecovery = calls;
  assert.equal((await service().request(owner.id, `${prefix}:refund-recover`)).status, 'failed');
  assert.equal(await balance(owner.id), beforeRefund); assert.equal(calls, beforeRefundRecovery); mode = 'success';
  // A personal known result whose final write fails preserves both the
  // original source reservation, then only settles that saved result.
  const beforePersonalRecovery = await balance(owner.id);
  await db.$executeRawUnsafe(`CREATE FUNCTION fixture_fail_personal_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."responseStatus"='success' AND NEW.id='${uid(owner.id, 'personal-recover')}' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fixture_personal_completion_failure BEFORE UPDATE ON "ApiUsageRecord" FOR EACH ROW EXECUTE FUNCTION fixture_fail_personal_completion()');
  try {
    await code(chat.complete(owner.id, body, headers('personal-recover')), 'TANVA_REQUEST_PENDING');
    assert.equal(await balance(owner.id), beforePersonalRecovery - reserve);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER fixture_personal_completion_failure ON "ApiUsageRecord"'); await db.$executeRawUnsafe('DROP FUNCTION fixture_fail_personal_completion()'); }
  const personalRecoveryCalls = calls;
  const recoveredPersonal = await request(owner.id, 'personal-recover'); assert.equal(recoveredPersonal.status, 'completed');
  assert.equal(await balance(owner.id), beforePersonalRecovery - charged);
  await request(owner.id, 'personal-recover'); assert.equal(calls, personalRecoveryCalls);
  // Settlements can supplement a conservative text estimate without creating
  // another receipt or losing source/actor quota accounting.
  const extraOwner = await user(1000);
  const extraTeam = await db.team.create({ data: { ownerId: extraOwner.id, name: 'extra-team', memberships: { create: { userId: extraOwner.id, role: 'owner' } }, creditAccount: { create: { balance: 1000, totalEarned: 1000 } } } });
  const normalUsage = completion.usage;
  completion.usage = { prompt_tokens: 200000, completion_tokens: 0, total_tokens: 200000, prompt_tokens_details: { cached_tokens: 0 } };
  const shortBody = { model: DESKTOP_CHAT_MODEL, stream: false, max_tokens: 1, messages: [{ role: 'user', content: 'a' }] };
  const extraNanos = BigInt(calculateDeepSeekUsage(createDeepSeekPricingSnapshot(new Date()), completion.usage).exactCreditNanos);
  const smallReserve = estimateDeepSeekReservation(createDeepSeekPricingSnapshot(new Date()), shortBody).creditsReserved;
  assert(roundUpDeepSeekCredits(extraNanos.toString()) > smallReserve);
  await chat.complete(extraOwner.id, shortBody, headers('extra-personal'));
  assert.equal(await balance(extraOwner.id), 1000 - roundUpDeepSeekCredits(extraNanos.toString()));
  await chat.complete(extraOwner.id, shortBody, headers('extra-team', extraTeam.id));
  assert.equal((await teamBalance(extraTeam.id)).balance, 1000 - roundUpDeepSeekCredits(extraNanos.toString()));
  assert.equal((await teamBalance(extraTeam.id)).frozenBalance, 0);
  assert.equal((await db.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: extraTeam.id, userId: extraOwner.id } } })).creditUsedTotal, roundUpDeepSeekCredits(extraNanos.toString()));
  completion.usage = normalUsage;
  // A gift that expires while fully reserved is not renewed by the partial
  // refund: the restored remainder is expired in the settlement transaction.
  const expiresOwner = await user(1000);
  const expiringGift = await db.creditLot.create({ data: { accountId: expiresOwner.account, sourceType: 'gift', validityType: 'fixed_window', totalAmount: 5, remainingAmount: 5,
    expiresAt: new Date(Date.now() + 60000), metadata: { reason: 'daily_reward' } } });
  await db.creditAccount.update({ where: { id: expiresOwner.account }, data: { balance: 1005, totalEarned: 1005 } });
  const originalExpiry = new Date(Date.now() - 1000);
  inspect = async () => { await db.creditLot.update({ where: { id: expiringGift.id }, data: { expiresAt: originalExpiry } }); };
  await chat.complete(expiresOwner.id, body, headers('expired-reserve')); inspect = undefined;
  const expiredGift = await db.creditLot.findUniqueOrThrow({ where: { id: expiringGift.id } });
  assert.equal(expiredGift.status, 'expired'); assert.equal(expiredGift.remainingAmount, 0); assert.equal(expiredGift.expiresAt!.getTime(), originalExpiry.getTime());
  assert.equal(await balance(expiresOwner.id), 1000);
  // If a new member quota cycle starts after acceptance, only the actual fee
  // belongs to that new monthly cycle; the old reservation is not subtracted.
  const cycleOwner = await user();
  const cycleTeam = await db.team.create({ data: { ownerId: cycleOwner.id, name: 'cycle-team', memberships: { create: { userId: cycleOwner.id, role: 'owner', creditQuotaMonthly: 1000 } }, creditAccount: { create: { balance: 1000, totalEarned: 1000 } } } });
  inspect = async () => { await db.teamMembership.update({ where: { teamId_userId: { teamId: cycleTeam.id, userId: cycleOwner.id } }, data: { quotaCycleStartAt: new Date(), creditUsedThisCycle: 0 } }); };
  await chat.complete(cycleOwner.id, body, headers('cycle', cycleTeam.id)); inspect = undefined;
  const cycleMember = await db.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: cycleTeam.id, userId: cycleOwner.id } } });
  assert.equal(cycleMember.creditUsedThisCycle, charged); assert.equal(cycleMember.creditUsedTotal, charged); assert.equal((await teamBalance(cycleTeam.id)).frozenBalance, 0);
  mode = '400';
  inspect = async () => { await db.teamMembership.update({ where: { teamId_userId: { teamId: cycleTeam.id, userId: cycleOwner.id } }, data: { quotaCycleStartAt: new Date(), creditUsedThisCycle: 7 } }); };
  await code(chat.complete(cycleOwner.id, body, headers('cycle-reject', cycleTeam.id)), 'TANVA_REQUEST_FAILED'); inspect = undefined; mode = 'success';
  const rejectedCycleMember = await db.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: cycleTeam.id, userId: cycleOwner.id } } });
  assert.equal(rejectedCycleMember.creditUsedThisCycle, 7); assert.equal(rejectedCycleMember.creditUsedTotal, charged); assert.equal((await teamBalance(cycleTeam.id)).frozenBalance, 0);
  // Historical fixed-price records retain their original receipt semantics.
  await credits.deductExact(another.id, null, 30, { apiUsageId: uid(another.id, 'legacy'), serviceType: 'gemini-text', provider: 'new-api', model: DESKTOP_CHAT_MODEL,
    responseStatus: 'success' as any, requestParams: { desktopChat: { requestId: `${prefix}:legacy`, taskId: `${prefix}:task`, conversationId: `${prefix}:conversation`, bodyHash: 'legacy',
      scope: { kind: 'personal' }, state: 'completed', credits: 30, deadline: new Date().toISOString(), response: completion } } });
  const oldReceipt = await request(another.id, 'legacy'); assert.equal(oldReceipt.creditsCharged, 30); assert.equal(oldReceipt.billing, undefined);
  // Missing cache information and malformed usage retain the original budget,
  // while repeated lookup never creates another provider request.
  const savedUsage = completion.usage;
  completion.usage = { prompt_tokens: 123, completion_tokens: 0, total_tokens: 123 } as any;
  await code(chat.complete(owner.id, body, headers('missing-cache')), 'TANVA_REQUEST_PENDING');
  const missingCalls = calls; await request(owner.id, 'missing-cache'); assert.equal(calls, missingCalls);
  completion.usage = savedUsage;
  assert.throws(() => validateCompletion({ ...body, model: 'unpriced-model' }));
  assert.throws(() => validateCompletion({ ...body, messages: [{ role: 'user', content: 'x'.repeat(MAX_REQUEST_BYTES) }] }));
  await assert.rejects(readBoundedJson(new Response('x'.repeat(300)), 100));
  const stalledCancel = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(101)); }, cancel() { return new Promise(() => {}); } }));
  await assert.rejects(readBoundedJson(stalledCancel, 100), /UPSTREAM_RESULT_TOO_LARGE/);
  const abort = new AbortController(); const hanging = new Response(new ReadableStream({ start() {} }));
  const aborted = readBoundedJson(hanging, 100, abort.signal); abort.abort(); await assert.rejects(aborted);
  assert.equal((await chat.listReceipts(owner.id, `${prefix}:task`, `${prefix}:conversation`)).receipts.length, 33);
  const users = { findById: (id: string) => db.user.findUnique({ where: { id } }), touchLastLoginAt: async () => {} };
  @Module({ imports: [PassportModule.register({ session: false })], controllers: [DesktopChatController], providers: [
    { provide: ConfigService, useValue: config }, { provide: UsersService, useValue: users }, { provide: DesktopChatService, useValue: chat }, JwtStrategy,
  ] }) class HttpFixtureModule {}
  const app = await NestFactory.create<NestFastifyApplication>(HttpFixtureModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never); app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false, forbidUnknownValues: false, transformOptions: { enableImplicitConversion: true } }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  const inject = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
  const jwt = new JwtService({ secret: 'isolated-desktop-chat' });
  const nativeCookie = { cookie: `access_token=${jwt.sign({ sub: owner.id }, { expiresIn: '5m' })}` };
  try {
    assert.equal((await inject({ method: 'GET', url: '/api/desktop/v1/billing' })).statusCode, 401);
    const httpModels = await inject({ method: 'GET', url: '/api/desktop/v1/models', headers: nativeCookie });
    assert.equal(httpModels.statusCode, 200); assert.equal(httpModels.json().models[0].id, DESKTOP_CHAT_MODEL);
    const httpBilling = await inject({ method: 'GET', url: '/api/desktop/v1/billing', headers: nativeCookie });
    assert.equal(httpBilling.statusCode, 200); assert.equal(httpBilling.json().scope.kind, 'personal'); assert.equal(httpBilling.json().balance, await balance(owner.id));
    const teamBilling = await inject({ method: 'GET', url: '/api/desktop/v1/billing', headers: { ...nativeCookie, 'x-tanva-team-id': team.id } });
    assert.equal(teamBilling.statusCode, 200); assert.equal(teamBilling.json().scope.teamId, team.id);
    const httpComplete = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...nativeCookie, ...headers('http') }, payload: body });
    assert.equal(httpComplete.statusCode, 200); assert.deepEqual(httpComplete.json().choices, completion.choices); assert.equal(typeof httpComplete.json().tanvaReceipt.billing.exactCredits, 'string'); assert.deepEqual(sent, body);
    const httpReceipt = await inject({ method: 'GET', url: `/api/desktop/v1/chat/requests/${prefix}:http`, headers: nativeCookie });
    assert.equal(httpReceipt.statusCode, 200); assert.deepEqual(httpReceipt.json().response.usage, completion.usage);
    const httpConflict = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...nativeCookie, ...headers('http') }, payload: { ...body, temperature: 0.3 } });
    assert.equal(httpConflict.statusCode, 409); assert.equal(httpConflict.json().code, 'TANVA_IDEMPOTENCY_CONFLICT');
    mode = '401';
    const httpRejected = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...nativeCookie, ...headers('http-rejected') }, payload: body });
    assert.equal(httpRejected.statusCode, 502); assert.equal(httpRejected.json().code, 'TANVA_REQUEST_FAILED');
    assert.equal(httpRejected.json().receipt.errorCode, 'UPSTREAM_AUTH_FAILED');
    assert.ok(!httpRejected.body.includes('fixture-sensitive-key'));
    mode = '409';
    const httpPending = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...nativeCookie, ...headers('http-pending') }, payload: body });
    assert.equal(httpPending.statusCode, 409); assert.equal(httpPending.json().receipt.status, 'reconciliation_required');
    const list = await inject({ method: 'GET', url: `/api/desktop/v1/billing/receipts?taskId=${prefix}:task&conversationId=${prefix}:conversation`, headers: nativeCookie });
    assert.equal(list.statusCode, 200); assert.equal(list.json().receipts.length, 36);
    if (process.env.TANVA_DESKTOP_TRANSPORT_FILE) {
      // Compile the sibling's actual ESM source into a temporary ESM file;
      // ts-node's CommonJS hook cannot require a type:module TypeScript file.
      const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
      const { pathToFileURL } = require('node:url');
      const sourcePath = fs.realpathSync(process.env.TANVA_DESKTOP_TRANSPORT_FILE);
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tanva-transport-contract-'));
      const source = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
        .replace(/from ['"](\.\/[^'"]+)['"]/g, (_: string, relative: string) => `from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(sourcePath), relative)).href)}`);
      const compiled = path.join(temp, 'transport.mjs'); fs.writeFileSync(compiled, source);
      const { createTanvasModelTransport } = await new Function('url', 'return import(url)')(pathToFileURL(compiled).href);
      let nativePosts = 0, nativeGets = 0;
      const session = { identity: 'fixture-native-cookie', assertCurrent() {}, async fetch(input: string | URL, init: RequestInit = {}) {
        const url = new URL(String(input));
        const h = Object.fromEntries(new Headers(init.headers));
        if (init.method === 'POST') nativePosts++;
        else nativeGets++;
        const value = await inject({ method: init.method || 'GET', url: url.pathname + url.search, headers: { ...nativeCookie, ...h },
          ...(init.body ? { payload: JSON.parse(String(init.body)) } : {}) });
        return new Response(value.body, { status: value.statusCode, headers: { 'content-type': 'application/json' } });
      } };
      mode = 'success';
      const transport = createTanvasModelTransport('https://fixture.invalid', session, { taskId: `${prefix}:native-task`, conversationId: `${prefix}:native-conversation`, model: DESKTOP_CHAT_MODEL });
      try {
        const before = calls; const input = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
        const response = await transport.fetchImpl('https://fixture.invalid/api/desktop/v1/chat/completions', input);
        assert.equal(response.status, 200); const result = await response.json();
        assert.deepEqual(result.choices, completion.choices); assert.deepEqual(result.usage, completion.usage);
        assert.equal(result.tanvaReceipt.billing.exactCreditNanos, exactNanos.toString()); assert.equal(result.tanvaReceipt.taskId, `${prefix}:native-task`);
        const repeated = await transport.fetchImpl('https://fixture.invalid/api/desktop/v1/chat/completions', input);
        assert.equal(repeated.status, 200); assert.equal(calls, before + 1); assert.equal(nativePosts, 1);
        for (const [fixtureMode, expectedStatus, expectedCode, temperature] of [
          ['pricing-not-configured', 502, 'UPSTREAM_PRICING_NOT_CONFIGURED', 0.7],
          ['400', 422, 'UPSTREAM_INVALID_REQUEST', 0.8],
        ] as const) {
          mode = fixtureMode;
          const supplierBefore = calls, queriesBefore = nativeGets;
          const failedInput = { ...input, body: JSON.stringify({ ...body, temperature }) };
          const failedResponse = await transport.fetchImpl('https://fixture.invalid/api/desktop/v1/chat/completions', failedInput);
          assert.equal(failedResponse.status, expectedStatus);
          const failure = await failedResponse.json();
          assert.equal(failure.error.code, expectedCode); assert.equal(failure.error.reason, 'receipt_failed');
          assert.equal(failure.error.receipt_status, 'failed'); assert.ok(!JSON.stringify(failure).includes('fixture-sensitive-key'));
          if (fixtureMode === 'pricing-not-configured') assert.match(failure.error.message, /管理员同步模型计价配置/);
          const failedReplay = await transport.fetchImpl('https://fixture.invalid/api/desktop/v1/chat/completions', failedInput);
          assert.equal(failedReplay.status, expectedStatus);
          assert.equal(calls, supplierBefore + 1, 'native transport failed replay must retain one supplier request');
          assert.equal(nativeGets, queriesBefore, 'terminal rejection must not enter a pending-receipt polling loop');
        }
        console.log('PASS: actual sibling tanvas-desk createTanvasModelTransport -> Cookie Nest/Fastify HTTP -> PostgreSQL accounting + exact receipt/choice/usage validation + same-body one provider call');
        console.log('PASS: actual desktop transport receives safe pricing 502/parameter 422 diagnostics, preserves failed receipt identity, no auto supplier retry or pending polling');
      } finally { transport.dispose(); fs.rmSync(temp, { recursive: true, force: true }); }
    }
    console.log('PASS: real Nest/Fastify controller + production JwtAuthGuard/JwtStrategy Cookie (no Bearer), PostgreSQL wallet/receipts, full tool history, 401/200/409/502 safe JSON contracts');
  } finally { await app.close(); }
  console.log('PASS: actual PG admission concurrency, personal source/refund, team reserve/commit/release/quota rollback, known-result settlement and confirmed-rejection refund recovery, persisted tools/vision/usage, restart/hash conflict, unknown409/425/empty/disconnect, authorization, insufficient balance, payload/response bounds and read abort');
  await gatewayMode();
}

async function gatewayMode() {
  const secret = 'isolated-gateway-consumption-test';
  const settings = { get: (key: string) => key === 'TANVA_CONSUMPTION_SECRET' ? secret : config.get(key) } as ConfigService;
  const orders = new GatewayConsumptionOrdersService(db, settings, credits, ledger, { publish: async () => {} } as any);
  const gateway = new DesktopChatService(settings, db, credits, ledger, undefined, orders);
  const owner = await user(10000);
  const claims = new Map<string, any>(), proofs = new Map<string, unknown>(); let posts = 0;
  const envelope = (proof: any) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = Buffer.from(JSON.stringify(proof)).toString('base64url');
    return { timestamp, payload, signature: createHmac('sha256', secret).update(`${timestamp}\n${payload}`).digest('hex') };
  };
  const makeProof = (id: string, status = 'consumed') => {
    const claim = claims.get(id); assert(claim);
    return envelope({ version: 1, eventId: `event:${id}`, revision: 2, orderId: id, orderHash: claim.orderHash,
      gatewayInstanceId: 'tanva-new-api', gatewayRequestId: 'gateway-posted-request', model: DESKTOP_CHAT_MODEL,
      status, priceCurrency: 'CNY', costCny: status === 'consumed' ? '0.019312' : '0', quota: status === 'consumed' ? '9656' : '0',
      quotaPerUnit: '500000', startedAt: new Date().toISOString(), settledAt: new Date().toISOString(), usageEvidence: 'upstream_tokens' });
  };
  let outcome = 'success';
  (orders as any).fetchImpl = async (url: string) => {
    const id = decodeURIComponent(new URL(url).pathname.split('/').pop()!);
    return proofs.has(id) ? new Response(JSON.stringify(proofs.get(id))) : new Response('{}', { status: 404 });
  };
  (gateway as any).fetchImpl = async (input: string, init: RequestInit) => {
    if (input.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: DESKTOP_CHAT_MODEL }] }));
    posts++;
    const h = new Headers(init.headers), id = h.get('X-Tanva-Order-Id')!;
    assert.equal(h.get('X-Tanva-Signature'), signGatewayRequest(secret, h.get('X-Tanva-Timestamp')!, 'POST', '/v1/chat/completions', id, h.get('X-Tanva-Order-Hash')!, String(init.body)));
    claims.set(id, { orderHash: h.get('X-Tanva-Order-Hash') });
    if (outcome === 'lost-response') { proofs.set(id, makeProof(id)); throw new Error('response lost after gateway consumption'); }
    if (outcome === '400-consumed') { proofs.set(id, makeProof(id)); return new Response('{}', { status: 400 }); }
    if (outcome === '400-rejected') { proofs.set(id, makeProof(id, 'rejected')); return new Response('{}', { status: 400 }); }
    // The model can return without token usage; only the gateway receipt bills it.
    return new Response(JSON.stringify({ id: 'actual-output', model: DESKTOP_CHAT_MODEL, choices: completion.choices }));
  };
  assert.equal((await gateway.models(owner.id)).models[0].pricing.settlementSource, 'new_api_consumption');
  const first = await gateway.complete(owner.id, body, headers('consumption-pending'));
  assert.equal(first.tanvaReceipt.status, 'completed'); assert.equal(first.tanvaReceipt.billing.mode, 'gateway_consumption');
  assert.notEqual(first.tanvaReceipt.billing.settlementStatus, 'settled'); assert.equal(first.tanvaReceipt.creditsCharged, 0);
  assert.equal(first.tanvaReceipt.creditsReserved, reserve); assert.deepEqual(first.choices, completion.choices);
  const firstId = uid(owner.id, 'consumption-pending');
  const proof = makeProof(firstId); await Promise.all(Array.from({ length: 8 }, () => orders.receiveEnvelope(proof)));
  const settled = await gateway.request(owner.id, `${prefix}:consumption-pending`);
  assert.equal(settled.status, 'completed'); assert.equal(settled.billing.settlementStatus, 'settled');
  assert.equal(settled.billing.gatewayCostCny, '0.019312'); assert.equal(settled.billing.exactCredits, '2.8968');
  assert.equal(settled.creditsCharged, 3); assert.equal(settled.creditsReserved, 0); assert.equal(await balance(owner.id), 9997);
  const beforeReplay = posts; await gateway.complete(owner.id, body, headers('consumption-pending')); assert.equal(posts, beforeReplay);
  outcome = 'lost-response';
  await code(gateway.complete(owner.id, body, headers('consumption-lost')), 'TANVA_REQUEST_PENDING');
  const lost = await gateway.request(owner.id, `${prefix}:consumption-lost`);
  assert.equal(lost.status, 'reconciliation_required'); assert.equal(lost.billing.settlementStatus, 'settled');
  assert.equal(lost.creditsCharged, 3); assert.equal(lost.response, undefined); assert.equal(await balance(owner.id), 9994);
  const noRepeat = posts; await code(gateway.complete(owner.id, body, headers('consumption-lost')), 'TANVA_REQUEST_PENDING'); assert.equal(posts, noRepeat);
  outcome = '400-consumed';
  await code(gateway.complete(owner.id, body, headers('consumption-failed')), 'TANVA_REQUEST_FAILED');
  const failed = await gateway.request(owner.id, `${prefix}:consumption-failed`);
  assert.equal(failed.status, 'failed'); assert.equal(failed.billing.settlementStatus, 'settled'); assert.equal(failed.creditsCharged, 3);
  assert.equal(await balance(owner.id), 9991);
  outcome = '400-rejected';
  await code(gateway.complete(owner.id, body, headers('consumption-rejected')), 'TANVA_REQUEST_FAILED');
  const rejected = await gateway.request(owner.id, `${prefix}:consumption-rejected`);
  assert.equal(rejected.billing.settlementStatus, 'rejected'); assert.equal(rejected.creditsReserved, 0); assert.equal(await balance(owner.id), 9991);
  console.log('PASS: desktop delivery independent of actual New API consumption; signed exact body, missing usage accepted, callback concurrency, response loss reconciled without new POST, failed output still charged, authoritative rejection releases reservation');
}
run().finally(() => db.$disconnect()).catch(e => { console.error(e); process.exitCode = 1; });
