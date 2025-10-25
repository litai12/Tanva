import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { ImageGenerationService } from './image-generation.service';
import { AiController } from './ai.controller';
import { GeminiProvider } from './providers/gemini.provider';
import { BananaProvider } from './providers/banana.provider';
import { AIProviderFactory } from './ai-provider.factory';
import { CostCalculatorService } from './services/cost-calculator.service';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';

@Module({
  imports: [ConfigModule],
  providers: [
    AiService,
    ImageGenerationService,
    GeminiProvider,
    BananaProvider,
    AIProviderFactory,
    CostCalculatorService, // 添加成本计算器
    ApiKeyOrJwtGuard,
  ],
  controllers: [AiController],
  exports: [AIProviderFactory, CostCalculatorService], // 导出工厂和成本计算器供其他模块使用
})
export class AiModule {}
