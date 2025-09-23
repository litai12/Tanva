import { Module } from '@nestjs/common';
import { OssService } from './oss.service';
import { UploadsController } from './uploads.controller';

@Module({
  providers: [OssService],
  controllers: [UploadsController],
  exports: [OssService],
})
export class OssModule {}
