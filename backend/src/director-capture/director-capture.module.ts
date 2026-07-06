import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DirectorCaptureController } from './director-capture.controller';
import { DirectorCaptureService } from './director-capture.service';

@Module({
  imports: [AuthModule],
  controllers: [DirectorCaptureController],
  providers: [DirectorCaptureService],
})
export class DirectorCaptureModule {}
