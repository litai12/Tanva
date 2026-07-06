import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { CanvasCommentsController } from './canvas-comments.controller';
import { CanvasCommentsService } from './canvas-comments.service';

@Module({
  imports: [PrismaModule, TeamCollabModule],
  controllers: [CanvasCommentsController],
  providers: [CanvasCommentsService],
})
export class CanvasCommentsModule {}
