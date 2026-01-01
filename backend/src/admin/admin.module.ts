import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { OssModule } from '../oss/oss.module';
import { TemplateService } from './services/template.service';

@Module({
  imports: [PrismaModule, CreditsModule, OssModule],
  controllers: [AdminController],
  providers: [AdminService, TemplateService],
  exports: [AdminService, TemplateService],
})
export class AdminModule {}
