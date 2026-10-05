import { Body, Controller, Get, HttpCode, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { DesktopChatService } from './desktop-chat.service';

@Controller('desktop/v1')
@UseGuards(JwtAuthGuard)
export class DesktopChatController {
  constructor(private readonly chat: DesktopChatService) {}
  @Header('Cache-Control', 'no-store')
  @Get('billing') billing(@Req() req: any) { return this.chat.billing(req.user.id, req.headers['x-tanva-team-id']); }
  @Header('Cache-Control', 'no-store')
  @Get('models') models(@Req() req: any) { return this.chat.models(req.user.id, req.headers['x-tanva-team-id']); }
  @Header('Cache-Control', 'no-store')
  @Get('billing/receipts') receipts(@Req() req: any, @Query('taskId') taskId?: string, @Query('conversationId') conversationId?: string) {
    return this.chat.listReceipts(req.user.id, taskId, conversationId);
  }
  @Header('Cache-Control', 'no-store')
  @Get('chat/requests/:id') request(@Req() req: any, @Param('id') id: string) { return this.chat.request(req.user.id, id); }
  @Header('Cache-Control', 'no-store')
  @Post('chat/completions') @HttpCode(200)
  completion(@Body() body: any, @Req() req: any) { return this.chat.complete(req.user.id, body, req.headers); }
}
