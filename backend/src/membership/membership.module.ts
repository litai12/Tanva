import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipService } from './membership.service';
import { MembershipSchedulerService } from './membership-scheduler.service';

@Module({
  imports: [PrismaModule],
  providers: [MembershipService, MembershipSchedulerService],
  exports: [MembershipService],
})
export class MembershipModule {}
