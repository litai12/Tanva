import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';

/**
 * MCP OAuth 2.1 authorization server (public clients + PKCE S256 + RFC 7591
 * dynamic registration) for external agents such as WorkBuddy / Claude / Cursor.
 *
 * - client_id is stateless: an HMAC-signed blob of the registered metadata, so
 *   dynamic registration needs no table and cannot be used to fill storage.
 * - Pending consent requests and authorization codes are short-lived, single
 *   use, and kept in Redis (memory only in test/development).
 * - Issued tokens are ordinary Tanva session tokens (AuthService.login), i.e.
 *   the agent acts with the user's full account permissions and each grant is
 *   an independent, revocable refresh session.
 */
export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  issuedAt: number;
}
export interface OAuthPendingRequest {
  id: string; csrf: string; clientId: string; clientName: string;
  redirectUri: string; redirectUriProvided: boolean;
  challenge: string; state?: string; scope: string; resource?: string; expiresAt: number;
}
export interface OAuthCode {
  clientId: string; redirectUri: string; redirectUriProvided: boolean;
  challenge: string; userId: string; scope: string; resource?: string; expiresAt: number;
}
export class OAuthError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) { super(description); }
}

const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 10 * 60_000;
const KEY_PREFIX = 'tanva:oauth:';
export const OAUTH_SCOPE = 'tanva';
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:', 'ftp:', 'ws:', 'wss:', 'mailto:', 'tel:', 'chrome:', 'view-source:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const TAKE = `local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v`;

const token = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const isLoopbackHttp = (url: URL) => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

export function validateRedirectUri(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 512) throw new OAuthError('invalid_redirect_uri', 'redirect_uri 无效');
  let url: URL;
  try { url = new URL(raw); } catch { throw new OAuthError('invalid_redirect_uri', 'redirect_uri 无效'); }
  if (url.hash || raw.includes('#')) throw new OAuthError('invalid_redirect_uri', 'redirect_uri 不允许包含 fragment');
  if (url.protocol === 'https:' || isLoopbackHttp(url)) return raw;
  if (url.protocol === 'http:') throw new OAuthError('invalid_redirect_uri', 'http redirect_uri 仅允许本机回环地址');
  // RFC 8252 private-use URI scheme for native apps, e.g. workbuddy://...
  if (!/^[a-z][a-z0-9+.-]*:$/.test(url.protocol) || BLOCKED_SCHEMES.has(url.protocol)) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uri scheme 不允许');
  }
  return raw;
}

/** Exact string match; loopback http URIs may differ only by port (RFC 8252 §7.3). */
export function redirectUriMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true;
  try {
    const a = new URL(registered); const b = new URL(presented);
    if (!isLoopbackHttp(a) || !isLoopbackHttp(b)) return false;
    return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch { return false; }
}

@Injectable()
export class OAuthService implements OnModuleDestroy {
  private readonly redis?: Redis;
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();
  private readonly production: boolean;
  private readonly signingKey: Buffer;
  readonly issuer: string;

  constructor(config: ConfigService) {
    this.production = !['test', 'development'].includes(config.get<string>('NODE_ENV') || '');
    this.issuer = new URL(config.get<string>('OAUTH_ISSUER') || 'https://tanvas.cn').origin;
    const secret = config.get<string>('OAUTH_CLIENT_SIGNING_SECRET') || config.get<string>('JWT_ACCESS_SECRET') || 'dev-access-secret';
    // Domain-separated so a client_id signature can never double as a JWT signature.
    this.signingKey = createHmac('sha256', secret).update('tanva-oauth-client-id-v1').digest();
    const redisUrl = config.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
      this.redis.on('error', () => { /* requests report 503; never log Redis URLs */ });
    }
  }
  async onModuleDestroy() { this.redis?.disconnect(); }

  /** MCP resource identifiers this server issues tokens for. */
  get resources(): string[] { return [`${this.issuer}/mcp`, this.issuer]; }

  metadata() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/api/oauth/authorize`,
      token_endpoint: `${this.issuer}/api/oauth/token`,
      registration_endpoint: `${this.issuer}/api/oauth/register`,
      revocation_endpoint: `${this.issuer}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [OAUTH_SCOPE],
    };
  }

  // ------------------------------------------------------------- clients

  register(input: Record<string, unknown> | null | undefined) {
    if (!input || typeof input !== 'object') throw new OAuthError('invalid_client_metadata', '请求体必须是 JSON 对象');
    const uris = input.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5) throw new OAuthError('invalid_redirect_uri', 'redirect_uris 需要 1-5 个');
    const redirectUris = [...new Set(uris.map(validateRedirectUri))];
    const method = input.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') throw new OAuthError('invalid_client_metadata', '仅支持公开客户端（token_endpoint_auth_method=none）');
    const grantTypes = input.grant_types;
    if (grantTypes !== undefined && (!Array.isArray(grantTypes) || grantTypes.some(g => g !== 'authorization_code' && g !== 'refresh_token'))) {
      throw new OAuthError('invalid_client_metadata', 'grant_types 仅支持 authorization_code / refresh_token');
    }
    const responseTypes = input.response_types;
    if (responseTypes !== undefined && (!Array.isArray(responseTypes) || responseTypes.some(r => r !== 'code'))) {
      throw new OAuthError('invalid_client_metadata', 'response_types 仅支持 code');
    }
    const rawName = typeof input.client_name === 'string' ? input.client_name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    const clientName = (rawName || 'MCP Client').slice(0, 64);
    const issuedAt = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ v: 1, n: clientName, r: redirectUris, t: issuedAt })).toString('base64url');
    const clientId = `tmc_${body}.${createHmac('sha256', this.signingKey).update(body).digest('base64url')}`;
    return {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: OAUTH_SCOPE,
    };
  }

  resolveClient(clientId: unknown): OAuthClient {
    const invalid = new OAuthError('invalid_client', 'client_id 无效，请重新注册客户端', 401);
    if (typeof clientId !== 'string' || clientId.length > 4096 || !clientId.startsWith('tmc_')) throw invalid;
    const [body, signature, extra] = clientId.slice(4).split('.');
    if (!body || !signature || extra !== undefined) throw invalid;
    if (!equal(signature, createHmac('sha256', this.signingKey).update(body).digest('base64url'))) throw invalid;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { v: number; n: string; r: string[]; t: number };
      if (parsed.v !== 1 || !Array.isArray(parsed.r)) throw invalid;
      return { clientId, clientName: parsed.n, redirectUris: parsed.r, issuedAt: parsed.t };
    } catch { throw invalid; }
  }

  // ------------------------------------------------------- authorization

  /**
   * Validates an /authorize request. Errors that make the redirect_uri
   * untrustworthy are thrown with `redirect: false`; the rest may be sent back
   * to the client's redirect_uri.
   */
  async beginAuthorization(query: Record<string, unknown>): Promise<OAuthPendingRequest> {
    const client = this.resolveClient(query.client_id);
    const presented = query.redirect_uri;
    let redirectUri: string;
    if (presented === undefined || presented === '') {
      if (client.redirectUris.length !== 1) throw new OAuthError('invalid_request', '缺少 redirect_uri');
      redirectUri = client.redirectUris[0];
    } else {
      if (typeof presented !== 'string' || !client.redirectUris.some(uri => redirectUriMatches(uri, presented))) {
        throw new OAuthError('invalid_request', 'redirect_uri 与注册时不一致');
      }
      redirectUri = presented;
    }
    const state = typeof query.state === 'string' ? query.state : undefined;
    const fail = (error: string, description: string) => { throw Object.assign(new OAuthError(error, description), { redirectUri, state }); };
    if (state !== undefined && state.length > 2048) fail('invalid_request', 'state 过长');
    if (query.response_type !== 'code') fail('unsupported_response_type', '仅支持 response_type=code');
    if (query.code_challenge_method !== 'S256') fail('invalid_request', '必须使用 PKCE（code_challenge_method=S256）');
    if (typeof query.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(query.code_challenge)) fail('invalid_request', 'code_challenge 无效');
    let resource: string | undefined;
    if (query.resource !== undefined && query.resource !== '') {
      const value = String(query.resource).replace(/\/+$/, '');
      if (!this.resources.includes(value)) fail('invalid_target', 'resource 不是本服务的 MCP 地址');
      resource = value;
    }
    const pending: OAuthPendingRequest = {
      id: token(), csrf: token(), clientId: client.clientId, clientName: client.clientName,
      redirectUri, redirectUriProvided: presented !== undefined && presented !== '',
      challenge: query.code_challenge as string, state, scope: OAUTH_SCOPE, resource,
      expiresAt: Date.now() + REQUEST_TTL_MS,
    };
    await this.put(`req:${pending.id}`, pending, REQUEST_TTL_MS);
    return pending;
  }

  async readRequest(id: unknown): Promise<OAuthPendingRequest | null> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    return this.get<OAuthPendingRequest>(`req:${id}`);
  }

  /** Consumes the consent request and returns the URL the browser must navigate to. */
  async decide(id: unknown, csrf: unknown, userId: string, decision: unknown): Promise<string> {
    const pending = await this.readRequest(id);
    if (!pending) throw new OAuthError('invalid_request', '授权请求已过期，请回到 Agent 重新连接', 410);
    if (typeof csrf !== 'string' || !equal(csrf, pending.csrf)) throw new OAuthError('access_denied', '授权页面校验失败', 401);
    if (decision !== 'approve' && decision !== 'deny') throw new OAuthError('invalid_request', '无效授权决定');
    if (!await this.take<OAuthPendingRequest>(`req:${pending.id}`)) throw new OAuthError('invalid_request', '此授权已处理', 409);
    if (decision === 'deny') return this.redirectWith(pending.redirectUri, { error: 'access_denied', error_description: '用户拒绝了授权', state: pending.state });
    const code = token();
    const row: OAuthCode = {
      clientId: pending.clientId, redirectUri: pending.redirectUri, redirectUriProvided: pending.redirectUriProvided,
      challenge: pending.challenge, userId, scope: pending.scope, resource: pending.resource, expiresAt: Date.now() + CODE_TTL_MS,
    };
    await this.put(`code:${createHash('sha256').update(code).digest('base64url')}`, row, CODE_TTL_MS);
    return this.redirectWith(pending.redirectUri, { code, state: pending.state });
  }

  redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries({ ...params, iss: this.issuer })) if (value !== undefined) url.searchParams.set(key, value);
    return url.toString();
  }

  /** authorization_code grant: returns the user the code was issued to. */
  async redeemCode(input: Record<string, unknown>): Promise<{ userId: string; client: OAuthClient; scope: string }> {
    const client = this.resolveClient(input.client_id);
    if (typeof input.code !== 'string' || input.code.length > 256) throw new OAuthError('invalid_request', '缺少 code');
    if (typeof input.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier)) throw new OAuthError('invalid_request', 'code_verifier 无效');
    const row = await this.take<OAuthCode>(`code:${createHash('sha256').update(input.code).digest('base64url')}`);
    if (!row) throw new OAuthError('invalid_grant', '授权码无效、已过期或已被使用');
    if (row.clientId !== client.clientId) throw new OAuthError('invalid_grant', '授权码不属于该客户端');
    if (input.redirect_uri !== undefined || row.redirectUriProvided) {
      if (input.redirect_uri !== row.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri 不匹配');
    }
    if (!equal(createHash('sha256').update(input.code_verifier).digest('base64url'), row.challenge)) throw new OAuthError('invalid_grant', 'PKCE 校验失败');
    if (input.resource !== undefined && input.resource !== '' && String(input.resource).replace(/\/+$/, '') !== (row.resource ?? String(input.resource).replace(/\/+$/, ''))) {
      throw new OAuthError('invalid_target', 'resource 与授权时不一致');
    }
    return { userId: row.userId, client, scope: row.scope };
  }

  // ---------------------------------------------------------------- store

  private available() {
    if (this.production && !this.redis) throw new ServiceUnavailableException('OAuth 授权需要配置 REDIS_URL');
  }
  private async withStore<T>(work: () => Promise<T>): Promise<T> {
    this.available();
    try { return await work(); }
    catch (error) { throw new ServiceUnavailableException('OAuth 授权存储不可用，请稍后重试', { cause: error }); }
  }
  private put(key: string, value: unknown, ttlMs: number) {
    return this.withStore(async () => {
      const raw = JSON.stringify(value);
      if (this.redis) { await this.redis.set(`${KEY_PREFIX}${key}`, raw, 'PX', ttlMs); return; }
      const now = Date.now();
      for (const [k, entry] of this.memory) if (entry.expiresAt <= now) this.memory.delete(k);
      if (this.memory.size >= 5000) throw new Error('OAuth memory store full');
      this.memory.set(key, { value: raw, expiresAt: now + ttlMs });
    });
  }
  private get<T>(key: string): Promise<T | null> {
    return this.withStore(async () => {
      const raw = this.redis ? await this.redis.get(`${KEY_PREFIX}${key}`) : this.liveMemory(key);
      return raw ? JSON.parse(raw) as T : null;
    });
  }
  private take<T>(key: string): Promise<T | null> {
    return this.withStore(async () => {
      let raw: string | null;
      if (this.redis) raw = (await this.redis.eval(TAKE, 1, `${KEY_PREFIX}${key}`)) as string | null;
      else { raw = this.liveMemory(key); this.memory.delete(key); }
      return raw ? JSON.parse(raw) as T : null;
    });
  }
  private liveMemory(key: string): string | null {
    const entry = this.memory.get(key);
    return entry && entry.expiresAt > Date.now() ? entry.value : null;
  }
}
