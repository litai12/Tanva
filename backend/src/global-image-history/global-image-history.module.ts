import { Module } from '@nestjs/common';
import { GlobalImageHistoryController } from './global-image-history.controller';
import { GlobalImageHistoryService } from './global-image-history.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GlobalImageHistoryController],
  providers: [GlobalImageHistoryService],
  exports: [GlobalImageHistoryService],
})
export class GlobalImageHistoryModule {}
