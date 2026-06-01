import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags, ApiConsumes } from '@nestjs/swagger';
import { OssService } from './oss.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Readable } from 'stream';
import type { FastifyRequest } from 'fastify';

const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
  'video/x-flv',
];

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_IMAGE_SIZE = 32 * 1024 * 1024; // 32MB
const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

function normalizeUploadDir(raw?: string, fallback = 'uploads/images/'): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return fallback;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function sanitizeFileName(raw?: string, fallback = 'image.png'): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const source = trimmed || fallback;
  return source.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function inferExtFromMime(mimeType?: string): string {
  const value = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
  if (value === 'image/png') return 'png';
  if (value === 'image/webp') return 'webp';
  if (value === 'image/gif') return 'gif';
  if (value === 'image/svg+xml') return 'svg';
  return 'png';
}

function inferVideoExtFromMime(mimeType?: string): string {
  const value = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (value === 'video/mp4') return 'mp4';
  if (value === 'video/webm') return 'webm';
  if (value === 'video/quicktime') return 'mov';
  if (value === 'video/x-msvideo') return 'avi';
  if (value === 'video/mpeg') return 'mpeg';
  if (value === 'video/3gpp') return '3gp';
  if (value === 'video/x-flv') return 'flv';
  return 'mp4';
}

function extractMultipartField(
  fields: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const raw = fields?.[key] as
    | string
    | { value?: unknown }
    | { fieldname?: string; value?: unknown }
    | undefined;
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && typeof raw.value === 'string') return raw.value;
  return undefined;
}

function isMultipartFileTooLargeError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === 'FST_REQ_FILE_TOO_LARGE' ||
    code === 'FST_FILES_LIMIT' ||
    code === 'LIMIT_FILE_SIZE'
  );
}

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(private readonly oss: OssService) {}

  private async readSingleMultipartFile(
    req: FastifyRequest,
    maxFileSize: number
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    fields: Record<string, unknown> | undefined;
  }> {
    const request = req as FastifyRequest & {
      file: (options?: unknown) => Promise<any>;
    };

    if (typeof request.file !== 'function') {
      throw new BadRequestException('Multipart parser is not available');
    }

    try {
      const part = await request.file({
        limits: { files: 1, fileSize: maxFileSize },
      });
      if (!part) {
        throw new BadRequestException('No file uploaded');
      }

      const buffer = await part.toBuffer();
      if (!buffer || buffer.length === 0) {
        throw new BadRequestException('Uploaded file is empty');
      }

      return {
        buffer,
        mimeType: String(part.mimetype || ''),
        originalName: String(part.filename || ''),
        fields: part.fields as Record<string, unknown> | undefined,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (isMultipartFileTooLargeError(error)) {
        throw new BadRequestException(`File too large (max ${maxFileSize} bytes)`);
      }
      throw error;
    }
  }

  @Post('presign')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  presign(@Body() body: { dir?: string; maxSize?: number }) {
    const dir = body?.dir ?? 'uploads/';
    const max = body?.maxSize ?? 32 * 1024 * 1024; // 增加默认最大文件大小到32MB，支持更大的模板JSON文件
    const data = this.oss.presignPost(dir, 300, max);
    return data;
  }

  @Post('image')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  async uploadImage(
    @Req() req: FastifyRequest
  ) {
    const file = await this.readSingleMultipartFile(req, MAX_IMAGE_SIZE);
    const form = file.fields;

    const mimeType = String(file.mimeType || '').toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
      throw new BadRequestException(`Unsupported image format: ${file.mimeType}`);
    }

    const dir = normalizeUploadDir(extractMultipartField(form, 'dir'), 'uploads/images/');
    const explicitKey = (extractMultipartField(form, 'key') || '').trim().replace(/^\/+/, '');
    const declaredFileName = extractMultipartField(form, 'fileName');
    const safeFileName = sanitizeFileName(
      declaredFileName || file.originalName || `image.${inferExtFromMime(mimeType)}`
    );
    const key = (() => {
      if (explicitKey) return explicitKey;
      const ext = safeFileName.includes('.') ? safeFileName.split('.').pop() || inferExtFromMime(mimeType) : inferExtFromMime(mimeType);
      return `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFileName.replace(/\.[^.]+$/, '')}.${ext}`;
    })();

    const stream = Readable.from(file.buffer);
    const result = await this.oss.putStream(key, stream, {
      headers: {
        'Content-Type': mimeType || 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
    return { url: result.url, key: result.key };
  }

  @Post('video')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  async uploadVideo(@Req() req: FastifyRequest) {
    const file = await this.readSingleMultipartFile(req, MAX_VIDEO_SIZE);
    const form = file.fields;

    if (!SUPPORTED_VIDEO_TYPES.includes(file.mimeType)) {
      throw new BadRequestException(
        `Unsupported video format: ${file.mimeType}. Supported: ${SUPPORTED_VIDEO_TYPES.join(', ')}`
      );
    }

    const dir = normalizeUploadDir(extractMultipartField(form, 'dir'), 'videos/');
    const explicitKey = (extractMultipartField(form, 'key') || '').trim().replace(/^\/+/, '');
    const declaredFileName = extractMultipartField(form, 'fileName');
    const safeFileName = sanitizeFileName(
      declaredFileName || file.originalName || `video.${inferVideoExtFromMime(file.mimeType)}`
    );
    const key = (() => {
      if (explicitKey) return explicitKey;
      const ext = safeFileName.includes('.')
        ? safeFileName.split('.').pop() || inferVideoExtFromMime(file.mimeType)
        : inferVideoExtFromMime(file.mimeType);
      return `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFileName.replace(/\.[^.]+$/, '')}.${ext}`;
    })();

    const stream = Readable.from(file.buffer);
    const result = await this.oss.putStream(key, stream, {
      headers: { 'Content-Type': file.mimeType },
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
