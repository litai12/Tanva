import { Module } from '@nestjs/common';
import { OssService } from './oss.service';
import { UploadsController } from './uploads.controller';
import { AssetsController } from './assets.controller';
import { VideoFramesController } from './video-frames.controller';

@Module({
  providers: [OssService],
  controllers: [UploadsController, AssetsController, VideoFramesController],
  exports: [OssService],
})
export class OssModule {}
