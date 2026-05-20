import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCoreController } from './team-core.controller';
import { TeamCoreService } from './team-core.service';
import { TeamInviteService } from './team-invite.service';

@Module({
  imports: [PrismaModule],
  controllers: [TeamCoreController],
  providers: [TeamCoreService, TeamInviteService],
  exports: [TeamCoreService],
})
export class TeamCoreModule {}
