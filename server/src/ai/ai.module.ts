import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { ImageGenerationService } from './image-generation.service';
import { AiController } from './ai.controller';
import { GeminiProvider } from './providers/gemini.provider';
import { BananaProvider } from './providers/banana.provider';
import { KuaiProvider } from './providers/kuai.provider';
import { AIProviderFactory } from './ai-provider.factory';
import { CostCalculatorService } from './services/cost-calculator.service';

@Module({
  imports: [ConfigModule],
  providers: [
    AiService,
    ImageGenerationService,
    GeminiProvider,
    BananaProvider,
    KuaiProvider,
    AIProviderFactory,
    CostCalculatorService, // 添加成本计算器
  ],
  controllers: [AiController],
  exports: [AIProviderFactory, CostCalculatorService], // 导出工厂和成本计算器供其他模块使用
})
export class AiModule {}
