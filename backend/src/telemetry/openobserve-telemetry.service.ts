import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getActiveSpanContext } from './tracing';
import { getRequestContext } from './request-context';
import { buildOpenObserveIngestEndpoint } from './openobserve-url';

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
  traceId: string | null;
  method: string;
  path: string;
  route: string | null;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  userId: string | null;
  requestId: string | null;
  headers: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  body: unknown;
  receivedAt: string;
};

type BackendEventLog = {
  traceId: string | null;
  requestId?: string | null;
  userId?: string | null;
  category: string;
  action: string;
  message: string;
  payload?: Record<string, unknown> | null;
  receivedAt: string;
};

type BackendErrorLog = {
  traceId: string | null;
  requestId?: string | null;
  userId?: string | null;
  message: string;
  stack: string | null;
  errorName?: string | null;
  category?: string | null;
  statusCode?: number | null;
  method?: string | null;
  path?: string | null;
  route?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  headers?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
  body?: unknown;
  response?: unknown;
  payload?: Record<string, unknown> | null;
  upstream?: Record<string, unknown> | null;
  upstreamPayload?: unknown;
  upstreamResponse?: unknown;
  upstreamUrl?: string | null;
  upstreamHost?: string | null;
  upstreamPathname?: string | null;
  upstreamStatusCode?: number | null;
  upstreamError?: string | null;
  receivedAt: string;
};

type GenerationTaskLog = {
  traceId: string | null;
  parentRequestId?: string | null;
  requestId?: string | null;
  taskId: string;
  taskType: string;
  stage: 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  userId: string | null;
  provider: string | null;
  prompt: string | null;
  status: string;
  durationMs?: number | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  receivedAt: string;
};

type UpstreamRequestLog = {
  traceId: string | null;
  spanId?: string | null;
  method: string;
  url: string;
  type?: 'text' | 'video' | 'picture' | 'audio' | 'file' | 'binary' | 'other';
  origin?: string | null;
  originHost?: string | null;
  host: string | null;
  pathname: string | null;
  statusCode: number | null;
  durationMs: number | null;
  requestHeaders?: Record<string, unknown> | null;
  requestBody?: unknown;
  responseHeaders?: Record<string, unknown> | null;
  responseBody?: unknown;
  error?: string | null;
  serviceName?: string | null;
  receivedAt: string;
};

const isEnabled = (value: unknown, defaultValue: boolean): boolean => {
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
};

const toSnakeCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

const normalizeKeysForOpenObserve = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKeysForOpenObserve(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      toSnakeCase(key),
      normalizeKeysForOpenObserve(nestedValue),
    ]),
  );
};

const DEFAULT_BACKEND_REQUEST_BODY_MAX_LENGTH = 4096;

const truncateStringValue = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  const omittedLength = value.length - maxLength;
  return `${value.slice(0, maxLength)}...[truncated ${omittedLength} chars]`;
};

const summarizeBodyForLog = (body: unknown, maxLength: number): unknown => {
  if (body == null) {
    return body;
  }

  if (typeof body === 'string') {
    return truncateStringValue(body, maxLength);
  }

  try {
    const serialized = JSON.stringify(body);
    if (typeof serialized !== 'string') {
      return body;
    }

    if (serialized.length <= maxLength) {
      return body;
    }

    return {
      truncated: true,
      originalType: Array.isArray(body) ? 'array' : typeof body,
      originalLength: serialized.length,
      preview: truncateStringValue(serialized, maxLength),
    };
  } catch {
    return {
      truncated: true,
      originalType: Array.isArray(body) ? 'array' : typeof body,
      preview: '[unserializable body]',
    };
  }
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
    const maxBodyLength = this.getBackendRequestBodyMaxLength();
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_BACKEND_REQUEST_STREAM')?.trim() || 'backend_requests',
      {
        ...log,
        body: summarizeBodyForLog(log.body, maxBodyLength),
        service: 'backend',
        log_type: 'backend_request',
      },
    );
  }

  async ingestBackendEvent(log: BackendEventLog): Promise<void> {
    const requestContext = getRequestContext();
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_BACKEND_EVENT_STREAM')?.trim() || 'backend_events',
      {
        ...log,
        traceId: log.traceId || getActiveSpanContext()?.traceId || requestContext?.traceId || null,
        requestId: log.requestId || requestContext?.requestId || null,
        userId: log.userId || requestContext?.userId || null,
        service: 'backend',
        log_type: 'backend_event',
      },
    );
  }

  async ingestBackendError(log: BackendErrorLog): Promise<void> {
    const requestContext = getRequestContext();
    const maxBodyLength = this.getBackendRequestBodyMaxLength();
    const upstream = log.upstream || requestContext?.latestUpstreamRequest || null;
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_BACKEND_ERROR_STREAM')?.trim() || 'backend_errors',
      {
        ...log,
        traceId: log.traceId || getActiveSpanContext()?.traceId || requestContext?.traceId || null,
        requestId: log.requestId || requestContext?.requestId || null,
        userId: log.userId || requestContext?.userId || null,
        body: summarizeBodyForLog(log.body, maxBodyLength),
        response: summarizeBodyForLog(log.response, maxBodyLength),
        upstream: summarizeBodyForLog(upstream, maxBodyLength),
        upstreamUrl: log.upstreamUrl ?? upstream?.url ?? null,
        upstreamHost: log.upstreamHost ?? upstream?.host ?? null,
        upstreamPathname: log.upstreamPathname ?? upstream?.pathname ?? null,
        upstreamStatusCode: log.upstreamStatusCode ?? upstream?.statusCode ?? null,
        upstreamError: log.upstreamError ?? upstream?.error ?? null,
        upstreamPayload: summarizeBodyForLog(
          log.upstreamPayload ?? upstream?.requestBody ?? null,
          maxBodyLength,
        ),
        upstreamResponse: summarizeBodyForLog(
          log.upstreamResponse ?? upstream?.responseBody ?? null,
          maxBodyLength,
        ),
        service: 'backend',
        log_type: 'backend_error',
      },
    );
  }

  async ingestGenerationTask(log: GenerationTaskLog): Promise<void> {
    const isError = log.stage === 'failed' || log.status === 'failed' || Boolean(log.error);
    const requestContext = getRequestContext();
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_GENERATION_TASK_STREAM')?.trim() || 'generation_tasks',
      {
        ...log,
        requestId: log.requestId || requestContext?.requestId || null,
        userId: log.userId || requestContext?.userId || null,
        isError,
        failureStage: isError ? log.stage : null,
        failureReason: isError ? log.error || log.status : null,
        service: 'backend',
        log_type: 'generation_task',
      },
    );
  }

  async ingestUpstreamRequest(log: UpstreamRequestLog): Promise<void> {
    const isError = Boolean(log.error) || (typeof log.statusCode === 'number' && log.statusCode >= 400);
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_UPSTREAM_REQUEST_STREAM')?.trim() || 'upstream_requests',
      {
        ...log,
        isError,
        failureStage: isError ? 'upstream_request' : null,
        failureReason: log.error || (isError ? `HTTP_${log.statusCode}` : null),
        service: 'backend',
        log_type: 'upstream_request',
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

    const endpoint = buildOpenObserveIngestEndpoint(baseUrl, org, stream);
    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    try {
      const activeSpanContext = getActiveSpanContext();
      const normalizedPayload = normalizeKeysForOpenObserve({
        ...payload,
        traceId:
          (typeof payload.traceId === 'string' && payload.traceId.trim()) ||
          activeSpanContext?.traceId ||
          null,
        spanId:
          (typeof payload.spanId === 'string' && payload.spanId.trim()) ||
          activeSpanContext?.spanId ||
          null,
      });
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify([
          normalizedPayload,
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
    return isEnabled(this.configService.get('OPENOBSERVE_TELEMETRY_ENABLED'), false);
  }

  private getBackendRequestBodyMaxLength(): number {
    const raw = Number(this.configService.get('OPENOBSERVE_BACKEND_REQUEST_BODY_MAX_LENGTH'));
    if (!Number.isFinite(raw) || raw <= 0) {
      return DEFAULT_BACKEND_REQUEST_BODY_MAX_LENGTH;
    }
    return Math.floor(raw);
  }
}
