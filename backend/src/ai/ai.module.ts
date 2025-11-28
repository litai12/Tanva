import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { ImageGenerationService } from './image-generation.service';
import { BackgroundRemovalService } from './services/background-removal.service';
import { AiController } from './ai.controller';
import { GeminiProProvider } from './providers/gemini-pro.provider';
import { BananaProvider } from './providers/banana.provider';
import { RunningHubProvider } from './providers/runninghub.provider';
import { MidjourneyProvider } from './providers/midjourney.provider';
import { AIProviderFactory } from './ai-provider.factory';
import { CostCalculatorService } from './services/cost-calculator.service';
import { Convert2Dto3DService } from './services/convert-2d-to-3d.service';
import { ExpandImageService } from './services/expand-image.service';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [ConfigModule, UsersModule],
  providers: [
    AiService,
    ImageGenerationService,
    BackgroundRemovalService,
    GeminiProProvider,
    BananaProvider,
    RunningHubProvider,
    MidjourneyProvider,
    AIProviderFactory,
    CostCalculatorService, // 添加成本计算器
    Convert2Dto3DService, // 添加2D转3D服务
    ExpandImageService, // 添加扩图服务
    ApiKeyOrJwtGuard,
  ],
  controllers: [AiController],
  exports: [AIProviderFactory, CostCalculatorService, BackgroundRemovalService], // 导出工厂和成本计算器供其他模块使用
})
export class AiModule {}
