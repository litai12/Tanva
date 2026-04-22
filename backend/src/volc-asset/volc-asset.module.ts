// backend/src/volc-asset/volc-asset.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VolcAssetController } from './volc-asset.controller';
import { VolcAssetService } from './volc-asset.service';
import { VolcAssetSchedulerService } from './volc-asset-scheduler.service';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule],
  providers: [VolcAssetService, VolcAssetSchedulerService],
  controllers: [VolcAssetController],
  exports: [VolcAssetService],
})
export class VolcAssetModule {}
