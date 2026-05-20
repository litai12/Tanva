import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCoreModule } from '../team-core/team-core.module';
import { TeamCreditsController } from './team-credits.controller';
import { TeamCreditsService } from './team-credits.service';
import { TeamCreditLedgerService } from './team-credit-ledger.service';

@Module({
  imports: [PrismaModule, TeamCoreModule],
  controllers: [TeamCreditsController],
  providers: [TeamCreditsService, TeamCreditLedgerService],
  exports: [TeamCreditsService, TeamCreditLedgerService],
})
export class TeamCreditsModule {}
