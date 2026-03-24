import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Post,
  Body,
  UseGuards,
  ServiceUnavailableException,
  Req,
  Logger,
  HttpException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OssService } from './oss.service';
import { CreditsService } from '../credits/credits.service';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { ServiceType } from '../credits/credits.config';

type ConvertVideoToGifDto = {
  videoUrl: string;
  projectId?: string;
  startSeconds?: number;
  durationSeconds?: number;
  fps?: number;
  width?: number;
};

const MIN_FPS = 2;
const MAX_FPS = 20;
const MIN_WIDTH = 160;
const MAX_WIDTH = 960;

@ApiTags('video-gif')
@Controller('video-gif')
export class VideoGifController {
  private readonly logger = new Logger(VideoGifController.name);

  constructor(
    private readonly oss: OssService,
    private readonly creditsService: CreditsService,
  ) {}

  @Post('convert')
  @ApiOperation({ summary: 'Convert video to GIF using ffmpeg' })
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async convert(@Body() dto: ConvertVideoToGifDto, @Req() req: any): Promise<{
    success: boolean;
    gifUrl: string;
    gifKey: string;
    duration: number;
    startSeconds: number;
    durationSeconds: number;
    fps: number;
    width: number;
  }> {
    const videoUrl = this.parseAndValidateVideoUrl(dto.videoUrl);

    const startSeconds = this.clampNumber(dto.startSeconds, 0, 3600, 0);
    const fps = Math.round(this.clampNumber(dto.fps, MIN_FPS, MAX_FPS, 10));
    const width = Math.round(this.clampNumber(dto.width, MIN_WIDTH, MAX_WIDTH, 480));
    const userId = this.getUserId(req);
    const serviceType: ServiceType = 'video-to-gif';
    const startTime = Date.now();
    let apiUsageId: string | null = null;
    let tempDir: string | null = null;

    if (!userId) {
      throw new BadRequestException('需要用户认证');
    }

    try {
      await this.creditsService.getOrCreateAccount(userId);

      const deductResult = await this.creditsService.preDeductCredits({
        userId,
        serviceType,
        model: 'ffmpeg-gif',
        outputImageCount: 1,
        requestParams: {
          fps,
          width,
          startSeconds,
          durationSeconds: dto.durationSeconds,
        },
        ipAddress: req?.ip,
        userAgent: req?.headers?.['user-agent'],
      });
      apiUsageId = deductResult.apiUsageId;

      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-gif-'));

      const duration = await this.getVideoDuration(videoUrl);
      if (!duration || duration <= 0) {
        throw new BadRequestException('Cannot get video duration');
      }

      if (startSeconds >= duration) {
        throw new BadRequestException('startSeconds must be less than video duration');
      }

      const remainingDuration = Math.max(0.5, duration - startSeconds);
      const durationSeconds = Number.isFinite(dto.durationSeconds as number)
        ? this.clampNumber(dto.durationSeconds, 0.5, remainingDuration, remainingDuration)
        : remainingDuration;

      const outputPath = path.join(tempDir, 'output.gif');
      await this.convertWithFfmpeg({
        videoUrl,
        outputPath,
        startSeconds,
        durationSeconds,
        fps,
        width,
      });

      const key = this.buildOutputKey(dto.projectId);
      const buffer = await fs.readFile(outputPath);
      const { Readable } = await import('stream');
      const stream = Readable.from(buffer);

      const { url, key: uploadedKey } = await this.oss.putStream(key, stream, {
        headers: { 'Content-Type': 'image/gif' },
      });

      if (apiUsageId) {
        try {
          await this.creditsService.updateApiUsageStatus(
            apiUsageId,
            ApiResponseStatus.SUCCESS,
            undefined,
            Date.now() - startTime,
          );
        } catch (statusError) {
          this.logger.warn(
            `Failed to mark video-to-gif api usage success: ${
              statusError instanceof Error ? statusError.message : String(statusError)
            }`,
          );
        }
      }

      return {
        success: true,
        gifUrl: url,
        gifKey: uploadedKey,
        duration,
        startSeconds,
        durationSeconds,
        fps,
        width,
      };
    } catch (err: any) {
      if (apiUsageId) {
        await this.failAndRefund(userId, apiUsageId, err?.message || 'Video to GIF conversion failed', Date.now() - startTime);
      }

      const message = err?.message || 'Video to GIF conversion failed';
      if (message.includes('ffmpeg not installed') || message.includes('ffprobe not installed')) {
        throw new ServiceUnavailableException(message);
      }
      if (err instanceof HttpException) {
        throw err;
      }
      throw new BadGatewayException(message);
    } finally {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private getUserId(req: any): string | null {
    return req?.user?.id || req?.user?.sub || null;
  }

  private async failAndRefund(
    userId: string,
    apiUsageId: string,
    errorMessage: string,
    processingTime: number,
  ): Promise<void> {
    let failedMarked = false;
    try {
      await this.creditsService.updateApiUsageStatus(
        apiUsageId,
        ApiResponseStatus.FAILED,
        errorMessage,
        processingTime,
      );
      failedMarked = true;
    } catch (statusError) {
      this.logger.error(
        `Failed to mark video-to-gif api usage failed: ${
          statusError instanceof Error ? statusError.message : String(statusError)
        }`,
      );
    }

    if (!failedMarked) {
      try {
        await this.creditsService.markApiUsageFailedForUser(
          userId,
          apiUsageId,
          errorMessage,
          processingTime,
        );
        failedMarked = true;
      } catch (markError) {
        this.logger.error(
          `Failed to mark video-to-gif api usage failed for refund: ${
            markError instanceof Error ? markError.message : String(markError)
          }`,
        );
      }
    }

    if (!failedMarked) {
      this.logger.error(`Skip refund because failed status cannot be set. apiUsageId=${apiUsageId}`);
      return;
    }

    try {
      await this.creditsService.refundCredits(userId, apiUsageId);
    } catch (refundError) {
      this.logger.error(
        `Failed to refund video-to-gif credits: ${
          refundError instanceof Error ? refundError.message : String(refundError)
        }`,
      );
    }
  }

  private buildOutputKey(projectId?: string): string {
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2);
    if (projectId) {
      return `projects/${projectId}/flow/video-gif/${now}-${rand}.gif`;
    }
    return `uploads/flow/video-gif/${now}-${rand}.gif`;
  }

  private parseAndValidateVideoUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new BadRequestException('videoUrl is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new BadRequestException('Invalid videoUrl');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Unsupported videoUrl protocol');
    }

    const hostname = parsed.hostname;
    const allowedHosts = this.oss.allowedPublicHosts();
    const isAllowed =
      allowedHosts.includes(hostname) ||
      allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));

    if (!isAllowed) {
      throw new BadRequestException('videoUrl host not allowed');
    }

    return parsed.toString();
  }

  private clampNumber(
    value: number | undefined,
    min: number,
    max: number,
    fallback: number
  ): number {
    if (!Number.isFinite(value as number)) return fallback;
    return Math.min(max, Math.max(min, Number(value)));
  }

  private getVideoDuration(videoUrl: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoUrl,
      ]);

      let output = '';
      let errorOutput = '';

      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffprobe.on('error', (err: any) => {
        if (String(err?.code || '') === 'ENOENT') {
          reject(new Error('ffprobe not installed on server'));
          return;
        }
        reject(new Error(`ffprobe error: ${err.message}`));
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed: ${errorOutput.slice(-500)}`));
          return;
        }
        const duration = parseFloat(output.trim());
        resolve(Number.isFinite(duration) ? duration : 0);
      });
    });
  }

  private convertWithFfmpeg(params: {
    videoUrl: string;
    outputPath: string;
    startSeconds: number;
    durationSeconds: number;
    fps: number;
    width: number;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const filter = `fps=${params.fps},scale=${params.width}:-1:flags=lanczos,split[s0][s1];` +
        `[s0]palettegen=stats_mode=diff[p];` +
        `[s1][p]paletteuse=dither=bayer:bayer_scale=5`;

      const ffmpeg = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(params.startSeconds),
        '-t',
        String(params.durationSeconds),
        '-i',
        params.videoUrl,
        '-vf',
        filter,
        '-loop',
        '1',
        '-y',
        params.outputPath,
      ]);

      let errorOutput = '';

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('error', (err: any) => {
        if (String(err?.code || '') === 'ENOENT') {
          reject(new Error('ffmpeg not installed on server'));
          return;
        }
        reject(new Error(`ffmpeg error: ${err.message}`));
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg failed: ${errorOutput.slice(-500)}`));
          return;
        }
        resolve();
      });
    });
  }
}
