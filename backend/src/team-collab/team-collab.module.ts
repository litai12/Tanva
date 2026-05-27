import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CanvasSseManager } from './canvas-sse.manager';
import { TeamCollabController } from './team-collab.controller';
import { TeamRealtimeController } from './team-realtime.controller';
import { CollabEventBus } from './collab-event-bus.service';
import { CollabEventLog } from './collab-event-log.service';
import { NodeLockService } from './node-lock.service';
import { TeamCreditsPublisher } from './team-credits-publisher.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [TeamCollabController, TeamRealtimeController],
  providers: [
    CollabEventBus,
    CollabEventLog,
    NodeLockService,
    CanvasSseManager,
    TeamCreditsPublisher,
  ],
  exports: [
    CanvasSseManager,
    CollabEventBus,
    CollabEventLog,
    NodeLockService,
    TeamCreditsPublisher,
  ],
})
export class TeamCollabModule {}
