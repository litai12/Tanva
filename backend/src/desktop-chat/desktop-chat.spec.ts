import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { DESKTOP_CHAT_MODEL, MAX_REQUEST_BYTES, usageId, validateCompletion } from './desktop-chat.protocol';
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
const completion = { id: 'fixture', model: DESKTOP_CHAT_MODEL, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '检查文件', reasoning_content: '保留字段', tool_calls: [{ id: 'next', type: 'function', function: { name: 'inspect', arguments: '{}' } }] } }], usage: { prompt_tokens: 123, completion_tokens: 0, total_tokens: 123, prompt_tokens_details: { cached_tokens: 8 } } };
const fetchFixture: typeof fetch = async (input: any, init: any) => {
  if (String(input).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: DESKTOP_CHAT_MODEL }] }));
  calls++; sent = JSON.parse(init.body); await new Promise(resolve => setTimeout(resolve, 30)); if (inspect) await inspect();
  if (mode === 'disconnect') throw new Error('fixture disconnect');
  if (mode === 'empty') return new Response(JSON.stringify({ choices: [{ message: {} }] }));
  if (/^\d+$/.test(mode)) return new Response('{}', { status: Number(mode) });
  return new Response(JSON.stringify(completion), { headers: { 'content-type': 'application/json' } });
};
function service() { const s = new DesktopChatService(config, db, credits, ledger); (s as any).fetchImpl = fetchFixture; return s; }
const chat = service();
const body = { model: DESKTOP_CHAT_MODEL, stream: false, tools: [{ type: 'function', function: { name: 'inspect', parameters: { type: 'object', properties: {} } } }], tool_choice: 'auto', parallel_tool_calls: true, messages: [
  { role: 'user', content: [{ type: 'text', text: '检查截图' }, { type: 'image_url', image_url: { url: 'https://fixture.invalid/shot.png' } }] },
  { role: 'assistant', content: null, tool_calls: [{ id: 'previous', type: 'function', function: { name: 'inspect', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'previous', content: '{"ok":true}' },
] };
function headers(key: string, teamId?: string) { return { 'idempotency-key': `${prefix}:${key}`, 'x-tanva-task-id': `${prefix}:task`, 'x-tanva-conversation-id': `${prefix}:conversation`, ...(teamId ? { 'x-tanva-team-id': teamId } : {}) }; }
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
  await db.$connect(); const owner = await user();
  await db.creditLot.create({ data: { accountId: owner.account, sourceType: 'gift', validityType: 'permanent', totalAmount: 50, remainingAmount: 50, metadata: { reason: 'daily_reward' } } });
  await db.creditAccount.update({ where: { id: owner.account }, data: { balance: 1050, totalEarned: 1050 } });
  const model = (await chat.models(owner.id)).models[0]; assert.equal(model.pricing.creditsPerCall, 30); assert.equal(model.supportsVision, true);
  const concurrent = await Promise.allSettled(Array.from({ length: 8 }, () => chat.complete(owner.id, body, headers('first'))));
  assert(concurrent.some(r => r.status === 'fulfilled'), JSON.stringify(concurrent.map((r: any) => r.reason?.message)));  assert.equal(calls, 1); assert.equal(await balance(owner.id), 1020);
  assert.equal(await db.creditTransaction.count({ where: { apiUsageId: uid(owner.id, 'first'), type: 'spend' } }), 1);
  assert.equal((await db.creditLot.findFirstOrThrow({ where: { accountId: owner.account, sourceType: 'gift' } })).remainingAmount, 20);
  assert.deepEqual(sent, body); assert.deepEqual((await request(owner.id, 'first')).response, completion);
  assert.deepEqual((await service().complete(owner.id, body, headers('first'))).usage, completion.usage); assert.equal(calls, 1);
  await code(chat.complete(owner.id, { ...body, temperature: 0.1 }, headers('first')), 'TANVA_IDEMPOTENCY_CONFLICT');
  await code(chat.complete(owner.id, body, headers('first', 'other-team')), 'TANVA_IDEMPOTENCY_CONFLICT');
  await chat.complete(owner.id, body, headers('second'));
  const lots = await db.creditLot.findMany({ where: { accountId: owner.account } });
  assert.equal(lots.find(l => l.sourceType === 'gift')!.remainingAmount, 0); assert.equal(lots.find(l => l.sourceType === 'recharge')!.remainingAmount, 990);
  const another = await user(); await assert.rejects(chat.request(another.id, `${prefix}:first`), (e: any) => e.getStatus?.() === 404);
  mode = '400'; await code(chat.complete(owner.id, body, headers('rejected')), 'TANVA_REQUEST_FAILED'); assert.equal(await balance(owner.id), 990);
  assert.equal((await request(owner.id, 'rejected')).creditsCharged, 0); const rejectedCalls = calls;
  await code(service().complete(owner.id, body, headers('rejected')), 'TANVA_REQUEST_FAILED'); assert.equal(calls, rejectedCalls);
  for (const outcome of ['503', '409', '425', 'disconnect', 'empty']) {
    mode = outcome; const before = await balance(owner.id); const key = `unknown-${outcome}`;
    await code(chat.complete(owner.id, body, headers(key)), 'TANVA_REQUEST_PENDING'); assert.equal(await balance(owner.id), before - 30);
    assert.equal((await request(owner.id, key)).status, 'reconciliation_required'); const count = calls;
    await code(service().complete(owner.id, body, headers(key)), 'TANVA_REQUEST_PENDING'); assert.equal(calls, count);
  }
  mode = 'success';
  const team = await db.team.create({ data: { ownerId: owner.id, name: `${prefix}:team`, memberships: { create: { userId: owner.id, role: 'owner', creditQuotaTotal: 1000 } }, creditAccount: { create: { balance: 1000, totalEarned: 1000 } } } });
  const personal = await balance(owner.id);
  inspect = async () => { const acc = await teamBalance(team.id); assert.equal(acc.frozenBalance, 30); assert.equal(acc.balance, 1000); assert.equal(await balance(owner.id), personal); };
  const beforeTeam = calls; await Promise.allSettled(Array.from({ length: 8 }, () => chat.complete(owner.id, body, headers('team-first', team.id))));
  assert.equal(calls, beforeTeam + 1); assert.equal((await teamBalance(team.id)).balance, 970); assert.equal((await teamBalance(team.id)).frozenBalance, 0);
  assert.equal(await balance(owner.id), personal); assert.equal((await request(owner.id, 'team-first')).creditsCharged, 30);
  assert.equal(await db.teamCreditLedger.count({ where: { taskId: uid(owner.id, 'team-first'), entryType: 'deduct' } }), 1);
  inspect = undefined; mode = '400'; await code(chat.complete(owner.id, body, headers('team-reject', team.id)), 'TANVA_REQUEST_FAILED');
  assert.equal((await teamBalance(team.id)).balance, 970); assert.equal((await teamBalance(team.id)).frozenBalance, 0);
  assert.equal((await db.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: team.id, userId: owner.id } } })).creditUsedTotal, 30);
  mode = '503'; await code(chat.complete(owner.id, body, headers('team-unknown', team.id)), 'TANVA_REQUEST_PENDING');
  assert.equal((await request(owner.id, 'team-unknown')).creditsReserved, 30);
  await db.teamCreditLedger.updateMany({ where: { taskId: uid(owner.id, 'team-unknown'), entryType: 'reserve' }, data: { reserveExpiresAt: new Date(0) } });
  await ledger.releaseExpiredReserves(); assert.equal((await teamBalance(team.id)).frozenBalance, 30);
  mode = 'success'; await db.teamMembership.update({ where: { teamId_userId: { teamId: team.id, userId: owner.id } }, data: { creditQuotaTotal: 60 } });
  const beforeQuota = calls; await assert.rejects(chat.complete(owner.id, body, headers('team-quota', team.id)), (e: any) => e.getStatus?.() === 403);
  assert.equal(calls, beforeQuota); assert.equal(await db.apiUsageRecord.count({ where: { id: uid(owner.id, 'team-quota') } }), 0);
  assert.equal(await db.teamCreditLedger.count({ where: { taskId: uid(owner.id, 'team-quota') } }), 0); assert.equal((await teamBalance(team.id)).frozenBalance, 30);
  await assert.rejects(chat.complete(another.id, body, headers('unauthorized', team.id)), (e: any) => e.getStatus?.() === 403); assert.equal(calls, beforeQuota);
  const limited = await user(40); const beforeLimited = calls;
  const competition = await Promise.allSettled([chat.complete(limited.id, body, headers('limited-one')), chat.complete(limited.id, body, headers('limited-two'))]);
  assert.equal(competition.filter(r => r.status === 'fulfilled').length, 1); assert.equal(calls, beforeLimited + 1); assert.equal(await balance(limited.id), 10);
  // PostgreSQL trigger forces completion persistence to fail after ledger writes:
  // rollback must retain reservation and known response, then GET settles only
  // the original wallet with no second provider call after the trigger is removed.
  await db.teamMembership.update({ where: { teamId_userId: { teamId: team.id, userId: owner.id } }, data: { creditQuotaTotal: 1000 } });
  await db.$executeRawUnsafe(`CREATE FUNCTION fixture_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."responseStatus"='success' AND NEW.id='${uid(owner.id, 'recover')}' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fixture_completion_failure BEFORE UPDATE ON "ApiUsageRecord" FOR EACH ROW EXECUTE FUNCTION fixture_fail_completion()');
  try {
    await code(chat.complete(owner.id, body, headers('recover', team.id)), 'TANVA_REQUEST_PENDING');
    assert.equal((await teamBalance(team.id)).balance, 970); assert.equal((await teamBalance(team.id)).frozenBalance, 60);
    const row = await db.apiUsageRecord.findUniqueOrThrow({ where: { id: uid(owner.id, 'recover') } });
    assert.deepEqual((row.requestParams as any).desktopChat.response, completion);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER fixture_completion_failure ON "ApiUsageRecord"'); await db.$executeRawUnsafe('DROP FUNCTION fixture_fail_completion()'); }
  const beforeRecovery = calls; assert.equal((await service().request(owner.id, `${prefix}:recover`)).status, 'completed');
  assert.equal(calls, beforeRecovery); assert.equal((await teamBalance(team.id)).balance, 940); assert.equal((await teamBalance(team.id)).frozenBalance, 30);
  await service().complete(owner.id, body, headers('recover', team.id)); assert.equal(calls, beforeRecovery); assert.equal((await teamBalance(team.id)).balance, 940);
  // A confirmed provider rejection whose refund transaction fails must retain
  // the rejection evidence and retry only that original refund on later GET.
  await db.$executeRawUnsafe(`CREATE FUNCTION fixture_fail_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='refund' AND NEW."apiUsageId"='${uid(owner.id, 'refund-recover')}' THEN RAISE EXCEPTION 'fixture refund failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fixture_refund_failure BEFORE INSERT ON "CreditTransaction" FOR EACH ROW EXECUTE FUNCTION fixture_fail_refund()');
  mode = '400'; const beforeRefund = await balance(owner.id);
  try {
    await code(chat.complete(owner.id, body, headers('refund-recover')), 'TANVA_REQUEST_PENDING');
    assert.equal(await balance(owner.id), beforeRefund - 30);
    const row = await db.apiUsageRecord.findUniqueOrThrow({ where: { id: uid(owner.id, 'refund-recover') } });
    assert.equal((row.requestParams as any).desktopChat.rejectionConfirmed, true);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER fixture_refund_failure ON "CreditTransaction"'); await db.$executeRawUnsafe('DROP FUNCTION fixture_fail_refund()'); }
  const beforeRefundRecovery = calls;
  assert.equal((await service().request(owner.id, `${prefix}:refund-recover`)).status, 'failed');
  assert.equal(await balance(owner.id), beforeRefund); assert.equal(calls, beforeRefundRecovery); mode = 'success';
  assert.throws(() => validateCompletion({ ...body, model: 'unpriced-model' }));
  assert.throws(() => validateCompletion({ ...body, messages: [{ role: 'user', content: 'x'.repeat(MAX_REQUEST_BYTES) }] }));
  await assert.rejects(readBoundedJson(new Response('x'.repeat(300)), 100));
  const stalledCancel = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(101)); }, cancel() { return new Promise(() => {}); } }));
  await assert.rejects(readBoundedJson(stalledCancel, 100), /UPSTREAM_RESULT_TOO_LARGE/);
  const abort = new AbortController(); const hanging = new Response(new ReadableStream({ start() {} }));
  const aborted = readBoundedJson(hanging, 100, abort.signal); abort.abort(); await assert.rejects(aborted);
  assert.equal((await chat.listReceipts(owner.id, `${prefix}:task`, `${prefix}:conversation`)).receipts.length, 13);
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
    assert.equal(httpComplete.statusCode, 200); assert.deepEqual(httpComplete.json().choices, completion.choices); assert.equal(httpComplete.json().tanvaReceipt.creditsCharged, 30); assert.deepEqual(sent, body);
    const httpReceipt = await inject({ method: 'GET', url: `/api/desktop/v1/chat/requests/${prefix}:http`, headers: nativeCookie });
    assert.equal(httpReceipt.statusCode, 200); assert.deepEqual(httpReceipt.json().response.usage, completion.usage);
    const httpConflict = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...nativeCookie, ...headers('http') }, payload: { ...body, temperature: 0.3 } });
    assert.equal(httpConflict.statusCode, 409); assert.equal(httpConflict.json().code, 'TANVA_IDEMPOTENCY_CONFLICT');
    mode = '409';
    const httpPending = await inject({ method: 'POST', url: '/api/desktop/v1/chat/completions', headers: { ...nativeCookie, ...headers('http-pending') }, payload: body });
    assert.equal(httpPending.statusCode, 409); assert.equal(httpPending.json().receipt.status, 'reconciliation_required');
    const list = await inject({ method: 'GET', url: `/api/desktop/v1/billing/receipts?taskId=${prefix}:task&conversationId=${prefix}:conversation`, headers: nativeCookie });
    assert.equal(list.statusCode, 200); assert.equal(list.json().receipts.length, 15);
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
      let nativePosts = 0;
      const session = { identity: 'fixture-native-cookie', assertCurrent() {}, async fetch(input: string | URL, init: RequestInit = {}) {
        const url = new URL(String(input));
        const h = Object.fromEntries(new Headers(init.headers));
        if (init.method === 'POST') nativePosts++;
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
        assert.equal(result.tanvaReceipt.creditsCharged, 30); assert.equal(result.tanvaReceipt.taskId, `${prefix}:native-task`);
        const repeated = await transport.fetchImpl('https://fixture.invalid/api/desktop/v1/chat/completions', input);
        assert.equal(repeated.status, 200); assert.equal(calls, before + 1); assert.equal(nativePosts, 1);
        console.log('PASS: actual sibling tanvas-desk createTanvasModelTransport -> Cookie Nest/Fastify HTTP -> PostgreSQL accounting + exact receipt/choice/usage validation + same-body one provider call');
      } finally { transport.dispose(); fs.rmSync(temp, { recursive: true, force: true }); }
    }
    console.log('PASS: real Nest/Fastify controller + production JwtAuthGuard/JwtStrategy Cookie (no Bearer), PostgreSQL wallet/receipts, full tool history, 401/200/409 JSON contracts');
  } finally { await app.close(); }
  console.log('PASS: actual PG admission concurrency, personal source/refund, team reserve/commit/release/quota rollback, known-result settlement and confirmed-rejection refund recovery, persisted tools/vision/usage, restart/hash conflict, unknown409/425/empty/disconnect, authorization, insufficient balance, payload/response bounds and read abort');
}
run().finally(() => db.$disconnect()).catch(e => { console.error(e); process.exitCode = 1; });
