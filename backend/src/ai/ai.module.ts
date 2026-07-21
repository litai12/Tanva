import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { ImageGenerationService } from './image-generation.service';
import { BackgroundRemovalService } from './services/background-removal.service';
import { AiController } from './ai.controller';
import { InternalTencentVodController } from './internal-tencent-vod.controller';
import { GeminiProProvider } from './providers/gemini-pro.provider';
import { RunningHubProvider } from './providers/runninghub.provider';
import { MidjourneyProvider } from './providers/midjourney.provider';
import { Seedream5Provider } from './providers/seedream5.provider';
import { NewApiProvider } from './providers/new-api.provider';
import { AIProviderFactory } from './ai-provider.factory';
import { CostCalculatorService } from './services/cost-calculator.service';
import { Convert2Dto3DService } from './services/convert-2d-to-3d.service';
import { Seed3DService } from './services/seed3d.service';
import { ExpandImageService } from './services/expand-image.service';
import { Sora2VideoService } from './services/sora2-video.service';
import { VeoVideoService } from './services/veo-video.service';
import { SeedAudioVoiceService } from './services/seed-audio-voice.service';
import { VideoProviderService } from './services/video-provider.service';
import { ImageTaskService } from './services/image-task.service';
import { ImageTaskQueueService } from './services/image-task-queue.service';
import { ImageTaskWorkerService } from './services/image-task-worker.service';
import { GenerationTaskService } from './services/generation-task.service';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { UsersModule } from '../users/users.module';
import { CreditsModule } from '../credits/credits.module';
import { OssModule } from '../oss/oss.module';
import { VideoWatermarkService } from './services/video-watermark.service';
import { PrismaModule } from '../prisma/prisma.module';
import { Seedream5Service } from './services/seedream5.service';
import { MinimaxSpeechService } from './services/minimax-speech.service';
import { MinimaxMusicService } from './services/minimax-music.service';
import { TencentSpeechService } from './services/tencent-speech.service';
import { TencentVodAigcService } from './services/tencent-vod-aigc.service';
import { ModelRoutingService } from './services/model-routing.service';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { TeamCreditsModule } from '../team-credits/team-credits.module';
import { VolcAssetModule } from '../volc-asset/volc-asset.module';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { AudioRoutingService } from './audio/audio-routing.service';
import { SeedAudioProvider } from './audio/providers/seed-audio.provider';
import { MinimaxSpeechProvider } from './audio/providers/minimax-speech.provider';
import { MinimaxMusicProvider } from './audio/providers/minimax-music.provider';
import { TencentDubProvider } from './audio/providers/tencent-dub.provider';
import { ReferenceVideoDurationService } from './services/reference-video-duration.service';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    CreditsModule,
    OssModule,
    PrismaModule,
    TelemetryModule,
    TeamCreditsModule,
    VolcAssetModule,
    TeamCollabModule,
  ],
  providers: [
    AiService,
    ImageGenerationService,
    BackgroundRemovalService,
    GeminiProProvider,
    RunningHubProvider,
    MidjourneyProvider,
    Seedream5Provider,
    NewApiProvider,
    AIProviderFactory,
    CostCalculatorService,
    Convert2Dto3DService,
    Seed3DService,
    ExpandImageService,
    Sora2VideoService,
    VeoVideoService,
    SeedAudioVoiceService,
    VideoProviderService,
    VideoWatermarkService,
    Seedream5Service,
    MinimaxSpeechService,
    MinimaxMusicService,
    TencentSpeechService,
    SeedAudioProvider,
    MinimaxSpeechProvider,
    MinimaxMusicProvider,
    TencentDubProvider,
    AudioRoutingService,
    TencentVodAigcService,
    ModelRoutingService,
    ImageTaskService,
    ImageTaskQueueService,
    ImageTaskWorkerService,
    GenerationTaskService,
    ReferenceVideoDurationService,
    ApiKeyOrJwtGuard,
  ],
  controllers: [AiController, InternalTencentVodController],
  exports: [AIProviderFactory, CostCalculatorService, BackgroundRemovalService, VeoVideoService, SeedAudioVoiceService, GenerationTaskService],
})
export class AiModule {}
