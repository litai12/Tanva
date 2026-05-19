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
import { Nano2Provider } from './providers/nano2.provider';
import { Seedream5Provider } from './providers/seedream5.provider';
import { NewApiProvider } from './providers/new-api.provider';
import { AIProviderFactory } from './ai-provider.factory';
import { CostCalculatorService } from './services/cost-calculator.service';
import { Convert2Dto3DService } from './services/convert-2d-to-3d.service';
import { Seed3DService } from './services/seed3d.service';
import { ExpandImageService } from './services/expand-image.service';
import { Sora2VideoService } from './services/sora2-video.service';
import { VeoVideoService } from './services/veo-video.service';
import { VideoProviderService } from './services/video-provider.service';
import { ImageTaskService } from './services/image-task.service';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { UsersModule } from '../users/users.module';
import { CreditsModule } from '../credits/credits.module';
import { OssModule } from '../oss/oss.module';
import { VideoWatermarkService } from './services/video-watermark.service';
import { PrismaModule } from '../prisma/prisma.module';
import { Nano2Service } from './services/nano2.service';
import { Seedream5Service } from './services/seedream5.service';
import { MinimaxSpeechService } from './services/minimax-speech.service';
import { MinimaxMusicService } from './services/minimax-music.service';
import { TencentSpeechService } from './services/tencent-speech.service';
import { TencentVodAigcService } from './services/tencent-vod-aigc.service';
import { ModelRoutingService } from './services/model-routing.service';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    CreditsModule,
    OssModule,
    PrismaModule,
    TelemetryModule,
  ],
  providers: [
    AiService,
    ImageGenerationService,
    BackgroundRemovalService,
    GeminiProProvider,
    BananaProvider,
    RunningHubProvider,
    MidjourneyProvider,
    Nano2Provider,
    Seedream5Provider,
    NewApiProvider,
    AIProviderFactory,
    CostCalculatorService,
    Convert2Dto3DService,
    Seed3DService,
    ExpandImageService,
    Sora2VideoService,
    VeoVideoService,
    VideoProviderService,
    VideoWatermarkService,
    Nano2Service,
    Seedream5Service,
    MinimaxSpeechService,
    MinimaxMusicService,
    TencentSpeechService,
    TencentVodAigcService,
    ModelRoutingService,
    ImageTaskService,
    ApiKeyOrJwtGuard,
  ],
  controllers: [AiController],
  exports: [AIProviderFactory, CostCalculatorService, BackgroundRemovalService, VeoVideoService],
})
export class AiModule {}
