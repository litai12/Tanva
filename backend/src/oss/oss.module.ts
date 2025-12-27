import { Module } from '@nestjs/common';
import { OssService } from './oss.service';
import { UploadsController } from './uploads.controller';
import { AssetsController } from './assets.controller';

@Module({
  providers: [OssService],
  controllers: [UploadsController, AssetsController],
  exports: [OssService],
})
export class OssModule {}
