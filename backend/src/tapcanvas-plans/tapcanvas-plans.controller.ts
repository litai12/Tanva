import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { TapcanvasPlansService } from './tapcanvas-plans.service';

/** 「爆款复刻 & 一键成片」节点：TapCanvas 资产规划经 new-api 签名订单中转，按回执用量结算。 */
@Controller('tapcanvas-plans')
@UseGuards(JwtAuthGuard)
export class TapcanvasPlansController {
  constructor(private readonly plans: TapcanvasPlansService) {}
  private userId(req: any): string { return req.user?.id || req.user?.sub; }

  @Header('Cache-Control', 'no-store')
  @Get('options') options() { return this.plans.options(); }

  @Post() @HttpCode(202)
  create(@Req() req: any, @Body() body: any) { return this.plans.create(this.userId(req), body, req.headers?.['x-team-id']); }

  @Header('Cache-Control', 'no-store')
  @Get(':id') get(@Req() req: any, @Param('id') id: string) { return this.plans.get(id, this.userId(req)); }

  @Header('Cache-Control', 'no-store')
  @Get(':id/result') result(@Req() req: any, @Param('id') id: string) { return this.plans.result(id, this.userId(req)); }

  @Post(':id/cancel') @HttpCode(200)
  cancel(@Req() req: any, @Param('id') id: string) { return this.plans.cancel(id, this.userId(req)); }

  @Post(':id/retry') @HttpCode(202)
  retry(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.plans.retry(this.userId(req), id, body, req.headers?.['x-team-id']);
  }
}
