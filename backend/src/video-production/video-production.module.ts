import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { OssModule } from '../oss/oss.module';
import { CreditsModule } from '../credits/credits.module';
import { TapcanvasPlansModule } from '../tapcanvas-plans/tapcanvas-plans.module';
import { VideoProductionController } from './video-production.controller';
import { VideoProductionService } from './video-production.service';

@Module({
  imports: [ConfigModule, PrismaModule, OssModule, CreditsModule, TapcanvasPlansModule],
  controllers: [VideoProductionController],
  providers: [VideoProductionService],
  exports: [VideoProductionService],
})
export class VideoProductionModule {}
