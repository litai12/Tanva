import { Module } from '@nestjs/common';
import { OssModule } from '../oss/oss.module';
import { PersonalLibraryController } from './personal-library.controller';
import { PersonalLibraryService } from './personal-library.service';

@Module({
  imports: [OssModule],
  controllers: [PersonalLibraryController],
  providers: [PersonalLibraryService],
})
export class PersonalLibraryModule {}

