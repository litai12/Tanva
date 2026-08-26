import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PromptLibraryController } from './prompt-library.controller';
import { PromptLibraryService } from './prompt-library.service';

@Module({
  imports: [PrismaModule],
  controllers: [PromptLibraryController],
  providers: [PromptLibraryService],
})
export class PromptLibraryModule {}
