import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { VideoProviderService } from './services/video-provider.service';

/**
 * Internal endpoints called by the new-api `tencent-vod` task channel adaptor
 * (relay/channel/task/tencentvod). They expose the existing Tencent VOD AIGC
 * create/poll over HTTP so Tencent VOD becomes a first-class new-api channel
 * (logged + billed, distributor-selectable alongside apimart) without porting
 * the TC3 signing + per-model request building to Go.
 *
 * NOT behind ApiKeyOrJwtGuard — authenticated with a shared internal token
 * (env `TENCENT_VOD_INTERNAL_TOKEN`, also set as the tencent-vod channel key
 * in new-api). Network access should additionally be restricted to new-api.
 *
 * Credit deduction happens at the outer /ai/generate-video-provider call; this
 * endpoint only creates/polls the upstream task (no double charge).
 */
@ApiExcludeController()
@Controller('ai/internal/tencent-vod')
export class InternalTencentVodController {
  private readonly logger = new Logger(InternalTencentVodController.name);

  constructor(private readonly videoProviderService: VideoProviderService) {}

  private assertToken(token?: string): void {
    const expected = process.env.TENCENT_VOD_INTERNAL_TOKEN;
    if (!expected) {
      throw new UnauthorizedException('TENCENT_VOD_INTERNAL_TOKEN 未配置');
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException('invalid internal token');
    }
  }

  // new-api 的 task relay 只接受上游返回 200；NestJS @Post 默认 201 会被判定为
  // "channel error (status code: 201)" 导致 tencent-vod 渠道任务失败。强制 200。
  @Post('video')
  @HttpCode(200)
  async create(
    @Body() body: any,
    @Headers('x-internal-token') token?: string,
  ): Promise<{ task_id?: string; status?: string; error?: string }> {
    this.assertToken(token);
    try {
      const r = await this.videoProviderService.createViaTencentVod(body || {});
      return { task_id: r.taskId, status: r.status };
    } catch (error: any) {
      this.logger.error(
        `tencent-vod create failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Return 200 + error so the new-api adaptor surfaces it as a task error
      // (it treats an empty task_id as failure).
      return { error: error?.message || 'tencent-vod create failed' };
    }
  }

  @Get('video/:taskId')
  async query(
    @Param('taskId') taskId: string,
    @Headers('x-internal-token') token?: string,
  ): Promise<{ status: string; url?: string; reason?: string }> {
    this.assertToken(token);
    const r = await this.videoProviderService.queryViaTencentVod(taskId);
    return { status: r.status, url: r.url, reason: r.reason };
  }
}
