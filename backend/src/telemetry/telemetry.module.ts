import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TelemetryController } from './telemetry.controller';
import { OpenObserveTelemetryService } from './openobserve-telemetry.service';
import { OpenObserveRequestInterceptor } from './openobserve-request.interceptor';

@Module({
  controllers: [TelemetryController],
  providers: [
    OpenObserveTelemetryService,
    {
      provide: APP_INTERCEPTOR,
      useClass: OpenObserveRequestInterceptor,
    },
  ],
  exports: [OpenObserveTelemetryService],
})
export class TelemetryModule {}
