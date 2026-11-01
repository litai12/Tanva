import { Body, Controller, Get, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
/** 每次 OAuth 授权一个 grantId：同一授权的轮换会话共享，用于按授权查找与吊销。 */
const newGrantId = () => `g_${randomBytes(18).toString('base64url')}`;
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { JwtAuthGuard } from '../guards/jwt.guard';
import { OptionalDesktopJwtGuard } from '../desktop-auth.controller';
import { OAuthError, OAuthService, OAUTH_SCOPE } from './oauth.service';

type AuthenticatedRequest = FastifyRequest & { user?: { id: string; sub: string; name?: string; phone?: string } };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || ''));
/** Token/registration requests may be JSON or application/x-www-form-urlencoded (main.ts keeps the latter as a raw string). */
const formBody = (body: unknown): Record<string, unknown> => {
  if (typeof body === 'string') return Object.fromEntries(new URLSearchParams(body));
  return body && typeof body === 'object' ? body as Record<string, unknown> : {};
};
const redirectTarget = (uri: string) => {
  try { const url = new URL(uri); return url.protocol === 'https:' || url.protocol === 'http:' ? url.host : `${url.protocol}//`; }
  catch { return '未知'; }
};

@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private sendError(reply: FastifyReply, error: unknown) {
    reply.header('Cache-Control', 'no-store');
    if (error instanceof OAuthError) return reply.code(error.status).send({ error: error.error, error_description: error.description });
    throw error;
  }

  /** Same document the MCP service serves at /.well-known/oauth-authorization-server. */
  @Get('metadata')
  metadata() { return this.oauth.metadata(); }

  /** RFC 7591 dynamic client registration (public clients only). */
  @Post('register')
  register(@Body() body: unknown, @Res() reply: FastifyReply) {
    try { return reply.code(HttpStatus.CREATED).header('Cache-Control', 'no-store').send(this.oauth.register(formBody(body))); }
    catch (error) { return this.sendError(reply, error); }
  }

  @Get('authorize')
  async authorize(@Query() query: Record<string, unknown>, @Res() reply: FastifyReply) {
    try {
      const pending = await this.oauth.beginAuthorization(query);
      // Park the (long) OAuth parameters server-side so login can round-trip a short, whitelisted returnTo.
      return reply.code(HttpStatus.FOUND).redirect(`/api/oauth/consent?requestId=${pending.id}`);
    } catch (error) {
      if (error instanceof OAuthError && 'redirectUri' in error && typeof error.redirectUri === 'string') {
        const state = (error as OAuthError & { state?: string }).state;
        return reply.code(HttpStatus.FOUND).redirect(this.oauth.redirectWith(error.redirectUri, { error: error.error, error_description: error.description, state }));
      }
      if (error instanceof OAuthError) return this.page(reply, error.status === 401 ? 400 : error.status, '无法授权', `<p>${escapeHtml(error.description)}</p><p>请回到 Agent 中重新连接 Tanva。</p>`);
      throw error;
    }
  }

  @Get('consent') @UseGuards(OptionalDesktopJwtGuard)
  async consent(@Query('requestId') id: string, @Req() request: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const pending = await this.oauth.readRequest(id);
    if (!pending) return this.page(reply, 410, '授权已过期', '<p>此授权请求已过期或已处理，请回到 Agent 中重新连接 Tanva。</p>');
    if (!request.user) return reply.code(HttpStatus.FOUND).redirect(`/auth/login?returnTo=${encodeURIComponent(`/api/oauth/consent?requestId=${pending.id}`)}`);
    const nonce = randomBytes(16).toString('base64');
    const account = escapeHtml(request.user.name || request.user.phone || request.user.id);
    const input = JSON.stringify({ requestId: pending.id, csrf: pending.csrf }).replace(/</g, '\\u003c');
    return this.page(reply, 200, '授权 Agent 访问 Tanva', `<p>当前账号：${account}</p>
<p>「<strong>${escapeHtml(pending.clientName)}</strong>」请求以你的身份访问 Tanva（授权完成后将返回：${escapeHtml(redirectTarget(pending.redirectUri))}）。</p>
<p class="warn">允许后，该应用将获得与你网页登录相同的<strong>全部权限</strong>：读取 / 修改 / 删除项目与资产、调用 AI 生成并<strong>消耗你的积分</strong>等。只授权你信任、且是你本人刚刚发起连接的应用。</p>
<button id="approve">授权</button><button id="deny">拒绝</button><p id="message"></p>
<script nonce="${nonce}">const input=${input};const buttons=[document.getElementById('approve'),document.getElementById('deny')];for(const button of buttons)button.onclick=async()=>{buttons.forEach(x=>x.disabled=true);try{const response=await fetch('/api/oauth/decision',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,decision:button.id})});const result=await response.json().catch(()=>({}));if(!response.ok||!result.redirectUrl)throw new Error(result.error_description||'授权失败，请回到 Agent 重新连接。');document.getElementById('message').textContent=button.id==='approve'?'已授权，正在返回应用…（若未自动跳转，可关闭此页面）':'已拒绝授权。';window.location.href=result.redirectUrl;}catch(error){document.getElementById('message').textContent=error.message;buttons.forEach(x=>x.disabled=false);}};</script>`, nonce);
  }

  @Post('decision') @UseGuards(JwtAuthGuard)
  async decision(@Body() body: { requestId?: string; csrf?: string; decision?: string }, @Req() request: AuthenticatedRequest, @Res() reply: FastifyReply) {
    try {
      if (request.headers.origin !== this.oauth.issuer) throw new OAuthError('access_denied', '授权必须来自 Tanva 网站', 401);
      const userId = request.user?.id || request.user?.sub;
      if (!userId) throw new OAuthError('access_denied', '请先登录 Tanva', 401);
      const redirectUrl = await this.oauth.decide(body?.requestId, body?.csrf, userId, body?.decision);
      return reply.code(HttpStatus.OK).header('Cache-Control', 'no-store').send({ redirectUrl });
    } catch (error) { return this.sendError(reply, error); }
  }

  @Post('token')
  async token(@Body() raw: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const body = formBody(raw);
    try {
      if (body.grant_type === 'authorization_code') {
        const { userId, client, scope } = await this.oauth.redeemCode(body);
        const user = await this.users.findById(userId);
        if (!user) throw new OAuthError('invalid_grant', '账号不存在');
        const tokens = await this.loginOrInvalidGrant(() => this.auth.login(
          { id: user.id, email: user.email || '', role: user.role },
          { ip: request.ip, ua: `oauth:${client.clientName} ${request.headers['user-agent'] || ''}`.trim().slice(0, 255), grantId: newGrantId() },
        ));
        return this.sendTokens(reply, tokens, scope);
      }
      if (body.grant_type === 'refresh_token') {
        if (body.client_id !== undefined) this.oauth.resolveClient(body.client_id);
        const refreshToken = body.refresh_token;
        if (typeof refreshToken !== 'string' || !refreshToken) throw new OAuthError('invalid_request', '缺少 refresh_token');
        const payload = await this.jwt.verifyAsync(refreshToken, { secret: this.config.get<string>('JWT_REFRESH_SECRET') || 'dev-refresh-secret' })
          .catch(() => { throw new OAuthError('invalid_grant', 'refresh_token 无效或已过期'); });
        // 只接受 OAuth 授权签发的 refresh token；网页/桌面会话不能借此换成 Agent 令牌。
        if (typeof payload?.gid !== 'string' || !payload.gid) throw new OAuthError('invalid_grant', 'refresh_token 不属于 OAuth 授权');
        const tokens = await this.loginOrInvalidGrant(() => this.auth.refresh(payload, refreshToken));
        return this.sendTokens(reply, tokens, OAUTH_SCOPE);
      }
      throw new OAuthError('unsupported_grant_type', '仅支持 authorization_code / refresh_token');
    } catch (error) { return this.sendError(reply, error); }
  }

  /**
   * RFC 7009：refresh 或 access token 均可，吊销其所属的整条 OAuth 授权（refresh 与已签发 access 立即失效）。
   * 未知 / 非 OAuth 令牌同样返回 200。
   */
  @Post('revoke')
  async revoke(@Body() raw: unknown, @Res() reply: FastifyReply) {
    const body = formBody(raw);
    const value = body.token;
    if (typeof value === 'string' && value) {
      const verify = (secret: string) => this.jwt.verifyAsync(value, { secret }).catch(() => null);
      const payload = await verify(this.config.get<string>('JWT_REFRESH_SECRET') || 'dev-refresh-secret')
        ?? await verify(this.config.get<string>('JWT_ACCESS_SECRET') || 'dev-access-secret');
      if (payload?.sub && typeof payload.gid === 'string' && payload.gid) await this.auth.revokeOAuthGrant(payload.sub, payload.gid);
    }
    return reply.code(HttpStatus.OK).header('Cache-Control', 'no-store').send({});
  }

  private async loginOrInvalidGrant<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status === 401 || status === 403) throw new OAuthError('invalid_grant', (error as Error).message || '授权无效');
      throw error;
    }
  }

  private sendTokens(reply: FastifyReply, tokens: { accessToken: string; refreshToken: string }, scope: string) {
    const exp = (this.jwt.decode(tokens.accessToken) as { exp?: number } | null)?.exp;
    const expiresIn = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 900;
    return reply.code(HttpStatus.OK).header('Cache-Control', 'no-store').header('Pragma', 'no-cache').send({
      access_token: tokens.accessToken, token_type: 'Bearer', expires_in: expiresIn, refresh_token: tokens.refreshToken, scope,
    });
  }

  private page(reply: FastifyReply, status: number, title: string, content: string, nonce = randomBytes(16).toString('base64')) {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style nonce="${nonce}">body{font:16px system-ui;background:#f8fafc;color:#17202a;margin:0;padding:64px 24px}main{max-width:520px;margin:auto;background:white;padding:32px;border-radius:20px}button{display:inline-block;padding:12px 20px;border-radius:10px;border:0;margin:8px 8px 0 0;background:#e9eff5;color:#17202a;font-size:15px;cursor:pointer}button:first-of-type{background:#171e27;color:white}#message{min-height:24px}.warn{background:#fff7e6;border-radius:10px;padding:12px;color:#7a4b00}</style>
<main><h1>${escapeHtml(title)}</h1>${content}</main></html>`;
    return reply.code(status).type('text/html; charset=utf-8').send(html);
  }
}
