import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCoreModule } from '../team-core/team-core.module';
import { PaymentModule } from '../payment/payment.module';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { TeamCreditsController } from './team-credits.controller';
import { TeamCreditsService } from './team-credits.service';
import { TeamCreditLedgerService } from './team-credit-ledger.service';
import { TeamSeatPackageService } from './team-seat-package.service';

@Module({
  imports: [PrismaModule, TeamCoreModule, PaymentModule, TeamCollabModule],
  controllers: [TeamCreditsController],
  providers: [
    TeamCreditsService,
    TeamCreditLedgerService,
    TeamSeatPackageService,
  ],
  exports: [TeamCreditsService, TeamCreditLedgerService],
})
export class TeamCreditsModule {}
