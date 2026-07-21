import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from '../ai/ai.module';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { CreditsModule } from '../credits/credits.module';
import { OssModule } from '../oss/oss.module';
import { AgentController } from './agent.controller';
import { AgentRuntimeService } from './agent-runtime.service';
import { VolcResearchSearchService } from './volc-research-search.service';
import { XiaotAgentService } from './xiaot-agent.service';

@Module({
  imports: [ConfigModule, OssModule, AiModule, CreditsModule],
  providers: [
    AgentRuntimeService,
    VolcResearchSearchService,
    XiaotAgentService,
    ApiKeyOrJwtGuard,
  ],
  controllers: [AgentController],
  exports: [AgentRuntimeService],
})
export class AgentModule {}
