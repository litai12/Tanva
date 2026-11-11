import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentModule } from '../agent/agent.module';
import { VideoProductionModule } from '../video-production/video-production.module';
import { MobileChatController } from './mobile-chat.controller';
import { MobileChatService } from './mobile-chat.service';

@Module({
  imports: [ConfigModule, PrismaModule, AgentModule, VideoProductionModule],
  controllers: [MobileChatController],
  providers: [MobileChatService],
})
export class MobileChatModule {}
