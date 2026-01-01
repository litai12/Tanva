import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [AdminModule],
  controllers: [TemplatesController],
})
export class TemplatesModule {}




