import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { OssService } from './oss.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

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
}
