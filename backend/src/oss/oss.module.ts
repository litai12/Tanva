import { Module } from '@nestjs/common';
import { OssService } from './oss.service';
import { UploadsController } from './uploads.controller';
import { AssetsController } from './assets.controller';
import { VideoFramesController } from './video-frames.controller';
import { VideoGifController } from './video-gif.controller';

@Module({
  providers: [OssService],
  controllers: [
    UploadsController,
    AssetsController,
    VideoFramesController,
    VideoGifController,
  ],
  exports: [OssService],
})
export class OssModule {}
