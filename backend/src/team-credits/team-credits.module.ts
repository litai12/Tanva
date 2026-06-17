import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCoreModule } from '../team-core/team-core.module';
import { PaymentModule } from '../payment/payment.module';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { TeamCreditsController } from './team-credits.controller';
import { TeamCreditsService } from './team-credits.service';
import { TeamCreditLedgerService } from './team-credit-ledger.service';
import { TeamSeatPackageService } from './team-seat-package.service';
import { TeamCreditsTopupService } from './team-credits-topup.service';

@Module({
  imports: [PrismaModule, TeamCoreModule, PaymentModule, TeamCollabModule],
  controllers: [TeamCreditsController],
  providers: [
    TeamCreditsService,
    TeamCreditLedgerService,
    TeamSeatPackageService,
    TeamCreditsTopupService,
  ],
  exports: [TeamCreditsService, TeamCreditLedgerService],
})
export class TeamCreditsModule {}
