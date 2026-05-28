import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import crypto from 'crypto';
import { OpenObserveTelemetryService } from './openobserve-telemetry.service';
import { getActiveSpanContext } from './tracing';
import { enterRequestContext } from './request-context';

type AuthLikeUser = {
  id?: string;
  userId?: string;
  sub?: string;
};

type TraceableRequest = FastifyRequest & {
  user?: AuthLikeUser;
  traceId?: string;
  routerPath?: string;
};

const isEnabled = (value: unknown, defaultValue: boolean): boolean => {
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
};

const shouldLogHeavyPayloadRequests = (): boolean =>
  isEnabled(process.env.OPENOBSERVE_LOG_HEAVY_PAYLOAD_REQUESTS, false);

const isHeavyPayloadPath = (path: string): boolean =>
  /^\/api\/projects\/[^/]+\/content(?:[/?#]|$)/.test(path) ||
  /^\/api\/uploads\/(?:image|video|transfer-video)(?:[/?#]|$)/.test(path);

const shouldEmitRequestTelemetry = (path: string, statusCode: number): boolean => {
  if (path.startsWith('/api/telemetry/')) return false;
  if (statusCode >= 400) return true;
  if (isHeavyPayloadPath(path) && !shouldLogHeavyPayloadRequests()) return false;
  return true;
};

const shouldCaptureRequestBody = (path: string): boolean =>
  !isHeavyPayloadPath(path);

const toOriginInfo = (
  value: unknown,
): { origin: string | null; originHost: string | null } => {
  if (typeof value !== 'string') {
    return { origin: null, originHost: null };
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') {
    return { origin: null, originHost: null };
  }

  try {
    const parsed = new URL(trimmed);
    return {
      origin: parsed.origin,
      originHost: parsed.hostname || null,
    };
  } catch {
    return { origin: null, originHost: null };
  }
};

@Injectable()
export class OpenObserveRequestInterceptor implements NestInterceptor {
  constructor(
    private readonly openObserveTelemetryService: OpenObserveTelemetryService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<TraceableRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const startTime = Date.now();
    const path = request.url || request.routerPath || '';
    const activeSpanContext = getActiveSpanContext();
    const headerTraceId = typeof request.headers['x-trace-id'] === 'string'
      ? request.headers['x-trace-id'].trim()
      : '';
    const traceId =
      activeSpanContext?.traceId ||
      headerTraceId ||
      request.traceId ||
      crypto.randomUUID().replace(/-/g, '');
    request.traceId = traceId;
    reply.header('x-trace-id', traceId);
    const originHeader = toOriginInfo(request.headers.origin);
    const refererHeader = toOriginInfo(request.headers.referer || request.headers.referrer);
    const requestOrigin = originHeader.origin || refererHeader.origin;
    const requestOriginHost = originHeader.originHost || refererHeader.originHost;

    const emit = (statusCode: number) => {
      if (!shouldEmitRequestTelemetry(path, statusCode)) return;
      const user = request.user;
      const userId = user?.id || user?.userId || user?.sub || null;
      const captureBody = shouldCaptureRequestBody(path);
      void this.openObserveTelemetryService.ingestBackendRequest({
        traceId,
        method: request.method,
        path,
        route: request.routerPath || null,
        statusCode,
        durationMs: Date.now() - startTime,
        ip: request.ip || null,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
        userId,
        requestId: request.id || null,
        headers: request.headers ? (request.headers as unknown as Record<string, unknown>) : null,
        query: request.query && typeof request.query === 'object' ? (request.query as Record<string, unknown>) : null,
        body: captureBody
          ? request.body ?? null
          : { omitted: true, reason: 'heavy_payload_path' },
        receivedAt: new Date().toISOString(),
      });
    };

    const user = request.user;
    enterRequestContext({
      traceId,
      requestId: request.id || null,
      userId: user?.id || user?.userId || user?.sub || null,
      origin: requestOrigin,
      originHost: requestOriginHost,
    });

    return next.handle().pipe(
      tap(() => {
        emit(reply.statusCode || 200);
      }),
      catchError((error) => {
        const statusCode =
          typeof error?.status === 'number'
            ? error.status
            : typeof error?.statusCode === 'number'
              ? error.statusCode
              : reply.statusCode || 500;
        emit(statusCode);
        return throwError(() => error);
      }),
    );
  }
}
