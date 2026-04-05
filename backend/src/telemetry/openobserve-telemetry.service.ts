import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type FrontendErrorLog = {
  kind: string;
  message: string;
  stack: string | null;
  source: string | null;
  appVersion: string;
  buildTime: string | null;
  href: string | null;
  userAgent: string;
  timestamp: string | null;
  ip: string | null;
  receivedAt: string;
};

type BackendRequestLog = {
  method: string;
  path: string;
  route: string | null;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  userId: string | null;
  requestId: string | null;
  query: Record<string, unknown> | null;
  receivedAt: string;
};

const isEnabled = (value: unknown, defaultValue: boolean): boolean => {
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
};

@Injectable()
export class OpenObserveTelemetryService {
  private readonly logger = new Logger(OpenObserveTelemetryService.name);

  constructor(private readonly configService: ConfigService) {}

  async ingestFrontendError(log: FrontendErrorLog): Promise<void> {
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_FRONTEND_ERROR_STREAM')?.trim() || 'frontend_errors',
      {
        ...log,
        service: 'frontend',
        log_type: 'frontend_error',
      },
    );
  }

  async ingestBackendRequest(log: BackendRequestLog): Promise<void> {
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_BACKEND_REQUEST_STREAM')?.trim() || 'backend_requests',
      {
        ...log,
        service: 'backend',
        log_type: 'backend_request',
      },
    );
  }

  private async ingest(stream: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.shouldSend()) return;

    const baseUrl = this.configService.get<string>('OPENOBSERVE_BASE_URL')?.trim();
    const username = this.configService.get<string>('OPENOBSERVE_USERNAME')?.trim();
    const password = this.configService.get<string>('OPENOBSERVE_PASSWORD')?.trim();
    const org = this.configService.get<string>('OPENOBSERVE_ORG')?.trim() || 'default';

    if (!baseUrl || !username || !password) {
      return;
    }

    const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/${encodeURIComponent(org)}/${encodeURIComponent(stream)}/_json`;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify([
          payload,
        ]),
      });

      if (!response.ok) {
        this.logger.warn(`OpenObserve ingest failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this.logger.warn(
        `OpenObserve ingest skipped: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private shouldSend(): boolean {
    const nodeEnv = (this.configService.get<string>('NODE_ENV') || '').toLowerCase();
    const defaultEnabled = nodeEnv !== 'production';
    return isEnabled(this.configService.get('OPENOBSERVE_TELEMETRY_ENABLED'), defaultEnabled);
  }
}
