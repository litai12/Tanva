import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

@Controller('telemetry')
export class TelemetryController {
  @Post('frontend-error')
  @HttpCode(204)
  frontendError(@Body() body: unknown, @Req() req: FastifyRequest): void {
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const stringifyIfNeeded = (value: unknown, maxLength = 12000): string | null => {
      if (value == null) return null;
      let serialized: string;
      try {
        serialized = typeof value === 'string' ? value : JSON.stringify(value);
      } catch {
        serialized = String(value);
      }
      if (serialized.length <= maxLength) return serialized;
      return `${serialized.slice(0, maxLength)}...[truncated ${serialized.length - maxLength} chars]`;
    };
    const normalizeContext = (value: unknown): Record<string, unknown> | null => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      try {
        const serialized = JSON.stringify(value);
        if (serialized.length <= 12000) {
          return JSON.parse(serialized) as Record<string, unknown>;
        }
        return {
          truncated: true,
          originalLength: serialized.length,
          preview: serialized.slice(0, 12000),
        };
      } catch {
        return { unserializable: true };
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
      componentStack: stringifyIfNeeded(payload.componentStack),
      context: normalizeContext(payload.context),
      ip: req.ip,
      receivedAt: new Date().toISOString(),
    };

    // PM2 is the production source of truth for frontend runtime failures.
    console.error('[frontend-error]', JSON.stringify(normalized));
  }
}
