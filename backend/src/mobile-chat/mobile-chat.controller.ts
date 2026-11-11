import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { MobileChatService } from './mobile-chat.service';

const HEARTBEAT_MS = 20_000;

/** 移动端 /m：会话与消息。消息接口以 SSE 返回本轮事件（accepted / status / delta / text / message / final / done）。 */
@ApiTags('mobile-chat')
@Controller('mobile-chat')
@UseGuards(JwtAuthGuard)
export class MobileChatController {
  constructor(private readonly chat: MobileChatService) {}
  private userId(req: any): string { return req.user?.id || req.user?.sub; }

  @Header('Cache-Control', 'no-store')
  @Get('conversations') list(@Req() req: any, @Query('limit') limit?: string) { return this.chat.list(this.userId(req), Number(limit) || 30); }

  @Post('conversations') create(@Req() req: any) { return this.chat.create(this.userId(req)); }

  @Header('Cache-Control', 'no-store')
  @Get('conversations/:id') get(@Req() req: any, @Param('id') id: string) { return this.chat.get(id, this.userId(req)); }

  @Patch('conversations/:id') rename(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.chat.rename(id, this.userId(req), body?.title); }

  @Delete('conversations/:id') remove(@Req() req: any, @Param('id') id: string) { return this.chat.remove(id, this.userId(req)); }

  /** 详情页各屏拼成一张长图（已拼过直接返回）。 */
  @Post('messages/:id/stitch')
  stitch(@Req() req: any, @Param('id') id: string) { return this.chat.stitch(this.userId(req), id); }

  @Post('conversations/:id/messages')
  async send(@Req() req: any, @Res({ passthrough: false }) res: any, @Param('id') id: string, @Body() body: any) {
    // 校验失败在进入 SSE 前抛出，按普通 JSON 错误返回。
    const turn = await this.chat.prepareTurn(this.userId(req), id, body);
    let started = false;
    try {
    const origin = req.headers?.origin;
    if (origin) {
      res.raw.setHeader('Access-Control-Allow-Origin', origin);
      res.raw.setHeader('Access-Control-Allow-Credentials', 'true');
      res.raw.setHeader('Vary', 'Origin');
    }
    res.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let open = true;
    const write = (event: string, data: Record<string, unknown>) => {
      if (!open) return;
      try { res.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { open = false; }
    };
    write('accepted', { userMessage: { id: turn.userMessage.id }, assistantMessageId: turn.assistantMessage.id });
    const heartbeat = setInterval(() => { if (open) { try { res.raw.write(':keepalive\n\n'); } catch { open = false; } } }, HEARTBEAT_MS);
    // 客户端断开不终止本轮：服务端跑完并落库，前端重新进入会话即可看到结果。
    req.raw.on('close', () => { open = false; });
    started = true;
    try {
      await this.chat.runTurn(turn, write);
    } finally {
      clearInterval(heartbeat);
      if (open) { try { res.raw.end(); } catch {} }
    }
    } finally {
      // runTurn 自己会释放；只有没进入 runTurn（写响应头失败等）时在这里兜底，释放是幂等的。
      if (!started) turn.release();
    }
  }
}
