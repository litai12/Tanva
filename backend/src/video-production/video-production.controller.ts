import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { VideoProductionService } from './video-production.service';

/**
 * 一键成片 / 爆款复刻 / 单段生视频（服务端流水线，供 MCP / 外部 Agent 使用）。
 * 规划 → 参考图 → Seedance 视频 → ffmpeg 合成，全部在服务端完成，计费沿用画布节点同一批接口。
 */
@ApiTags('video-productions')
@Controller('video-productions')
@UseGuards(JwtAuthGuard)
export class VideoProductionController {
  constructor(private readonly productions: VideoProductionService) {}
  private userId(req: any): string { return req.user?.id || req.user?.sub; }

  /** 当前账号可用的规划 / 生图 / 生视频模型及参考价格。 */
  @Header('Cache-Control', 'no-store')
  @Get('models') models(@Req() req: any) { return this.productions.models(this.userId(req), req.headers?.['x-team-id']); }

  @Header('Cache-Control', 'no-store')
  @Get() list(@Req() req: any, @Query('limit') limit?: string) { return this.productions.list(this.userId(req), Number(limit) || 20); }

  /** mode: film（一键成片，story）/ remake（爆款复刻，referenceVideoUrl）/ single（单段生视频，prompt）。 */
  @Post() @HttpCode(202)
  create(@Req() req: any, @Body() body: any) { return this.productions.create(this.userId(req), body, req.headers?.['x-team-id']); }

  @Header('Cache-Control', 'no-store')
  @Get(':id') get(@Req() req: any, @Param('id') id: string) { return this.productions.get(id, this.userId(req)); }

  /** 余额不足暂停后继续；可带 clipEdits 修改尚未开始的 Clip。 */
  @Post(':id/produce') @HttpCode(202)
  produce(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.productions.produce(id, this.userId(req), body); }

  /** 只重跑失败的步骤（可用 clipKeys 限定）。 */
  @Post(':id/retry') @HttpCode(202)
  retry(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.productions.retry(id, this.userId(req), body); }

  @Post(':id/cancel') @HttpCode(200)
  cancel(@Req() req: any, @Param('id') id: string) { return this.productions.cancel(id, this.userId(req)); }
}
