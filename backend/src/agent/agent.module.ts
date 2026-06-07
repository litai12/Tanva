import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { AgentController } from './agent.controller';
import { AgentRuntimeService } from './agent-runtime.service';

@Module({
  imports: [ConfigModule],
  providers: [AgentRuntimeService, ApiKeyOrJwtGuard],
  controllers: [AgentController],
  exports: [AgentRuntimeService],
})
export class AgentModule {}
