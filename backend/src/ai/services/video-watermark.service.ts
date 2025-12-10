import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { OssService } from '../../oss/oss.service';
import type OSS from 'ali-oss';

interface VideoWatermarkOptions {
  text?: string;
  timeoutMs?: number;
  ossKey?: string;
}

@Injectable()
export class VideoWatermarkService {
  private readonly logger = new Logger(VideoWatermarkService.name);
  private readonly DEFAULT_TEXT = 'Tanvas AI';
  private readonly DEFAULT_TIMEOUT = 120_000;

  constructor(private readonly oss: OssService) {}

  /**
   * 为视频添加文字水印（样式与图片一致：右下角白色半透明），并直接上传至 OSS
   * 通过 ffmpeg 流式处理，避免落地临时文件
   */
  async addWatermarkAndUpload(
    sourceUrl: string,
    options?: VideoWatermarkOptions
  ): Promise<{ url: string; key: string; durationMs: number }> {
    const started = Date.now();
    const text = (options?.text || this.DEFAULT_TEXT).replace(/'/g, "\\'");
    const timeoutMs = options?.timeoutMs ?? this.DEFAULT_TIMEOUT;
    const key =
      options?.ossKey ||
      `videos/watermarked/${this.buildDatePrefix()}/video-${this.safeRandomId()}.mp4`;

    // 构造 drawtext 滤镜，字号按视频高度动态 3.5%，右下角内缩 20px
    const drawtext = `drawtext=text='${text}':fontcolor=white@0.75:fontsize=h*0.035:x=w-tw-20:y=h-th-20:font=sans-serif`;

    const ffArgs = [
      '-y',
      '-i',
      sourceUrl,
      '-vf',
      drawtext,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      'pipe:1',
    ];

    this.logger.log(`🎥 Start video watermarking -> OSS: ${key}`);

    const ffmpeg = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrChunks: Buffer[] = [];
    ffmpeg.stderr?.on('data', (chunk) => {
      if (stderrChunks.length < 20) stderrChunks.push(Buffer.from(chunk));
    });

    let timeout: NodeJS.Timeout | null = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
    }, timeoutMs);

    const uploadOptions: OSS.PutStreamOptions = {
      mime: 'video/mp4',
      timeout: 120000,
      meta: { uid: 0, pid: 0 },
      // callback 可选，这里占位满足类型要求
      callback: undefined as unknown as OSS.ObjectCallback,
    };
    const uploadPromise = this.oss.putStream(key, ffmpeg.stdout, uploadOptions);

    const exitPromise = new Promise<void>((resolve, reject) => {
      ffmpeg.on('error', (err) => reject(err));
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const stderr = Buffer.concat(stderrChunks).toString('utf8');
          reject(
            new ServiceUnavailableException(
              `ffmpeg exited with code ${code}${stderr ? `: ${stderr}` : ''}`,
            ),
          );
        }
      });
    });

    try {
      await Promise.all([uploadPromise, exitPromise]);
      const elapsed = Date.now() - started;
      if (timeout) clearTimeout(timeout);
      const { url } = await uploadPromise;
      this.logger.log(`✅ Video watermarked and uploaded: ${key} (${elapsed}ms)`);
      return { url, key, durationMs: elapsed };
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      this.logger.warn(`❌ Video watermark failed for ${key}: ${error}`);
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      ffmpeg.stdout?.removeAllListeners();
      ffmpeg.stderr?.removeAllListeners();
    }
  }

  private buildDatePrefix(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  }

  private safeRandomId(): string {
    return (randomUUID?.() || Math.random().toString(16).slice(2, 10)).replace(/-/g, '');
  }
}

