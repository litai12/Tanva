import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { ReferralModule } from '../referral/referral.module';
import { MembershipModule } from '../membership/membership.module';

@Module({
  imports: [PrismaModule, CreditsModule, ReferralModule, MembershipModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
