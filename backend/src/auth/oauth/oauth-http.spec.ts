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
import { AuthService } from '../auth.service';
import { AuthController } from '../auth.controller';
import { OptionalDesktopJwtGuard } from '../desktop-auth.controller';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { RefreshJwtStrategy } from '../strategies/refresh.strategy';
import { SmsService } from '../sms.service';
import { WechatLoginSessionRateLimitService } from '../wechat-login-session-rate-limit.service';
import { UsersService } from '../../users/users.service';
import { OAuthController } from './oauth.controller';
import { OAuthService, redirectUriMatches, validateRedirectUri } from './oauth.service';

async function run() {
  // Isolated fixture: reads only its own config map, never local deployment credentials.
  const fixtureConfig = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;
  const config = fixtureConfig({ NODE_ENV: 'test', REDIS_URL: '', COOKIE_DOMAIN: '', COOKIE_SECURE: 'false', JWT_ACCESS_SECRET: 'isolated-test-access', JWT_REFRESH_SECRET: 'isolated-test-refresh', OAUTH_ISSUER: 'https://tanvas.cn' });
  const user = { id: 'fixture-user', name: 'Fixture', email: 'fixture@example.invalid', phone: 'fixture-phone', role: 'user', status: 'active' };
  type Row = { id: string; tokenHash: string; isRevoked: boolean; userId: string; expiresAt: Date; createdAt: Date; userAgent?: string | null; ip?: string | null; grantId?: string | null };
  const rows: Row[] = [];
  const live = (row: Row) => !row.isRevoked && row.expiresAt.getTime() > Date.now();
  // Mirrors UsersService.hasActiveOAuthGrant: the access-token side of revocation.
  const users = { findById: async () => user, touchLastLoginAt: async () => {}, sanitize: (value: unknown) => value,
    hasActiveOAuthGrant: async (userId: string, grantId: string) => rows.some(row => row.userId === userId && row.grantId === grantId && live(row)) };
  const prisma = {
    user: { findUnique: async () => user, update: async () => user },
    refreshToken: {
      create: async ({ data }: { data: Omit<Row, 'id' | 'isRevoked' | 'createdAt'> }) => { const row: Row = { ...data, id: randomBytes(12).toString('hex'), isRevoked: false, createdAt: new Date() }; rows.unshift(row); return row; },
      // Newest first + `take`, like the real query (so the 32-session window is exercised).
      findMany: async ({ where, take }: { where: { userId: string; grantId?: string }; take?: number }) => rows.filter(row => row.userId === where.userId && (where.grantId === undefined || row.grantId === where.grantId) && live(row)).slice(0, take ?? Infinity),
      updateMany: async ({ where }: { where: { id?: string; grantId?: string; userId?: string } }) => {
        const hit = rows.filter(row => !row.isRevoked && (where.id === undefined || row.id === where.id) && (where.grantId === undefined || row.grantId === where.grantId) && (where.userId === undefined || row.userId === where.userId));
        hit.forEach(row => { row.isRevoked = true; }); return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: { id: string; isRevoked?: boolean } }) => {
        const index = rows.findIndex(row => row.id === where.id && (where.isRevoked === undefined || row.isRevoked === where.isRevoked));
        if (index < 0) return { count: 0 }; rows.splice(index, 1); return { count: 1 };
      },
    },
  };
  const auth = new AuthService(users as never, prisma as never, new JwtService(), config, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

  // Unit-level checks of redirect URI policy.
  assert.equal(validateRedirectUri('workbuddy://workbuddy/mcp/connector%3Atanva/oauth/callback'), 'workbuddy://workbuddy/mcp/connector%3Atanva/oauth/callback');
  assert.equal(validateRedirectUri('http://127.0.0.1:53682/oauth/callback'), 'http://127.0.0.1:53682/oauth/callback');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://evil.example/cb', 'https://ok.example/cb#frag', 'file:///etc/passwd']) assert.throws(() => validateRedirectUri(bad), bad);
  assert(redirectUriMatches('http://127.0.0.1:1111/oauth/callback', 'http://127.0.0.1:2222/oauth/callback'));
  assert(!redirectUriMatches('http://127.0.0.1:1111/oauth/callback', 'http://127.0.0.1:2222/other'));
  assert(!redirectUriMatches('https://a.example/cb', 'https://a.example/cb2'));

  @Module({ imports: [PassportModule.register({ session: false })], controllers: [AuthController, OAuthController], providers: [
    { provide: ConfigService, useValue: config }, { provide: UsersService, useValue: users }, { provide: AuthService, useValue: auth },
    { provide: SmsService, useValue: {} }, { provide: WechatLoginSessionRateLimitService, useValue: {} }, { provide: JwtService, useValue: new JwtService() },
    OAuthService, OptionalDesktopJwtGuard, JwtStrategy, RefreshJwtStrategy,
  ] }) class FixtureModule {}
  const app = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never); app.setGlobalPrefix('api');
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  const request = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
  const form = (values: Record<string, string>) => ({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(values).toString() });

  try {
    const browserTokens = await auth.login(user);
    const browserCookies = `access_token=${browserTokens.accessToken}; refresh_token=${browserTokens.refreshToken}`;
    const redirectUri = 'workbuddy://workbuddy/mcp/connector%3Atanva/oauth/callback';

    const metadata = (await request({ method: 'GET', url: '/api/oauth/metadata' })).json();
    assert.equal(metadata.issuer, 'https://tanvas.cn'); assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);

    // RFC 7591 registration must echo redirect_uris.
    assert.equal((await request({ method: 'POST', url: '/api/oauth/register', payload: { redirect_uris: ['javascript:alert(1)'] } })).statusCode, 400);
    assert.equal((await request({ method: 'POST', url: '/api/oauth/register', payload: { redirect_uris: [redirectUri], token_endpoint_auth_method: 'client_secret_basic' } })).statusCode, 400);
    const registered = await request({ method: 'POST', url: '/api/oauth/register', payload: { client_name: 'WorkBuddy', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' } });
    assert.equal(registered.statusCode, 201);
    const client = registered.json();
    assert.deepEqual(client.redirect_uris, [redirectUri]); assert(client.client_id.startsWith('tmc_'));

    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('hex');
    const authorizeUrl = (overrides: Record<string, string> = {}) => `/api/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'tanva', resource: 'https://tanvas.cn/mcp', ...overrides })}`;

    // Untrusted client / redirect → error page, never a redirect.
    const tampered = await request({ method: 'GET', url: authorizeUrl({ client_id: client.client_id.slice(0, -2) + 'xx' }) });
    assert.equal(tampered.statusCode, 400); assert.equal(tampered.headers.location, undefined);
    const foreign = await request({ method: 'GET', url: authorizeUrl({ redirect_uri: 'https://evil.example/cb' }) });
    assert.equal(foreign.statusCode, 400); assert.equal(foreign.headers.location, undefined);
    // Trusted redirect but bad params → OAuth error back to the client.
    const noPkce = await request({ method: 'GET', url: authorizeUrl({ code_challenge_method: 'plain' }) });
    assert.equal(noPkce.statusCode, 302); assert(noPkce.headers.location!.startsWith('workbuddy://')); assert.equal(new URL(noPkce.headers.location!).searchParams.get('error'), 'invalid_request');
    const badResource = await request({ method: 'GET', url: authorizeUrl({ resource: 'https://evil.example/mcp' }) });
    assert.equal(new URL(badResource.headers.location!).searchParams.get('error'), 'invalid_target');

    const begin = await request({ method: 'GET', url: authorizeUrl() });
    assert.equal(begin.statusCode, 302); assert(begin.headers.location!.startsWith('/api/oauth/consent?requestId='));
    const consentUrl = begin.headers.location!;
    const noLogin = await request({ method: 'GET', url: consentUrl });
    assert.equal(noLogin.statusCode, 302); assert.equal(noLogin.headers.location, `/auth/login?returnTo=${encodeURIComponent(consentUrl)}`);
    const page = await request({ method: 'GET', url: consentUrl, headers: { cookie: browserCookies } });
    assert.equal(page.statusCode, 200); assert(page.body.includes('WorkBuddy')); assert(page.body.includes('全部权限'));
    const decisionInput = JSON.parse(page.body.match(/const input=([^;]+);/)![1]);
    const crossOrigin = await request({ method: 'POST', url: '/api/oauth/decision', headers: { cookie: browserCookies, origin: 'https://evil.example' }, payload: { ...decisionInput, decision: 'approve' } });
    assert.equal(crossOrigin.statusCode, 401);
    const forged = await request({ method: 'POST', url: '/api/oauth/decision', headers: { cookie: browserCookies, origin: 'https://tanvas.cn' }, payload: { ...decisionInput, csrf: 'x'.repeat(43), decision: 'approve' } });
    assert.equal(forged.statusCode, 401);
    const approved = await request({ method: 'POST', url: '/api/oauth/decision', headers: { cookie: browserCookies, origin: 'https://tanvas.cn' }, payload: { ...decisionInput, decision: 'approve' } });
    assert.equal(approved.statusCode, 200);
    const callback = new URL(approved.json().redirectUrl);
    assert.equal(`${callback.protocol}//${callback.host}${callback.pathname}`, 'workbuddy://workbuddy/mcp/connector%3Atanva/oauth/callback');
    assert.equal(callback.searchParams.get('state'), state); assert.equal(callback.searchParams.get('iss'), 'https://tanvas.cn');
    const code = callback.searchParams.get('code')!;
    assert.equal((await request({ method: 'POST', url: '/api/oauth/decision', headers: { cookie: browserCookies, origin: 'https://tanvas.cn' }, payload: { ...decisionInput, decision: 'approve' } })).statusCode, 410);

    // Token exchange (form-encoded, as MCP clients send it).
    const wrongVerifier = await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: randomBytes(48).toString('base64url') }) });
    assert.equal(wrongVerifier.statusCode, 400); assert.equal(wrongVerifier.json().error, 'invalid_grant');
    // The failed attempt consumed the code (single use) — run a fresh authorization.
    const begin2 = await request({ method: 'GET', url: authorizeUrl() });
    const page2 = await request({ method: 'GET', url: begin2.headers.location!, headers: { cookie: browserCookies } });
    const approved2 = await request({ method: 'POST', url: '/api/oauth/decision', headers: { cookie: browserCookies, origin: 'https://tanvas.cn' }, payload: { ...JSON.parse(page2.body.match(/const input=([^;]+);/)![1]), decision: 'approve' } });
    const code2 = new URL(approved2.json().redirectUrl).searchParams.get('code')!;
    const exchanged = await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'authorization_code', code: code2, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource: 'https://tanvas.cn/mcp' }) });
    assert.equal(exchanged.statusCode, 200, exchanged.body); assert.equal(exchanged.headers['cache-control'], 'no-store');
    const tokens = exchanged.json();
    assert.equal(tokens.token_type, 'Bearer'); assert(tokens.expires_in > 0); assert(tokens.refresh_token); assert.equal(tokens.scope, 'tanva');
    assert(rows[0].userAgent?.startsWith('oauth:WorkBuddy')); assert(rows[0].grantId?.startsWith('g_'));
    // Permanent-by-default grant: short access (1h), long sliding refresh (3650d).
    assert(tokens.expires_in > 3500 && tokens.expires_in <= 3600, String(tokens.expires_in));
    const jwtExp = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000;
    assert(jwtExp(tokens.refresh_token) - Date.now() > 3640 * 86_400_000);
    assert(rows[0].expiresAt.getTime() - Date.now() > 3640 * 86_400_000);
    const reused = await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'authorization_code', code: code2, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier }) });
    assert.equal(reused.json().error, 'invalid_grant');

    const me = await request({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(me.statusCode, 200); assert.equal(me.json().user.id, user.id);

    // Refresh (JSON body this time) rotates; the old refresh token is dead.
    const refreshed = await request({ method: 'POST', url: '/api/oauth/token', payload: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id } });
    assert.equal(refreshed.statusCode, 200, refreshed.body); const rotated = refreshed.json();
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    assert.equal((await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }) })).json().error, 'invalid_grant');
    assert.equal((await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: 'garbage' }) })).json().error, 'invalid_grant');
    assert.equal((await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'password' }) })).json().error, 'unsupported_grant_type');

    // Rotation keeps the grant: the previous access token keeps working, and only one grant row exists.
    assert.equal((await request({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${tokens.access_token}` } })).statusCode, 200);
    const grantId = rows.find(row => row.grantId && live(row))!.grantId!;
    assert.equal(rows.filter(row => row.grantId === grantId).length, 1, 'superseded grant sessions are deleted, not accumulated');
    // Web/desktop refresh tokens cannot be traded for agent tokens.
    assert.equal((await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: browserTokens.refreshToken }) })).json().error, 'invalid_grant');

    // Heavy web usage must not push the agent grant out of the 32-session lookup window.
    const crowdStart = Date.now();
    for (let i = 0; i < 40; i += 1) await auth.login(user);
    const afterCrowd = await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: rotated.refresh_token }) });
    assert.equal(afterCrowd.statusCode, 200, afterCrowd.body); const crowded = afterCrowd.json();
    // Drop the throwaway web sessions (they would also crowd out this fixture's own browser session).
    rows.filter(row => !row.grantId && row.createdAt.getTime() >= crowdStart && row.tokenHash !== undefined).slice(0, 40).forEach(row => { row.isRevoked = true; });
    // The cookie/Bearer /api/auth/refresh path keeps the token inside its OAuth grant (no escape to 24h web tokens).
    const viaAuthRefresh = await request({ method: 'POST', url: '/api/auth/refresh', headers: { authorization: `Bearer ${crowded.refresh_token}` } });
    assert.equal(viaAuthRefresh.statusCode, 201); const stillGrant = viaAuthRefresh.json().tokens;
    assert.equal(JSON.parse(Buffer.from(stillGrant.accessToken.split('.')[1], 'base64url').toString()).gid, grantId);
    assert(jwtExp(stillGrant.accessToken) - Date.now() <= 3_600_000);
    // Concurrent refresh with the same token: exactly one wins, the grant survives.
    const race = await Promise.all([0, 1].map(() => request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: stillGrant.refreshToken }) })));
    assert.deepEqual(race.map(r => r.statusCode).sort(), [200, 400]);
    const winner = race.find(r => r.statusCode === 200)!.json();
    assert.equal(rows.filter(row => row.grantId === grantId && live(row)).length, 1);

    // Revocation (by refresh token) ends refresh AND already-issued access tokens immediately.
    assert.equal((await request({ method: 'POST', url: '/api/oauth/revoke', ...form({ token: winner.refresh_token }) })).statusCode, 200);
    assert.equal((await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: winner.refresh_token }) })).json().error, 'invalid_grant');
    for (const access of [winner.access_token, tokens.access_token]) {
      assert.equal((await request({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${access}` } })).statusCode, 401);
    }
    assert.equal((await request({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: browserCookies } })).statusCode, 201);

    // A full grant end-to-end, for the remaining revocation paths.
    const authorize = async () => {
      const started = await request({ method: 'GET', url: authorizeUrl() });
      const consent = await request({ method: 'GET', url: started.headers.location!, headers: { cookie: browserCookies } });
      const decided = await request({ method: 'POST', url: '/api/oauth/decision', headers: { cookie: browserCookies, origin: 'https://tanvas.cn' }, payload: { ...JSON.parse(consent.body.match(/const input=([^;]+);/)![1]), decision: 'approve' } });
      const issued = await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'authorization_code', code: new URL(decided.json().redirectUrl).searchParams.get('code')!, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier }) });
      assert.equal(issued.statusCode, 200, issued.body); return issued.json();
    };
    const meStatus = (access: string) => request({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${access}` } }).then(r => r.statusCode);
    // Two grants are independent; revoking one by its ACCESS token leaves the other alive.
    const grantA = await authorize(); const grantB = await authorize();
    assert.equal((await request({ method: 'POST', url: '/api/oauth/revoke', ...form({ token: grantA.access_token }) })).statusCode, 200);
    assert.equal(await meStatus(grantA.access_token), 401); assert.equal(await meStatus(grantB.access_token), 200);
    assert.equal((await request({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: grantA.refresh_token }) })).json().error, 'invalid_grant');
    // /api/auth/logout with an agent refresh token revokes that whole grant.
    assert.equal((await request({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${grantB.refresh_token}` } })).statusCode, 201);
    assert.equal(await meStatus(grantB.access_token), 401);
    assert.equal(await meStatus(browserTokens.accessToken), 200, 'web session untouched');

    // Deny path returns access_denied to the client.
    const begin3 = await request({ method: 'GET', url: authorizeUrl() });
    const page3 = await request({ method: 'GET', url: begin3.headers.location!, headers: { cookie: browserCookies } });
    const denied = await request({ method: 'POST', url: '/api/oauth/decision', headers: { cookie: browserCookies, origin: 'https://tanvas.cn' }, payload: { ...JSON.parse(page3.body.match(/const input=([^;]+);/)![1]), decision: 'deny' } });
    assert.equal(new URL(denied.json().redirectUrl).searchParams.get('error'), 'access_denied');

    // Loopback fallback: registered once, any port accepted.
    const loopbackClient = (await request({ method: 'POST', url: '/api/oauth/register', payload: { redirect_uris: ['http://127.0.0.1:1/oauth/callback'] } })).json();
    const loop = await request({ method: 'GET', url: authorizeUrl({ client_id: loopbackClient.client_id, redirect_uri: 'http://127.0.0.1:53682/oauth/callback' }) });
    assert.equal(loop.statusCode, 302); assert(loop.headers.location!.startsWith('/api/oauth/consent'));

    const production = new OAuthService(fixtureConfig({ NODE_ENV: 'production', REDIS_URL: '' }));
    const productionClient = production.register({ redirect_uris: [redirectUri] });
    await assert.rejects(production.beginAuthorization({ client_id: productionClient.client_id, redirect_uri: redirectUri, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' }), /REDIS_URL/);
    assert.throws(() => production.resolveClient(client.client_id), 'client_id signed by another deployment must be rejected');
    console.log('MCP OAuth 2.1: DCR, PKCE S256, consent CSRF/origin, single-use code, form/JSON token, 1h access + 3650d sliding refresh, grant survives web-login crowding and rotation races, immediate access revocation (refresh/access/logout), deny, loopback, production store checks passed.');
  } finally { await app.close(); }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
