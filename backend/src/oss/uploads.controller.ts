import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
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
  constructor(private readonly oss: OssService) {}

  @Post('presign')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  presign(@Body() body: { dir?: string; maxSize?: number }) {
    const dir = body?.dir ?? 'uploads/';
    const max = body?.maxSize ?? 10 * 1024 * 1024;
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
}
