import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { OpenObserveTelemetryService } from './openobserve-telemetry.service';

@Controller('telemetry')
export class TelemetryController {
  constructor(
    private readonly openObserveTelemetryService: OpenObserveTelemetryService,
  ) {}

  @Post('frontend-error')
  @HttpCode(204)
  frontendError(@Body() body: unknown, @Req() req: FastifyRequest): void {
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const stringifyIfNeeded = (value: unknown): string | null => {
      if (value == null) return null;
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    const normalized = {
      kind: stringifyIfNeeded(payload.kind) ?? 'unknown',
      message: stringifyIfNeeded(payload.message) ?? 'Unknown frontend error',
      stack: stringifyIfNeeded(payload.stack),
      source: stringifyIfNeeded(payload.source),
      appVersion: stringifyIfNeeded(payload.appVersion) ?? 'unknown',
      buildTime: stringifyIfNeeded(payload.buildTime),
      href: stringifyIfNeeded(payload.href),
      userAgent:
        stringifyIfNeeded(payload.userAgent) ??
        stringifyIfNeeded(req.headers['user-agent']) ??
        'unknown',
      timestamp: stringifyIfNeeded(payload.timestamp),
      ip: req.ip,
      receivedAt: new Date().toISOString(),
    };

    // Keep telemetry in structured server logs for release-level debugging.
    console.error('[frontend-error]', JSON.stringify(normalized));
    void this.openObserveTelemetryService.ingestFrontendError(normalized);
  }
}
