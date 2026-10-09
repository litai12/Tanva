import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import cookie from '@fastify/cookie';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { CreditsService } from '../credits/credits.service';
import { BusinessPolicyService } from '../business-policy/business-policy.service';
import { TeamCreditLedgerService } from '../team-credits/team-credit-ledger.service';
import { GatewayConsumptionOrdersService } from '../consumption-orders/gateway-consumption-orders.service';
import { GatewayConsumptionPayload, consumptionCredits } from '../consumption-orders/gateway-consumption.protocol';
import { DesktopChatController } from './desktop-chat.controller';
import { DesktopChatService } from './desktop-chat.service';
import { usageId } from './desktop-chat.protocol';

const url = process.env.DESKTOP_CHAT_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/desktop_chat_test(?:\?|$)/.test(url)) throw new Error('Dynamic desktop tests require isolated local PostgreSQL');
Logger.overrideLogger(['error']);
const db = new PrismaService({ datasources: { db: { url } } });
const secret = 'dynamic-desktop-fixture-secret';
const config = { get: (key: string) => ({ TANVA_CONSUMPTION_SECRET: secret, NEW_API_BASE_URL: 'https://fixture.invalid', NEW_API_KEY: 'fixture-only',
  TANVA_CONSUMPTION_SCOPE: 'desktop', JWT_ACCESS_SECRET: 'dynamic-desktop-jwt', NODE_ENV: 'test', REDIS_URL: '' } as Record<string, string>)[key] } as ConfigService;
const credits = new CreditsService(db, config, new BusinessPolicyService(db), {} as any);
const ledger = new TeamCreditLedgerService(db);
const orders = new GatewayConsumptionOrdersService(db, config, credits, ledger, { publish: async () => {} } as any);
const chat = new DesktopChatService(config, db, credits, ledger, undefined, orders);
const model = 'dynamic-fixture-chat';
const media = 'dynamic-fixture-video';
const prefix = randomUUID();
let enabled = true, lost = false, posts = 0;
const claims = new Map<string, string>();
const prices = (name: string) => ({ channel_id: 9, model_name: name, currency: 'CNY', enable_groups: ['default'],
  input: 0.8, output: 4, cache_read: 0.08, cache_write: 1, text_price_multiplier: 0.4 });
const envelope = (id: string, status: 'consumed' | 'rejected' = 'consumed') => {
  const proof: GatewayConsumptionPayload = { version: 1, eventId: `event-${id}`, revision: 1, orderId: id,
    orderHash: claims.get(id)!, gatewayInstanceId: 'tanva-new-api', gatewayRequestId: 'dynamic-gateway-request', model,
    status, priceCurrency: 'CNY', costCny: status === 'consumed' ? '0.019312' : '0', quota: status === 'consumed' ? '9656' : '0',
    quotaPerUnit: '500000', startedAt: new Date().toISOString(), settledAt: new Date().toISOString(), usageEvidence: 'upstream_tokens' };
  const timestamp = String(Math.floor(Date.now() / 1000)), payload = Buffer.from(JSON.stringify(proof)).toString('base64url');
  return { timestamp, payload, signature: createHmac('sha256', secret).update(`${timestamp}\n${payload}`).digest('hex') };
};
(chat as any).fetchImpl = async (input: string, init: RequestInit) => {
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture-only');
  if (input.endsWith('/models')) return Response.json({ data: [{ id: model }, { id: media }, { id: 'missing-kind' }, { id: 'unpriced-chat' }] });
  if (input.endsWith('/pricing')) return Response.json({ data: [
    ...(enabled ? [{ model_name: model, model_kind: 'chat', capabilities: ['function_calling'], model_ratio: 0.4, channel_text_prices: [prices(model)] }] : []),
    { model_name: media, model_kind: 'video', channel_text_prices: [prices(media)] },
    { model_name: 'missing-kind', channel_text_prices: [prices('missing-kind')] },
    { model_name: 'unpriced-chat', model_kind: 'chat', channel_text_prices: [{ ...prices('unpriced-chat'), input: null }] },
    { model_name: 'not-executable', model_kind: 'chat', channel_text_prices: [prices('not-executable')] },
  ] });
  posts++;
  const headers = new Headers(init.headers), id = headers.get('X-Tanva-Order-Id')!;
  assert(headers.get('X-Tanva-Signature')); claims.set(id, headers.get('X-Tanva-Order-Hash')!);
  const body = JSON.parse(String(init.body)); assert.equal(body.model, model);
  if (lost) throw new Error('fixture response lost after supplier admission');
  return Response.json({ id: 'dynamic-output', model, choices: [{ message: { role: 'assistant', content: 'original result' } }],
    usage: { prompt_tokens: 999999, completion_tokens: 999999 } });
};
(orders as any).fetchImpl = async () => Response.json({}, { status: 404 });
async function owner(balance: number) {
  const user = await db.user.create({ data: { phone: `dynamic-${randomUUID()}`, passwordHash: 'fixture', name: 'Dynamic fixture' } });
  const account = await db.creditAccount.create({ data: { userId: user.id, balance, totalEarned: balance } });
  if (balance) await db.creditLot.create({ data: { accountId: account.id, sourceType: 'recharge', validityType: 'permanent', totalAmount: balance, remainingAmount: balance } });
  return { id: user.id, account: account.id };
}
const balance = async (id: string) => (await db.creditAccount.findUniqueOrThrow({ where: { userId: id } })).balance;
function headers(key: string, teamId?: string) {
  return { 'idempotency-key': `${prefix}:${key}`, 'x-tanva-task-id': `${prefix}:task`, 'x-tanva-conversation-id': `${prefix}:conversation`,
    ...(teamId ? { 'x-tanva-team-id': teamId } : {}) };
}
const body = { model, messages: [{ role: 'user', content: 'dynamic request' }] };
async function run() {
  await db.$connect();
  assert.equal(orders.isEnabled(), true);
  assert.equal(orders.isWebEnabled(), false, 'desktop signing must not enable website billing');
  const user = await owner(10);
  const users = { findById: (id: string) => db.user.findUnique({ where: { id } }), touchLastLoginAt: async () => {} };
  @Module({ imports: [PassportModule.register({ session: false })], controllers: [DesktopChatController], providers: [
    { provide: ConfigService, useValue: config }, { provide: UsersService, useValue: users }, { provide: DesktopChatService, useValue: chat }, JwtStrategy,
  ] }) class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never); app.setGlobalPrefix('api'); await app.init(); await app.getHttpAdapter().getInstance().ready();
  const inject = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
  const auth = { cookie: `access_token=${new JwtService({ secret: 'dynamic-desktop-jwt' }).sign({ sub: user.id }, { expiresIn: '5m' })}` };
  try {
    const catalog = await inject({ method: 'GET', url: '/api/desktop/v1/models', headers: auth });
    assert.equal(catalog.statusCode, 200); assert.deepEqual(catalog.json().data, catalog.json().models);
    assert.deepEqual(catalog.json().models.map((item: { id: string }) => item.id), [model]);
    assert.equal(catalog.json().models[0].pricing.markup, 1); assert.equal(catalog.json().models[0].pricing.inputCnyPerMillion, 0.8);
    assert.equal(catalog.json().models[0].pricing.input_ratio, 0.4);
    assert.equal(catalog.json().models[0].supportsTools, true); assert.equal(catalog.json().models[0].supportsVision, false);
    const result = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...auth, ...headers('first') }, payload: body });
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().tanvaReceipt.creditsReserved, 0);
    assert.equal(result.json().tanvaReceipt.creditsCharged, 0); assert.equal(result.json().tanvaReceipt.billing.mode, 'gateway_consumption');
    assert.equal(result.json().tanvaReceipt.billing.markup, 1); assert.equal(result.json().tanvaReceipt.billing.snapshot, undefined);
    const id = usageId(user.id, `${prefix}:first`);
    assert.equal(await balance(user.id), 10); assert.equal(await db.creditTransaction.count({ where: { apiUsageId: id } }), 0);
    assert.equal((await db.apiUsageRecord.findUniqueOrThrow({ where: { id } })).creditsUsed, 0);
    await orders.receiveEnvelope(envelope(id));
    const settled = await chat.request(user.id, `${prefix}:first`);
    assert.equal(settled.creditsCharged, 2); assert.equal(settled.billing.exactCredits, '1.9312'); assert.equal(await balance(user.id), 8);
    assert.equal(consumptionCredits('0.019312', 1.5).creditsCharged, 3, 'historical orders retain 1.5');
    enabled = false;
    const before = posts;
    const repeated = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...auth, ...headers('first') }, payload: body });
    assert.equal(repeated.statusCode, 200); assert.equal(posts, before);
    for (const selected of [model, media, 'missing-kind', 'unpriced-chat']) {
      const denied = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...auth, ...headers(`deny-${selected}`) }, payload: { ...body, model: selected } });
      assert.equal(denied.statusCode, 400, denied.body);
    }
    assert.equal(posts, before); enabled = true;
    const empty = await owner(0);
    const beforeEmpty = posts;
    await assert.rejects(chat.complete(empty.id, body, headers('empty-wallet')));
    assert.equal(posts, beforeEmpty);
    assert.equal(await db.apiUsageRecord.count({ where: { userId: empty.id } }), 0);
    const poor = await owner(1);
    const pending = await chat.complete(poor.id, body, headers('no-funds'));
    const poorId = usageId(poor.id, `${prefix}:no-funds`);
    assert.equal(pending.tanvaReceipt.creditsReserved, 0); assert.equal(await balance(poor.id), 1);
    await orders.receiveEnvelope(envelope(poorId));
    assert.equal((await orders.getState(poorId)).status, 'reconciliation_required');
    assert.equal((await chat.request(poor.id, `${prefix}:no-funds`)).response.choices[0].message.content, 'original result');
    await db.creditLot.create({ data: { accountId: poor.account, sourceType: 'recharge', validityType: 'permanent', totalAmount: 9, remainingAmount: 9 } });
    await db.creditAccount.update({ where: { id: poor.account }, data: { balance: 10, totalEarned: 10 } });
    const restart = new GatewayConsumptionOrdersService(db, config, credits, ledger, { publish: async () => {} } as any);
    (restart as any).fetchImpl = async () => { throw new Error('retained proof must settle without HTTP or resubmission'); };
    const poorBefore = posts; assert.equal((await restart.reconcile(poorId)).status, 'settled'); assert.equal(posts, poorBefore); assert.equal(await balance(poor.id), 8);
    const team = await db.team.create({ data: { ownerId: user.id, name: 'Zero reserve team', memberships: { create: { userId: user.id, role: 'owner', creditQuotaMonthly: 0, creditQuotaTotal: 0 } },
      creditAccount: { create: { balance: 10, totalEarned: 10 } } } });
    const emptyQuotaPosts = posts;
    await assert.rejects(chat.complete(user.id, body, headers('team-empty-quota', team.id)));
    assert.equal(posts, emptyQuotaPosts);
    await db.teamMembership.update({ where: { teamId_userId: { teamId: team.id, userId: user.id } }, data: { creditQuotaMonthly: 1, creditQuotaTotal: 1 } });
    const teamResult = await chat.complete(user.id, body, headers('team', team.id));
    assert.equal(teamResult.tanvaReceipt.creditsReserved, 0);
    const teamId = usageId(user.id, `${prefix}:team`);
    const account = await db.teamCreditAccount.findUniqueOrThrow({ where: { teamId: team.id } });
    assert.equal(account.balance, 10); assert.equal(account.frozenBalance, 0);
    assert.equal((await db.teamCreditLedger.findFirstOrThrow({ where: { taskId: teamId, entryType: 'reserve' } })).amount, 0);
    await orders.receiveEnvelope(envelope(teamId)); assert.equal((await orders.getState(teamId)).status, 'reconciliation_required');
    await db.teamMembership.update({ where: { teamId_userId: { teamId: team.id, userId: user.id } }, data: { creditQuotaMonthly: 100, creditQuotaTotal: 100 } });
    assert.equal((await restart.reconcile(teamId)).status, 'settled');
    const afterTeam = await db.teamCreditAccount.findUniqueOrThrow({ where: { teamId: team.id } });
    assert.equal(afterTeam.balance, 8); assert.equal(afterTeam.frozenBalance, 0);
    assert.equal((await db.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: team.id, userId: user.id } } })).creditUsedTotal, 2);
    assert.equal(await balance(user.id), 8);
    lost = true;
    await assert.rejects(chat.complete(user.id, body, headers('lost')));
    const lostId = usageId(user.id, `${prefix}:lost`); await orders.receiveEnvelope(envelope(lostId));
    const lostBefore = posts; await assert.rejects(chat.complete(user.id, body, headers('lost'))); assert.equal(posts, lostBefore);
    const recovered = await chat.request(user.id, `${prefix}:lost`);
    assert.equal(recovered.status, 'reconciliation_required'); assert.equal(recovered.creditsCharged, 2); assert.equal(recovered.response, undefined);
    console.log('PASS: dynamic Cookie HTTP chat catalog/admission, disabled/media/unpriced exclusion, no reserve or fake snapshot, signed CNY×100, personal/team insufficient recovery and replay, legacy 1.5 unchanged');
  } finally { await app.close(); }
}
run().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
