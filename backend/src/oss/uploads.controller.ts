import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags, ApiConsumes } from '@nestjs/swagger';
import { OssService } from './oss.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Readable } from 'stream';
import type { FastifyRequest } from 'fastify';

const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
  'video/x-flv',
];

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_IMAGE_SIZE = 32 * 1024 * 1024; // 32MB
const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB（与前端 AudioNode 一致）
const MAX_DOCUMENT_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_MODEL_SIZE = 50 * 1024 * 1024; // 50MB
const SUPPORTED_DOCUMENT_TYPES = ['application/pdf'];
const SUPPORTED_MODEL_TYPES = [
  'model/gltf-binary',
  'model/gltf+json',
  'application/octet-stream',
  'application/json',
];
const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/x-flac',
  'audio/webm',
  'audio/amr',
  'audio/aiff',
  'audio/x-aiff',
  'audio/x-ms-wma',
];
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

function inferAudioExtFromMime(mimeType?: string): string {
  const value = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (value === 'audio/mpeg' || value === 'audio/mp3') return 'mp3';
  if (value === 'audio/wav' || value === 'audio/x-wav' || value === 'audio/wave') return 'wav';
  if (value === 'audio/aac') return 'aac';
  if (value === 'audio/mp4' || value === 'audio/x-m4a') return 'm4a';
  if (value === 'audio/ogg') return 'ogg';
  if (value === 'audio/opus') return 'opus';
  if (value === 'audio/flac' || value === 'audio/x-flac') return 'flac';
  if (value === 'audio/webm') return 'weba';
  if (value === 'audio/amr') return 'amr';
  if (value === 'audio/aiff' || value === 'audio/x-aiff') return 'aiff';
  if (value === 'audio/x-ms-wma') return 'wma';
  return 'mp3';
}

function inferDocumentExtFromMime(mimeType?: string): string {
  const value = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (value === 'application/pdf') return 'pdf';
  return 'bin';
}

function inferModelExtFromMime(mimeType?: string): string {
  const value = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (value === 'model/gltf-binary') return 'glb';
  if (value === 'model/gltf+json' || value === 'application/json') return 'gltf';
  return 'glb';
}

function inferModelMimeFromFileName(fileName?: string, fallbackMimeType?: string): string {
  const lower = typeof fileName === 'string' ? fileName.trim().toLowerCase() : '';
  if (lower.endsWith('.glb')) return 'model/gltf-binary';
  if (lower.endsWith('.gltf')) return 'model/gltf+json';
  return fallbackMimeType || 'model/gltf-binary';
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

  private uploadDiagnosticsForLog(): string {
    try {
      return JSON.stringify(this.oss.diagnostics());
    } catch {
      return '{}';
    }
  }

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

    try {
      const stream = Readable.from(file.buffer);
      const result = await this.oss.putStream(key, stream, {
        headers: {
          'Content-Type': mimeType || 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
      return { url: result.url, key: result.key };
    } catch (error) {
      this.logger.error(
        `Image upload failed: ${error instanceof Error ? error.message : String(error)}; oss=${this.uploadDiagnosticsForLog()}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Image upload failed; please check OSS/TOS configuration');
    }
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

    try {
      const stream = Readable.from(file.buffer);
      const result = await this.oss.putStream(key, stream, {
        headers: { 'Content-Type': file.mimeType },
      });
      return { url: result.url, key: result.key };
    } catch (error) {
      this.logger.error(
        `Video upload failed: ${error instanceof Error ? error.message : String(error)}; oss=${this.uploadDiagnosticsForLog()}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Video upload failed; please check OSS/TOS configuration');
    }
  }

  @Post('audio')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  async uploadAudio(@Req() req: FastifyRequest) {
    // 音频走后端中转上传，由服务端写入 OSS。
    // 浏览器不直连 TOS 桶，从根本上绕开「直传 POST 无 CORS → Failed to fetch」。
    const file = await this.readSingleMultipartFile(req, MAX_AUDIO_SIZE);
    const form = file.fields;

    const mimeType = String(file.mimeType || '').toLowerCase();
    if (!SUPPORTED_AUDIO_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `Unsupported audio format: ${file.mimeType}. Supported: ${SUPPORTED_AUDIO_TYPES.join(', ')}`
      );
    }

    const dir = normalizeUploadDir(extractMultipartField(form, 'dir'), 'uploads/audios/');
    const explicitKey = (extractMultipartField(form, 'key') || '').trim().replace(/^\/+/, '');
    const declaredFileName = extractMultipartField(form, 'fileName');
    const safeFileName = sanitizeFileName(
      declaredFileName || file.originalName || `audio.${inferAudioExtFromMime(mimeType)}`
    );
    const key = (() => {
      if (explicitKey) return explicitKey;
      const ext = safeFileName.includes('.')
        ? safeFileName.split('.').pop() || inferAudioExtFromMime(mimeType)
        : inferAudioExtFromMime(mimeType);
      return `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFileName.replace(/\.[^.]+$/, '')}.${ext}`;
    })();

    try {
      const stream = Readable.from(file.buffer);
      const result = await this.oss.putStream(key, stream, {
        headers: { 'Content-Type': mimeType || 'audio/mpeg' },
      });
      return { url: result.url, key: result.key };
    } catch (error) {
      this.logger.error(
        `Audio upload failed: ${error instanceof Error ? error.message : String(error)}; oss=${this.uploadDiagnosticsForLog()}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Audio upload failed; please check OSS/TOS configuration');
    }
  }

  @Post('document')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  async uploadDocument(@Req() req: FastifyRequest) {
    const file = await this.readSingleMultipartFile(req, MAX_DOCUMENT_SIZE);
    const form = file.fields;

    const mimeType = String(file.mimeType || '').toLowerCase();
    if (!SUPPORTED_DOCUMENT_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `Unsupported document format: ${file.mimeType}. Supported: ${SUPPORTED_DOCUMENT_TYPES.join(', ')}`
      );
    }

    const dir = normalizeUploadDir(extractMultipartField(form, 'dir'), 'uploads/documents/');
    const explicitKey = (extractMultipartField(form, 'key') || '').trim().replace(/^\/+/, '');
    const declaredFileName = extractMultipartField(form, 'fileName');
    const safeFileName = sanitizeFileName(
      declaredFileName || file.originalName || `document.${inferDocumentExtFromMime(mimeType)}`
    );
    const key = (() => {
      if (explicitKey) return explicitKey;
      const ext = safeFileName.includes('.')
        ? safeFileName.split('.').pop() || inferDocumentExtFromMime(mimeType)
        : inferDocumentExtFromMime(mimeType);
      return `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFileName.replace(/\.[^.]+$/, '')}.${ext}`;
    })();

    try {
      const stream = Readable.from(file.buffer);
      const result = await this.oss.putStream(key, stream, {
        headers: {
          'Content-Type': mimeType || 'application/pdf',
          'Cache-Control': 'private, max-age=31536000',
        },
      });
      return { url: result.url, key: result.key };
    } catch (error) {
      this.logger.error(
        `Document upload failed: ${error instanceof Error ? error.message : String(error)}; oss=${this.uploadDiagnosticsForLog()}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Document upload failed; please check OSS/TOS configuration');
    }
  }

  @Post('model')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  async uploadModel(@Req() req: FastifyRequest) {
    const file = await this.readSingleMultipartFile(req, MAX_MODEL_SIZE);
    const form = file.fields;

    const declaredFileName = extractMultipartField(form, 'fileName');
    const safeFileName = sanitizeFileName(
      declaredFileName || file.originalName || `model.${inferModelExtFromMime(file.mimeType)}`
    );
    const lowerName = safeFileName.toLowerCase();
    if (!lowerName.endsWith('.glb') && !lowerName.endsWith('.gltf')) {
      throw new BadRequestException('Unsupported 3D model format. Supported: .glb, .gltf');
    }

    const mimeType = inferModelMimeFromFileName(safeFileName, String(file.mimeType || '').toLowerCase());
    if (!SUPPORTED_MODEL_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `Unsupported 3D model content type: ${file.mimeType}. Supported: ${SUPPORTED_MODEL_TYPES.join(', ')}`
      );
    }

    const dir = normalizeUploadDir(extractMultipartField(form, 'dir'), 'uploads/models/');
    const explicitKey = (extractMultipartField(form, 'key') || '').trim().replace(/^\/+/, '');
    const key = (() => {
      if (explicitKey) return explicitKey;
      const ext = lowerName.endsWith('.gltf') ? 'gltf' : 'glb';
      return `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFileName.replace(/\.[^.]+$/, '')}.${ext}`;
    })();

    try {
      const stream = Readable.from(file.buffer);
      const result = await this.oss.putStream(key, stream, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
      return { url: result.url, key: result.key };
    } catch (error) {
      this.logger.error(
        `3D model upload failed: ${error instanceof Error ? error.message : String(error)}; oss=${this.uploadDiagnosticsForLog()}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('3D model upload failed; please check OSS/TOS configuration');
    }
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
