import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { DirectorCaptureService } from './director-capture.service';

@Controller('director-capture')
@UseGuards(ApiKeyOrJwtGuard)
export class DirectorCaptureController {
  constructor(private readonly service: DirectorCaptureService) {}

  @Post('claim')
  claim(@Body() body: { captureId?: string }) {
    const captureId = String(body?.captureId ?? '').trim();
    if (!captureId) return { ok: false, code: 'bad_request' };
    return this.service.claim(captureId);
  }

  @Post('report')
  report(
    @Body()
    body: {
      captureId?: string;
      leaseToken?: string;
      status?: string;
      imageUrl?: string;
      error?: string;
    },
  ) {
    const captureId = String(body?.captureId ?? '').trim();
    const leaseToken = String(body?.leaseToken ?? '').trim();
    if (!captureId || !leaseToken) return { ok: false, code: 'bad_request' };
    const status = body?.status === 'succeeded' ? 'succeeded' : 'failed';
    const ok = this.service.report(captureId, leaseToken, status, body?.imageUrl, body?.error);
    return { ok };
  }
}
