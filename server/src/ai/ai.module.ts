import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { ImageGenerationService } from './image-generation.service';
import { AiController } from './ai.controller';

@Module({
  imports: [ConfigModule],
  providers: [AiService, ImageGenerationService],
  controllers: [AiController],
})
export class AiModule {}

