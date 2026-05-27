import { Module, forwardRef } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { ReferralModule } from '../referral/referral.module';
import { MembershipModule } from '../membership/membership.module';
import { BusinessPolicyModule } from '../business-policy/business-policy.module';
import { TeamCollabModule } from '../team-collab/team-collab.module';

@Module({
  imports: [
    PrismaModule,
    CreditsModule,
    ReferralModule,
    forwardRef(() => MembershipModule),
    BusinessPolicyModule,
    TeamCollabModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
