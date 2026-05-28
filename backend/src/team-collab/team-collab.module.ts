import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { CanvasSseManager } from './canvas-sse.manager';
import { TeamCollabController } from './team-collab.controller';
import { TeamRealtimeController } from './team-realtime.controller';
import { CollabEventBus } from './collab-event-bus.service';
import { CollabEventLog } from './collab-event-log.service';
import { NodeLockService } from './node-lock.service';
import { TeamCreditsPublisher } from './team-credits-publisher.service';
import { WsCollabGateway } from './ws-collab.gateway';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') || 'dev-access-secret',
      }),
    }),
  ],
  controllers: [TeamCollabController, TeamRealtimeController],
  providers: [
    CollabEventBus,
    CollabEventLog,
    NodeLockService,
    CanvasSseManager,
    TeamCreditsPublisher,
    WsCollabGateway,
  ],
  exports: [
    CanvasSseManager,
    CollabEventBus,
    CollabEventLog,
    NodeLockService,
    TeamCreditsPublisher,
    WsCollabGateway,
  ],
})
export class TeamCollabModule {}
