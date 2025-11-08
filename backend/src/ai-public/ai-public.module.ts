import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiPublicController } from './ai-public.controller';
import { AiPublicService } from './ai-public.service';

/**
 * 公开 AI API 模块
 * 提供无需认证的 AI 功能接口供外部调用
 */
@Module({
  imports: [AiModule],
  controllers: [AiPublicController],
  providers: [AiPublicService],
})
export class AiPublicModule {}
