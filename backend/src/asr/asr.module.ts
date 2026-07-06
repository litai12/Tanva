import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AsrRealtimeGateway } from './asr-realtime.gateway';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') || 'dev-access-secret',
      }),
    }),
  ],
  providers: [AsrRealtimeGateway],
  exports: [AsrRealtimeGateway],
})
export class AsrModule {}
