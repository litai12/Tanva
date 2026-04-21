// backend/src/volc-asset/volc-asset.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { VolcAssetController } from './volc-asset.controller';
import { VolcAssetService } from './volc-asset.service';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [VolcAssetService],
  controllers: [VolcAssetController],
  exports: [VolcAssetService],
})
export class VolcAssetModule {}
