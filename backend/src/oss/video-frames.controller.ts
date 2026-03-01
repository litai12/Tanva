import {
  BadRequestException,
  Controller,
  Post,
  Body,
  BadGatewayException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OssService } from './oss.service';

type ExtractFramesDto = {
  videoUrl: string;
  intervalSeconds?: number;
  projectId?: string;
};

type FrameResult = {
  index: number;
  timestamp: number;
  imageUrl: string;
};

@ApiTags('video-frames')
@Controller('video-frames')
export class VideoFramesController {
  constructor(private readonly oss: OssService) {}

  @Post('extract')
  @ApiOperation({ summary: 'Extract frames from video using ffmpeg' })
  async extractFrames(@Body() dto: ExtractFramesDto): Promise<{
    success: boolean;
    frames: FrameResult[];
    totalFrames: number;
    duration: number;
  }> {
    const { videoUrl, intervalSeconds = 3, projectId } = dto;

    if (!videoUrl) {
      throw new BadRequestException('Missing videoUrl');
    }

    if (intervalSeconds < 0.5 || intervalSeconds > 60) {
      throw new BadRequestException('intervalSeconds must be between 0.5 and 60');
    }

    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-frames-'));

    try {
      // Get video duration first
      const duration = await this.getVideoDuration(videoUrl);
      if (!duration || duration <= 0) {
        throw new BadRequestException('Cannot get video duration');
      }

      // Extract frames using ffmpeg
      const frameFiles = await this.extractFramesWithFfmpeg(
        videoUrl,
        tempDir,
        intervalSeconds,
        duration
      );

      // Upload frames to OSS
      const frames = await this.uploadFramesToOss(
        frameFiles,
        intervalSeconds,
        projectId
      );

      return {
        success: true,
        frames,
        totalFrames: frames.length,
        duration,
      };
    } catch (err: any) {
      console.error('Frame extraction failed:', err);
      throw new BadGatewayException(err.message || 'Frame extraction failed');
    } finally {
      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private getVideoDuration(videoUrl: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
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

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed: ${errorOutput}`));
          return;
        }
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? 0 : duration);
      });

      ffprobe.on('error', (err) => {
        reject(new Error(`ffprobe error: ${err.message}`));
      });
    });
  }

  private extractFramesWithFfmpeg(
    videoUrl: string,
    outputDir: string,
    intervalSeconds: number,
    duration: number
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const outputPattern = path.join(outputDir, 'frame_%04d.jpg');

      // Use fps filter to extract frames at interval
      const fps = 1 / intervalSeconds;

      const ffmpeg = spawn('ffmpeg', [
        '-i', videoUrl,
        '-vf', `fps=${fps}`,
        '-q:v', '2', // High quality JPEG
        '-y',
        outputPattern,
      ]);

      let errorOutput = '';

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg failed: ${errorOutput.slice(-500)}`));
          return;
        }

        try {
          const files = await fs.readdir(outputDir);
          const frameFiles = files
            .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
            .sort()
            .map((f) => path.join(outputDir, f));
          resolve(frameFiles);
        } catch (err) {
          reject(err);
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`ffmpeg error: ${err.message}`));
      });
    });
  }

  private async uploadFramesToOss(
    frameFiles: string[],
    intervalSeconds: number,
    projectId?: string
  ): Promise<FrameResult[]> {
    const results: FrameResult[] = [];
    const timestamp = Date.now();
    const dir = projectId
      ? `projects/${projectId}/frames/${timestamp}/`
      : `frames/${timestamp}/`;

    for (let i = 0; i < frameFiles.length; i++) {
      const filePath = frameFiles[i];
      const frameIndex = i + 1;
      const frameTimestamp = i * intervalSeconds;

      const key = `${dir}frame_${String(frameIndex).padStart(4, '0')}.jpg`;

      // Read file and upload
      const fileStream = await fs.readFile(filePath);
      const { Readable } = await import('stream');
      const stream = Readable.from(fileStream);

      const { url } = await this.oss.putStream(key, stream, {
        headers: { 'Content-Type': 'image/jpeg' },
      });

      results.push({
        index: frameIndex,
        timestamp: frameTimestamp,
        imageUrl: url,
      });
    }

    return results;
  }
}
