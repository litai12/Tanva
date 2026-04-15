import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TelemetryController } from './telemetry.controller';
import { OpenObserveTelemetryService } from './openobserve-telemetry.service';
import { OpenObserveRequestInterceptor } from './openobserve-request.interceptor';
import { OpenObserveExceptionFilter } from './openobserve-exception.filter';

@Module({
  controllers: [TelemetryController],
  providers: [
    OpenObserveTelemetryService,
    {
      provide: APP_INTERCEPTOR,
      useClass: OpenObserveRequestInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: OpenObserveExceptionFilter,
    },
  ],
  exports: [OpenObserveTelemetryService],
})
export class TelemetryModule {}
