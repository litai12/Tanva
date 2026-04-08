import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { BusinessPolicyModule } from '../business-policy/business-policy.module';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';
import { MembershipSchedulerService } from './membership-scheduler.service';

@Module({
  imports: [PrismaModule, forwardRef(() => PaymentModule), BusinessPolicyModule],
  controllers: [MembershipController],
  providers: [MembershipService, MembershipSchedulerService],
  exports: [MembershipService],
})
export class MembershipModule {}
