import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const clampString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

@Controller('telemetry')
export class TelemetryController {
  @Post('frontend-error')
  @HttpCode(204)
  frontendError(@Body() body: unknown, @Req() req: FastifyRequest): void {
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

    const normalized = {
      kind: clampString(payload.kind, 64) ?? 'unknown',
      message: clampString(payload.message, 2000) ?? 'Unknown frontend error',
      stack: clampString(payload.stack, 8000),
      source: clampString(payload.source, 1024),
      appVersion: clampString(payload.appVersion, 128) ?? 'unknown',
      buildTime: clampString(payload.buildTime, 128),
      href: clampString(payload.href, 1024),
      userAgent:
        clampString(payload.userAgent, 512) ??
        clampString(req.headers['user-agent'], 512) ??
        'unknown',
      timestamp: clampString(payload.timestamp, 128),
      ip: req.ip,
      receivedAt: new Date().toISOString(),
    };

    // Keep telemetry in structured server logs for release-level debugging.
    console.error('[frontend-error]', JSON.stringify(normalized));
  }
}
