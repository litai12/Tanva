import { Module, forwardRef } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { CreditsController } from './credits.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [PrismaModule, forwardRef(() => ReferralModule)],
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
