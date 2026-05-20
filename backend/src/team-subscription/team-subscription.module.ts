import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCoreModule } from '../team-core/team-core.module';
import { TeamCreditsModule } from '../team-credits/team-credits.module';
import { TeamSubscriptionController } from './team-subscription.controller';
import { TeamSubscriptionService } from './team-subscription.service';
import { TeamSubscriptionScheduler } from './team-subscription.scheduler';

@Module({
  imports: [PrismaModule, TeamCoreModule, TeamCreditsModule],
  controllers: [TeamSubscriptionController],
  providers: [TeamSubscriptionService, TeamSubscriptionScheduler],
  exports: [TeamSubscriptionService],
})
export class TeamSubscriptionModule {}
