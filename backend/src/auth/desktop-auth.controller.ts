import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Post, Query, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt.guard';
import { DesktopGrantService, type CreateDesktopGrant } from './desktop-grant.service';
import { UsersService } from '../users/users.service';

type AuthenticatedRequest = FastifyRequest & { user?: { id: string; sub: string; name?: string; phone?: string } };
@Injectable()
export class OptionalDesktopJwtGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(error: unknown, user: TUser): TUser {
    if (error) throw error;
    return user;
  }
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || ''));

@Controller('auth/desktop')
export class DesktopAuthController {
  constructor(private readonly grants: DesktopGrantService, private readonly auth: AuthService, private readonly users: UsersService) {}
  @Post('session') @HttpCode(HttpStatus.OK)
  async create(@Body() input: CreateDesktopGrant) {
    const grant = await this.grants.create(input);
    return { sessionId: grant.id, expiresAt: new Date(grant.expiresAt).toISOString(), verificationUrl: `https://tanvas.cn/api/auth/desktop/authorize?sessionId=${grant.id}` };
  }
  @Get('authorize') @UseGuards(OptionalDesktopJwtGuard)
  async authorize(@Query('sessionId') id: string, @Req() request: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const grant = await this.grants.read(id);
    if (!grant || grant.status !== 'pending') return reply.code(410).send('此桌面授权已过期或已处理，请在 Tanva 中重新登录。');
    if (!request.user) return reply.code(HttpStatus.FOUND).redirect(`/auth/login?returnTo=${encodeURIComponent(`/api/auth/desktop/authorize?sessionId=${id}`)}`);
    const nonce = randomBytes(16).toString('base64');
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
    const body = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tanva 桌面授权</title>
<style nonce="${nonce}">body{font:16px system-ui;background:#f8fafc;color:#17202a;margin:0;padding:64px 24px}main{max-width:480px;margin:auto;background:white;padding:32px;border-radius:20px}button,a{display:inline-block;padding:12px 20px;border-radius:10px;border:0;margin:8px 8px 0 0;background:#e9eff5;color:#17202a}button:first-of-type{background:#171e27;color:white}#message{min-height:24px}</style>
<main><h1>授权 Tanva 桌面登录</h1><p>当前账号：${escapeHtml(request.user.name || request.user.phone || request.user.id)}</p><p>允许后，桌面应用将使用此账号访问 Tanva 项目与资产。网页和桌面分别保存登录会话。</p><button id="approve">授权登录</button><button id="deny">拒绝</button><p id="message"></p><a id="return" hidden>返回 Tanva</a></main>
<script nonce="${nonce}">const input=${JSON.stringify({ sessionId: id, csrf: grant.csrf })};const buttons=[document.getElementById('approve'),document.getElementById('deny')];for(const button of buttons)button.onclick=async()=>{buttons.forEach(x=>x.disabled=true);try{const response=await fetch('/api/auth/desktop/approve',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,decision:button.id})});if(!response.ok)throw new Error('授权失败，请重新发起登录。');const result=await response.json();document.getElementById('message').textContent=result.status==='approved'?'已授权，可以返回 Tanva。':'已拒绝授权。';const link=document.getElementById('return');link.href=result.callbackUrl;link.hidden=false;window.location.href=result.callbackUrl;}catch(error){document.getElementById('message').textContent=error.message;buttons.forEach(x=>x.disabled=false);}};</script></html>`;
    return reply.type('text/html; charset=utf-8').send(body);
  }
  @Post('approve') @HttpCode(HttpStatus.OK) @UseGuards(JwtAuthGuard)
  async approve(@Body() body: { sessionId: string; csrf: string; decision: string }, @Req() request: AuthenticatedRequest) {
    if (request.headers.origin !== 'https://tanvas.cn') throw new UnauthorizedException('授权必须来自 Tanva 网站');
    if (!request.user) throw new UnauthorizedException('请先登录 Tanva');
    return this.grants.approve(body.sessionId, body.csrf, request.user.id || request.user.sub, body.decision);
  }
  @Post('exchange') @HttpCode(HttpStatus.OK)
  async exchange(@Body() body: { sessionId: string; state: string; verifier: string }, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.grants.exchange(body.sessionId, body.state, body.verifier);
    reply.header('Cache-Control', 'no-store');
    if (result.status !== 'authorized') return result;
    const user = await this.users.findById(result.userId);
    if (!user) throw new UnauthorizedException('账号不存在');
    const tokens = await this.auth.login({ id: user.id, email: user.email || '', role: user.role }, { ip: request.ip, ua: request.headers['user-agent'] });
    this.auth.setAuthCookies(reply, tokens, request);
    return { status: 'authorized' };
  }
}
