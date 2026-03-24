import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Post,
  Body,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OssService } from './oss.service';

type ConvertVideoToGifDto = {
  videoUrl: string;
  projectId?: string;
  startSeconds?: number;
  durationSeconds?: number;
  fps?: number;
  width?: number;
  loop?: number;
};

const MIN_FPS = 2;
const MAX_FPS = 20;
const MIN_WIDTH = 160;
const MAX_WIDTH = 960;
const MAX_DURATION_SECONDS = 15;

@ApiTags('video-gif')
@Controller('video-gif')
export class VideoGifController {
  constructor(private readonly oss: OssService) {}

  @Post('convert')
  @ApiOperation({ summary: 'Convert video to GIF using ffmpeg' })
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async convert(@Body() dto: ConvertVideoToGifDto): Promise<{
    success: boolean;
    gifUrl: string;
    gifKey: string;
    duration: number;
    startSeconds: number;
    durationSeconds: number;
    fps: number;
    width: number;
    loop: number;
  }> {
    const videoUrl = this.parseAndValidateVideoUrl(dto.videoUrl);

    const startSeconds = this.clampNumber(dto.startSeconds, 0, 3600, 0);
    const fps = Math.round(this.clampNumber(dto.fps, MIN_FPS, MAX_FPS, 10));
    const width = Math.round(this.clampNumber(dto.width, MIN_WIDTH, MAX_WIDTH, 480));
    const loop = Number.isFinite(dto.loop as number)
      ? Math.max(0, Math.floor(dto.loop as number))
      : 0;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-gif-'));

    try {
      const duration = await this.getVideoDuration(videoUrl);
      if (!duration || duration <= 0) {
        throw new BadRequestException('Cannot get video duration');
      }

      if (startSeconds >= duration) {
        throw new BadRequestException('startSeconds must be less than video duration');
      }

      const remainingDuration = Math.max(0.5, duration - startSeconds);
      const requestedDuration = this.clampNumber(
        dto.durationSeconds,
        0.5,
        MAX_DURATION_SECONDS,
        Math.min(5, remainingDuration)
      );
      const durationSeconds = Math.min(requestedDuration, remainingDuration);

      const outputPath = path.join(tempDir, 'output.gif');
      await this.convertWithFfmpeg({
        videoUrl,
        outputPath,
        startSeconds,
        durationSeconds,
        fps,
        width,
        loop,
      });

      const key = this.buildOutputKey(dto.projectId);
      const buffer = await fs.readFile(outputPath);
      const { Readable } = await import('stream');
      const stream = Readable.from(buffer);

      const { url, key: uploadedKey } = await this.oss.putStream(key, stream, {
        headers: { 'Content-Type': 'image/gif' },
      });

      return {
        success: true,
        gifUrl: url,
        gifKey: uploadedKey,
        duration,
        startSeconds,
        durationSeconds,
        fps,
        width,
        loop,
      };
    } catch (err: any) {
      const message = err?.message || 'Video to GIF conversion failed';
      if (message.includes('ffmpeg not installed') || message.includes('ffprobe not installed')) {
        throw new ServiceUnavailableException(message);
      }
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      throw new BadGatewayException(message);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
    loop: number;
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
        String(params.loop),
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
