import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { OpenObserveTelemetryService } from './openobserve-telemetry.service';

type AuthLikeUser = {
  id?: string;
  userId?: string;
  sub?: string;
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

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthLikeUser }>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const startTime = Date.now();
    const path = request.url || request.routerPath || '';

    // Avoid recursive logging from the telemetry ingestion endpoint itself.
    if (path.startsWith('/api/telemetry/')) {
      return next.handle();
    }

    const emit = (statusCode: number) => {
      const user = request.user;
      const userId = user?.id || user?.userId || user?.sub || null;
      void this.openObserveTelemetryService.ingestBackendRequest({
        method: request.method,
        path,
        route: (request as FastifyRequest & { routerPath?: string }).routerPath || null,
        statusCode,
        durationMs: Date.now() - startTime,
        ip: request.ip || null,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
        userId,
        requestId: request.id || null,
        query: request.query && typeof request.query === 'object' ? (request.query as Record<string, unknown>) : null,
        receivedAt: new Date().toISOString(),
      });
    };

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
