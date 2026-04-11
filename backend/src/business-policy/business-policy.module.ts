import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BusinessPolicyService } from './business-policy.service';

@Module({
  imports: [PrismaModule],
  providers: [BusinessPolicyService],
  exports: [BusinessPolicyService],
})
export class BusinessPolicyModule {}
