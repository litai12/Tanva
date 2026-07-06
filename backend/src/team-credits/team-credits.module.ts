import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCoreModule } from '../team-core/team-core.module';
import { PaymentModule } from '../payment/payment.module';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { CreditsModule } from '../credits/credits.module';
import { TeamCreditsController } from './team-credits.controller';
import { TeamCreditsService } from './team-credits.service';
import { TeamCreditLedgerService } from './team-credit-ledger.service';
import { CreditChargeService } from './credit-charge.service';
import { TeamSeatPackageService } from './team-seat-package.service';
import { TeamCreditsTopupService } from './team-credits-topup.service';

@Module({
  imports: [PrismaModule, TeamCoreModule, PaymentModule, TeamCollabModule, CreditsModule],
  controllers: [TeamCreditsController],
  providers: [
    TeamCreditsService,
    TeamCreditLedgerService,
    CreditChargeService,
    TeamSeatPackageService,
    TeamCreditsTopupService,
  ],
  exports: [TeamCreditsService, TeamCreditLedgerService, CreditChargeService],
})
export class TeamCreditsModule {}
