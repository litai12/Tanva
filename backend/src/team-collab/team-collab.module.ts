import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CanvasSseManager } from './canvas-sse.manager';
import { TeamCollabController } from './team-collab.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TeamCollabController],
  providers: [CanvasSseManager],
  exports: [CanvasSseManager],
})
export class TeamCollabModule {}
