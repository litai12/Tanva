import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import cookie from '@fastify/cookie';
import type Redis from 'ioredis';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { DesktopAuthController, OptionalDesktopJwtGuard } from './desktop-auth.controller';
import { DesktopGrantService } from './desktop-grant.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshJwtStrategy } from './strategies/refresh.strategy';
import { SmsService } from './sms.service';
import { WechatLoginSessionRateLimitService } from './wechat-login-session-rate-limit.service';
import { UsersService } from '../users/users.service';

async function run() {
  // ConfigService 3 checks process.env before constructor values. This fixture
  // deliberately reads only its own map, never local deployment credentials.
  const fixtureConfig = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;
  const config = fixtureConfig({ NODE_ENV: 'test', REDIS_URL: '', COOKIE_DOMAIN: '', COOKIE_SECURE: 'false', JWT_ACCESS_SECRET: 'isolated-test-access', JWT_REFRESH_SECRET: 'isolated-test-refresh' });
  const user = { id: 'fixture-user', name: 'Fixture', email: 'fixture@example.invalid', phone: 'fixture-phone', role: 'user', status: 'active' };
  const users = { findById: async () => user, touchLastLoginAt: async () => {}, sanitize: (value: unknown) => value };
  const rows: Array<{ id: string; tokenHash: string; isRevoked: boolean; userId: string; expiresAt: Date; createdAt: Date }> = [];
  const prisma = {
    user: { findUnique: async () => user, update: async () => user },
    refreshToken: {
      create: async ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => { const row = { ...data, id: randomBytes(12).toString('hex'), isRevoked: false, createdAt: new Date() }; rows.unshift(row); return row; },
      findMany: async () => rows.filter(row => !row.isRevoked && row.expiresAt.getTime() > Date.now()),
      updateMany: async ({ where }: { where: { id: string } }) => { const row = rows.find(item => item.id === where.id && !item.isRevoked); if (!row) return { count: 0 }; row.isRevoked = true; return { count: 1 }; },
    },
  };
  const auth = new AuthService(users as never, prisma as never, new JwtService(), config, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  @Module({ imports: [PassportModule.register({ session: false })], controllers: [AuthController, DesktopAuthController], providers: [
    { provide: ConfigService, useValue: config }, { provide: UsersService, useValue: users }, { provide: AuthService, useValue: auth },
    { provide: SmsService, useValue: {} }, { provide: WechatLoginSessionRateLimitService, useValue: {} },
    DesktopGrantService, OptionalDesktopJwtGuard, JwtStrategy, RefreshJwtStrategy,
  ] }) class FixtureModule {}
  const app = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never); app.setGlobalPrefix('api'); await app.init(); await app.getHttpAdapter().getInstance().ready();
  const cookiesOf = (headers: Record<string, unknown>) => {
    const values = headers['set-cookie']; return (Array.isArray(values) ? values : [values]).filter(value => typeof value === 'string').map(value => String(value).split(';')[0]).join('; ');
  };
  try {
    const browserTokens = await auth.login(user);
    const browserCookies = `access_token=${browserTokens.accessToken}; refresh_token=${browserTokens.refreshToken}`;
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url');
    await app.get(DesktopGrantService).create({ state, challenge: createHash('sha256').update(verifier).digest('base64url'), challengeMethod: 'S256', callbackUrl: 'tanva://auth/callback' });
    const request = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
    const begin = await request({ method: 'POST', url: '/api/auth/desktop/session', payload: { state, challenge: createHash('sha256').update(verifier).digest('base64url'), challengeMethod: 'S256', callbackUrl: 'tanva://auth/callback' } });
    assert.equal(begin.statusCode, 200); const grant = begin.json();
    const noLogin = await request({ method: 'GET', url: `/api/auth/desktop/authorize?sessionId=${grant.sessionId}` });
    assert.equal(noLogin.statusCode, 302); assert(noLogin.headers.location.includes('returnTo='));
    const page = await request({ method: 'GET', url: `/api/auth/desktop/authorize?sessionId=${grant.sessionId}`, headers: { cookie: browserCookies } });
    assert.equal(page.statusCode, 200); assert.equal(page.headers['cache-control'], 'no-store');
    const approvalInput = JSON.parse(page.body.match(/const input=([^;]+);/)![1]);
    const crossOrigin = await request({ method: 'POST', url: '/api/auth/desktop/approve', headers: { cookie: browserCookies, origin: 'https://lluban.com' }, payload: { ...approvalInput, decision: 'approve' } });
    assert.equal(crossOrigin.statusCode, 401);
    const approved = await request({ method: 'POST', url: '/api/auth/desktop/approve', headers: { cookie: browserCookies, origin: 'https://tanvas.cn' }, payload: { ...approvalInput, decision: 'approve' } });
    assert.equal(approved.statusCode, 200); assert.equal(approved.json().callbackUrl, `tanva://auth/callback?state=${state}`);
    const exchanged = await request({ method: 'POST', url: '/api/auth/desktop/exchange', payload: { sessionId: grant.sessionId, state, verifier } });
    assert.equal(exchanged.statusCode, 200); assert.deepEqual(exchanged.json(), { status: 'authorized' });
    let nativeCookies = cookiesOf(exchanged.headers); assert(nativeCookies.includes('refresh_token='));
    assert(!nativeCookies.includes(browserTokens.refreshToken));
    const nativeRefresh = nativeCookies.split('refresh_token=')[1];
    assert.notEqual(nativeRefresh.slice(0, 72), browserTokens.refreshToken.slice(0, 72), 'bcrypt session hash prefixes must differ');
    const repeated = await request({ method: 'POST', url: '/api/auth/desktop/exchange', payload: { sessionId: grant.sessionId, state, verifier } }); assert.equal(repeated.statusCode, 409);
    const me = await request({ method: 'GET', url: '/api/auth/me', headers: { cookie: nativeCookies } }); assert.equal(me.json().user.id, user.id);
    const refresh = await request({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: nativeCookies } }); assert.equal(refresh.statusCode, 201); nativeCookies = cookiesOf(refresh.headers);
    const logout = await request({ method: 'POST', url: '/api/auth/logout', headers: { cookie: nativeCookies } }); assert.equal(logout.statusCode, 201);
    const revoked = await request({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: nativeCookies } }); assert.equal(revoked.statusCode, 401);
    const browserRefresh = await request({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: browserCookies } }); assert.equal(browserRefresh.statusCode, 201);
    console.log('real Nest/Fastify HTTP desktop grant + JWT cookies + native refresh/logout + independent browser session passed (isolated persistence fixture, no production requests).');
  } finally { await app.close(); }
  if (process.env.TANVA_AUTH_TEST_REDIS_URL) {
    const redisUrl = new URL(process.env.TANVA_AUTH_TEST_REDIS_URL);
    assert.equal(redisUrl.protocol, 'redis:'); assert.equal(redisUrl.hostname, '127.0.0.1');
    assert.equal(redisUrl.username, ''); assert.equal(redisUrl.password, '');
    const redisConfig = fixtureConfig({ NODE_ENV: 'production', REDIS_URL: process.env.TANVA_AUTH_TEST_REDIS_URL });
    const a = new DesktopGrantService(redisConfig), b = new DesktopGrantService(redisConfig);
    try {
      await Promise.all([a, b].map(service => new Promise<void>((resolve, reject) => {
        const client = (service as unknown as { redis: Redis }).redis;
        if (client.status === 'ready') { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('isolated Redis fixture not ready')), 10_000);
        client.once('ready', () => { clearTimeout(timer); resolve(); });
      })));
      const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url');
      const grant = await a.create({ state, challenge: createHash('sha256').update(verifier).digest('base64url'), challengeMethod: 'S256', callbackUrl: 'tanva://auth/callback' });
      await b.approve(grant.id, grant.csrf, user.id, 'approve');
      const results = await Promise.allSettled([a.exchange(grant.id, state, verifier), b.exchange(grant.id, state, verifier)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter(result => result.status === 'rejected').length, 1);
      console.log('real Redis cross-instance atomic desktop grant single-consumption passed.');
    } finally { await a.onModuleDestroy(); await b.onModuleDestroy(); }
  }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
