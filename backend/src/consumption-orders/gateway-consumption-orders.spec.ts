import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { BusinessPolicyService } from '../business-policy/business-policy.service';
import { TeamCreditLedgerService } from '../team-credits/team-credit-ledger.service';
import { GatewayConsumptionOrdersService } from './gateway-consumption-orders.service';
import { GatewayConsumptionOrdersController } from './gateway-consumption-orders.controller';
import { consumptionCredits, GatewayConsumptionPayload, signGatewayRequest, verifyConsumptionEnvelope } from './gateway-consumption.protocol';

const url = process.env.DESKTOP_CHAT_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/desktop_chat_test(?:\?|$)/.test(url)) throw new Error('Consumption tests require isolated local PostgreSQL');
Logger.overrideLogger(['error']);
const db = new PrismaService({ datasources: { db: { url } } });
const secret = 'tanva-test-secret';
const config = { get: (key: string) => ({ TANVA_CONSUMPTION_SECRET: secret, NEW_API_BASE_URL: 'https://fixture.invalid', NEW_API_KEY: 'fixture-only', NODE_ENV: 'test', REDIS_URL: '' } as Record<string, string>)[key] } as ConfigService;
const credits = new CreditsService(db, config, new BusinessPolicyService(db), {} as any);
const ledger = new TeamCreditLedgerService(db);
const publisher = { publish: async () => undefined } as any;
const service = () => new GatewayConsumptionOrdersService(db, config, credits, ledger, publisher);
const orders = service();
const envelope = (payload: GatewayConsumptionPayload, timestamp = String(Math.floor(Date.now() / 1000))) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { timestamp, payload: body, signature: createHmac('sha256', secret).update(`${timestamp}\n${body}`).digest('hex') };
};
const hash = '0123456789abcdef';
function proof(orderId: string, status: GatewayConsumptionPayload['status'] = 'consumed', revision = 1): GatewayConsumptionPayload {
  return { version: 1, orderId, orderHash: hash, eventId: `event-${orderId}`, revision,
    gatewayInstanceId: 'tanva-new-api', gatewayRequestId: `gateway-${orderId}`, model: 'deepseek-v4.1-flash',
    status, priceCurrency: 'CNY', quotaPerUnit: '500000', startedAt: new Date().toISOString(),
    usageEvidence: 'upstream_tokens',
    ...(['consumed', 'rejected'].includes(status) ? { costCny: status === 'consumed' ? '0.019312' : '0',
      quota: status === 'consumed' ? '9656' : '0', settledAt: new Date().toISOString() } : {}) };
}
async function owner() {
  const user = await db.user.create({ data: { phone: `consumption-${randomUUID()}`, passwordHash: 'fixture', name: 'Consumption Fixture' } });
  const account = await db.creditAccount.create({ data: { userId: user.id, balance: 1000, totalEarned: 1000 } });
  await db.creditLot.create({ data: { accountId: account.id, sourceType: 'recharge', validityType: 'permanent', totalAmount: 1000, remainingAmount: 1000 } });
  return user;
}
async function admit(userId: string, amount = 30, teamId: string | null = null, model = 'deepseek-v4.1-flash') {
  const id = `consumption-test:${randomUUID()}`;
  await db.$transaction(async tx => {
    await credits.deductExact(userId, teamId, amount, { apiUsageId: id, serviceType: 'gemini-text', provider: 'new-api', model,
      responseStatus: 'pending' as any, requestParams: { gatewayConsumption: { orderHash: hash }, ...(teamId ? { teamId } : {}) } }, tx);
    if (teamId) assert((await ledger.reserve({ teamId, amount, taskId: id, actorUserId: userId }, tx)).reserved);
    assert(await orders.register(id, tx));
  });
  return id;
}
const balance = async (id: string) => (await db.creditAccount.findUniqueOrThrow({ where: { userId: id } })).balance;
async function run() {
  await db.$connect();
  assert.deepEqual(consumptionCredits('0.019312'), { creditsCharged: 3, exactCredits: '2.8968', exactCreditNanos: '2896800000' });
  assert.equal(consumptionCredits('0.01').creditsCharged, 2);
  assert.equal(consumptionCredits('0').creditsCharged, 0);
  assert.throws(() => consumptionCredits('1e-2'));
  const pure = proof('usage-1');
  assert.deepEqual(verifyConsumptionEnvelope(envelope(pure), secret), pure);
  assert.throws(() => verifyConsumptionEnvelope(envelope(pure, '1791172800'), secret, new Date('2026-10-05T06:00:00Z')));
  assert.throws(() => verifyConsumptionEnvelope({ ...envelope(pure), signature: '0'.repeat(64) }, secret));
  assert.throws(() => verifyConsumptionEnvelope(envelope({ ...pure, costCny: '0.019311' }), secret), /quota disagree/);
  assert.throws(() => verifyConsumptionEnvelope(envelope({ ...pure, status: 'rejected' }), secret), /cannot have a charge/);
  const requestBody = '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hello"}]}';
  assert.equal(signGatewayRequest(secret, '1791172800', 'POST', '/v1/chat/completions', 'usage-1', hash, requestBody), '9c1b4b00acd9bd776ad17d363f8c0caf4602bf1c65207a481f7499c3cf1fa770');
  assert.equal(signGatewayRequest(secret, '1791172800', 'GET', '/v1/tanva/consumptions/usage-1', 'usage-1', hash, ''), '1d3e8f2ae1cd187318f5413f555b29f7a1575782b90c10f7186ea996413f8b21');
  const user = await owner(); const id = await admit(user.id);
  assert.equal(orders.isWebEnabled(), true, 'an unset scope retains existing global behavior');
  const desktopConfig = { get: (key: string) => key === 'TANVA_CONSUMPTION_SCOPE' ? 'desktop' : config.get(key) } as ConfigService;
  const desktopOrders = new GatewayConsumptionOrdersService(db, desktopConfig, credits, ledger, publisher);
  const webRow = await db.apiUsageRecord.create({ data: { userId: user.id, serviceType: 'gemini-text', serviceName: 'scope fixture',
    provider: 'new-api', model: 'deepseek-v4.1-flash', creditsUsed: 0, responseStatus: 'pending',
    requestParams: { deepseekBilling: { bodyHash: hash } } } });
  await db.$transaction(async tx => {
    assert.equal(await desktopOrders.register(webRow.id, tx), false, 'new website requests remain in their existing billing mode');
    assert.equal(await desktopOrders.register(id, tx), true, 'existing website orders remain available for recovery');
  });
  assert.equal((await db.apiUsageRecord.findUniqueOrThrow({ where: { id: webRow.id } })).consumptionStatus, null);
  // Known model output may already be successful. Consumption settlement remains independent.
  await db.apiUsageRecord.update({ where: { id }, data: { responseStatus: 'success', requestParams: { gatewayConsumption: { orderHash: hash }, modelOutput: { status: 'ready', response: { text: 'original' } } } } });
  const bodyBefore = (await db.apiUsageRecord.findUniqueOrThrow({ where: { id } })).requestParams;
  const headers = await orders.gatewayHeaders(id, { method: 'POST', path: '/v1/chat/completions', rawBody: requestBody });
  assert.equal(headers['X-Tanva-Signature'], signGatewayRequest(secret, headers['X-Tanva-Timestamp'], 'POST', '/v1/chat/completions', id, hash, requestBody));
  const consumed = proof(id);
  const results = await Promise.all(Array.from({ length: 8 }, () => desktopOrders.receiveEnvelope(envelope(consumed))));
  assert(results.every(r => r.status === 'settled')); assert.equal(await balance(user.id), 997);
  const row = await db.apiUsageRecord.findUniqueOrThrow({ where: { id } });
  assert.equal(row.responseStatus, 'success'); assert.deepEqual(row.requestParams, bodyBefore); assert.equal(row.creditsUsed, 3);
  assert.equal(await db.creditTransaction.count({ where: { apiUsageId: id, type: 'adjustment' } }), 1);
  await orders.receiveEnvelope(envelope({ ...consumed, status: 'pending', revision: 0, costCny: undefined, quota: undefined, settledAt: undefined }));
  assert.equal((await orders.getState(id)).status, 'settled', 'an older pending revision cannot regress consumption settlement');
  await assert.rejects(orders.receiveEnvelope(envelope({ ...consumed, orderHash: 'other' })));
  await assert.rejects(orders.receiveEnvelope(envelope({ ...consumed, costCny: '0.02', quota: '10000' })));
  const missingOutput = await admit(user.id); await orders.receiveEnvelope(envelope(proof(missingOutput)));
  assert.equal((await db.apiUsageRecord.findUniqueOrThrow({ where: { id: missingOutput } })).responseStatus, 'pending', 'a paid order cannot manufacture model output');
  const unknown = await admit(user.id); const pending = proof(unknown, 'pending', 0);
  await orders.receiveEnvelope(envelope(pending));
  await db.apiUsageRecord.update({ where: { id: unknown }, data: { responseStatus: 'failed' } });
  await assert.rejects(credits.refundCredits(user.id, unknown));
  let queries = 0;
  (orders as any).fetchImpl = async (_input: unknown, init: RequestInit) => { queries++; assert.equal(init.method, 'GET'); return new Response('{}', { status: 404 }); };
  await orders.reconcile(unknown); assert.equal(queries, 1); assert.equal((await orders.getState(unknown)).status, 'reconciliation_required');
  const beforeReject = await balance(user.id); await orders.receiveEnvelope(envelope(proof(unknown, 'rejected', 1)));
  assert.equal(await balance(user.id), beforeReject + 30); assert.equal((await orders.getState(unknown)).creditsCharged, 0);
  // Persisted proof survives a real wallet transaction rollback and service restart.
  const recovery = await admit(user.id); const recoveryProof = proof(recovery);
  await db.$executeRawUnsafe(`CREATE FUNCTION consumption_fail_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'adjustment' AND NEW."apiUsageId" = '${recovery}' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER consumption_fail_adjustment_trigger BEFORE INSERT ON "CreditTransaction" FOR EACH ROW EXECUTE FUNCTION consumption_fail_adjustment()');
  assert.equal((await orders.receiveEnvelope(envelope(recoveryProof))).status, 'reconciliation_required');
  assert((await db.apiUsageRecord.findUniqueOrThrow({ where: { id: recovery } })).consumptionReceipt);
  await db.$executeRawUnsafe('DROP TRIGGER consumption_fail_adjustment_trigger ON "CreditTransaction"');
  await db.$executeRawUnsafe('DROP FUNCTION consumption_fail_adjustment()');
  const restarted = service(); (restarted as any).fetchImpl = async () => { throw new Error('must use retained receipt without a gateway query'); };
  assert.equal((await restarted.reconcile(recovery)).status, 'settled');
  // A rejected order keeps its zero-consumption proof across a refund rollback.
  // Restoring its original expired gift lot must not revive expired entitlement.
  const giftUser = await owner();
  const giftAccount = await db.creditAccount.findUniqueOrThrow({ where: { userId: giftUser.id } });
  const gift = await db.creditLot.create({ data: { accountId: giftAccount.id, sourceType: 'gift', validityType: 'fixed_window', totalAmount: 30, remainingAmount: 30,
    expiresAt: new Date(Date.now() + 60_000), metadata: { reason: 'daily_reward' } } });
  await db.creditAccount.update({ where: { id: giftAccount.id }, data: { balance: 1030, totalEarned: 1030 } });
  const rejectedRecovery = await admit(giftUser.id);
  assert.equal((await db.creditLot.findUniqueOrThrow({ where: { id: gift.id } })).remainingAmount, 0);
  const originalExpiry = new Date(Date.now() - 1000);
  await db.creditLot.update({ where: { id: gift.id }, data: { expiresAt: originalExpiry } });
  await db.$executeRawUnsafe(`CREATE FUNCTION consumption_fail_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'refund' AND NEW."apiUsageId" = '${rejectedRecovery}' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER consumption_fail_refund_trigger BEFORE INSERT ON "CreditTransaction" FOR EACH ROW EXECUTE FUNCTION consumption_fail_refund()');
  assert.equal((await orders.receiveEnvelope(envelope(proof(rejectedRecovery, 'rejected')))).status, 'reconciliation_required');
  assert.equal(await balance(giftUser.id), 1000);
  await db.$executeRawUnsafe('DROP TRIGGER consumption_fail_refund_trigger ON "CreditTransaction"');
  await db.$executeRawUnsafe('DROP FUNCTION consumption_fail_refund()');
  assert.equal((await restarted.reconcile(rejectedRecovery)).status, 'rejected');
  const expiredGift = await db.creditLot.findUniqueOrThrow({ where: { id: gift.id } });
  assert.equal(expiredGift.status, 'expired'); assert.equal(expiredGift.remainingAmount, 0);
  assert.equal(expiredGift.expiresAt!.getTime(), originalExpiry.getTime()); assert.equal(await balance(giftUser.id), 1000);
  await restarted.reconcile(rejectedRecovery);
  assert.equal(await db.creditTransaction.count({ where: { apiUsageId: rejectedRecovery, type: 'refund' } }), 1);
  const pulled = await admit(user.id); const pulledProof = proof(pulled);
  (restarted as any).fetchImpl = async (input: string, init: RequestInit) => { assert(String(input).includes('/v1/tanva/consumptions/')); assert.equal(init.method, 'GET'); return Response.json(envelope(pulledProof)); };
  await db.apiUsageRecord.update({ where: { id: pulled }, data: { consumptionNextCheckAt: new Date(0) } });
  await restarted.reconcilePendingOrders(); assert.equal((await restarted.getState(pulled)).status, 'settled');
  const team = await db.team.create({ data: { ownerId: user.id, name: 'Consumption team', memberships: { create: { userId: user.id, role: 'owner', creditQuotaMonthly: 1000, creditQuotaTotal: 1000 } }, creditAccount: { create: { balance: 1000, totalEarned: 1000 } } } });
  const teamOrder = await admit(user.id, 30, team.id); const personalBefore = await balance(user.id);
  await db.apiUsageRecord.update({ where: { id: teamOrder }, data: { responseStatus: 'failed' } });
  await assert.rejects(ledger.release({ teamId: team.id, amount: 30, taskId: teamOrder }));
  await orders.receiveEnvelope(envelope(proof(teamOrder)));
  const account = await db.teamCreditAccount.findUniqueOrThrow({ where: { teamId: team.id } });
  const member = await db.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: team.id, userId: user.id } } });
  assert.equal(account.balance, 997); assert.equal(account.frozenBalance, 0); assert.equal(member.creditUsedThisCycle, 3); assert.equal(member.creditUsedTotal, 3); assert.equal(await balance(user.id), personalBefore);
  const fixed = await admit(user.id, 2, null, 'xiaot-agent-deepseek-v4-flash');
  await orders.receiveEnvelope(envelope({ ...proof(fixed), model: 'xiaot-agent-deepseek-v4-flash', costCny: '0.01', quota: '5000', usageEvidence: 'gateway_fixed_price' }));
  assert.equal((await orders.getState(fixed)).creditsCharged, 2);
  const unregistered = await db.apiUsageRecord.create({ data: { userId: user.id, provider: 'new-api', serviceType: 'gemini-text', serviceName: 'Legacy', model: 'deepseek-v4.1-flash', creditsUsed: 30, responseStatus: 'success' } });
  assert.deepEqual(await orders.getState(unregistered.id), { enabled: false });
  await assert.rejects(db.$transaction(tx => orders.register(unregistered.id, tx)));
  @Module({ controllers: [GatewayConsumptionOrdersController], providers: [{ provide: GatewayConsumptionOrdersService, useValue: orders }] })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, new FastifyAdapter(), { logger: false });
  app.setGlobalPrefix('api'); await app.init(); const fastify = app.getHttpAdapter().getInstance(); await fastify.ready();
  try {
    const denied = await fastify.inject({ method: 'POST', url: '/api/internal/new-api/consumptions', payload: { ...envelope(consumed), signature: '0'.repeat(64) } });
    assert.equal(denied.statusCode, 401);
    const duplicate = await fastify.inject({ method: 'POST', url: '/api/internal/new-api/consumptions', payload: envelope(consumed) });
    assert.equal(duplicate.statusCode, 200); assert.equal(duplicate.json().status, 'settled');
    if (process.env.TANVA_CONSUMPTION_GO_INTEGRATION === '1') {
      const orderId = await admit(user.id);
      const before = await balance(user.id);
      await app.listen(0, '127.0.0.1');
      const address = fastify.server.address();
      assert(address && typeof address !== 'string');
      await new Promise<void>((resolve, reject) => {
        const child = spawn('go', ['test', './service', '-run', '^TestTanvaConsumptionRelayToBackend$', '-count=1', '-v'], {
          cwd: path.resolve(__dirname, '../../../new-api'),
          env: { ...process.env, TANVA_CONSUMPTION_TEST_CALLBACK_URL: `http://127.0.0.1:${address.port}/api/internal/new-api/consumptions`,
            TANVA_CONSUMPTION_TEST_ORDER_ID: orderId, TANVA_CONSUMPTION_TEST_ORDER_HASH: hash, TANVA_CONSUMPTION_TEST_SECRET: secret },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const deadline = setTimeout(() => { child.kill(); reject(new Error('Local Go relay integration timed out')); }, 120_000);
        child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data));
        child.on('error', error => { clearTimeout(deadline); reject(error); });
        child.on('exit', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(new Error(`Local Go relay integration failed (${code})`)); });
      });
      const settled = await orders.getState(orderId);
      assert.equal(settled.status, 'settled'); assert.equal(settled.creditsCharged, 3);
      assert.equal(await balance(user.id), before + 30 - 3);
      assert.equal((await db.apiUsageRecord.findUniqueOrThrow({ where: { id: orderId } })).responseStatus, 'pending');
      console.log('PASS: actual Go controller.Relay/local supplier/database outbox -> signed HTTP callback -> Nest/Fastify -> real PostgreSQL wallet, with model output still unrecovered');
    }
  } finally { await app.close(); }
  console.log('PASS: signed consumption webhook + authoritative GET/cron + real PostgreSQL personal lot/team settlement, response-independent charging, replay/rollback/restart recovery, unknown preservation and legacy exclusion');
}
run().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
