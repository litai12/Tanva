import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiTags, ApiConsumes } from '@nestjs/swagger';
import { OssService } from './oss.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Readable } from 'stream';

const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
  'video/x-flv',
];

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(private readonly oss: OssService) {}

  @Post('presign')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  presign(@Body() body: { dir?: string; maxSize?: number }) {
    const dir = body?.dir ?? 'uploads/';
    const max = body?.maxSize ?? 32 * 1024 * 1024; // 增加默认最大文件大小到32MB，支持更大的模板JSON文件
    const data = this.oss.presignPost(dir, 300, max);
    return data;
  }

  @Post('video')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VIDEO_SIZE } }))
  @ApiConsumes('multipart/form-data')
  async uploadVideo(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!SUPPORTED_VIDEO_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported video format: ${file.mimetype}. Supported: ${SUPPORTED_VIDEO_TYPES.join(', ')}`
      );
    }

    const ext = file.originalname.split('.').pop() || 'mp4';
    const key = `videos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const stream = Readable.from(file.buffer);
    const result = await this.oss.putStream(key, stream, {
      headers: { 'Content-Type': file.mimetype },
    });

    return { url: result.url, key: result.key };
  }

  @Post('transfer-video')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async transferVideo(@Body() body: { videoUrl: string }) {
    const { videoUrl } = body;
    if (!videoUrl || typeof videoUrl !== 'string') {
      throw new BadRequestException('videoUrl is required');
    }

    // 验证 URL 格式
    let url: URL;
    try {
      url = new URL(videoUrl.trim());
    } catch {
      throw new BadRequestException('Invalid video URL');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('Only HTTP/HTTPS URLs are supported');
    }

    this.logger.log(`[transfer-video] Downloading from: ${videoUrl.slice(0, 100)}...`);

    // 下载视频
    const response = await fetch(videoUrl, {
      headers: { 'User-Agent': 'Tanva-Server/1.0' },
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to download video: HTTP ${response.status}`
      );
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const contentLength = response.headers.get('content-length');

    if (contentLength && parseInt(contentLength, 10) > MAX_VIDEO_SIZE) {
      throw new BadRequestException(
        `Video too large: ${contentLength} bytes (max ${MAX_VIDEO_SIZE})`
      );
    }

    // 确定文件扩展名
    let ext = 'mp4';
    if (contentType.includes('webm')) ext = 'webm';
    else if (contentType.includes('quicktime') || contentType.includes('mov')) ext = 'mov';
    else if (contentType.includes('avi')) ext = 'avi';

    const key = `videos/transferred/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // 转换为 Buffer 并上传
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    this.logger.log(`[transfer-video] Downloaded ${buffer.length} bytes, uploading to OSS as ${key}`);

    const stream = Readable.from(buffer);
    const result = await this.oss.putStream(key, stream, {
      headers: { 'Content-Type': contentType },
    });

    this.logger.log(`[transfer-video] Upload complete: ${result.url}`);

    return { url: result.url, key: result.key };
  }
}
