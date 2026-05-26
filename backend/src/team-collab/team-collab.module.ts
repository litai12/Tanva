import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CanvasSseManager } from './canvas-sse.manager';
import { TeamCollabController } from './team-collab.controller';
import { CollabEventBus } from './collab-event-bus.service';
import { CollabEventLog } from './collab-event-log.service';
import { NodeLockService } from './node-lock.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [TeamCollabController],
  providers: [
    CollabEventBus,
    CollabEventLog,
    NodeLockService,
    CanvasSseManager,
  ],
  exports: [
    CanvasSseManager,
    CollabEventBus,
    CollabEventLog,
    NodeLockService,
  ],
})
export class TeamCollabModule {}
