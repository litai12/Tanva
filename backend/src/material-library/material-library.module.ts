import { Module } from '@nestjs/common';
import { TeamCoreModule } from '../team-core/team-core.module';
import { MaterialLibraryController } from './material-library.controller';
import { MaterialLibraryService } from './material-library.service';

@Module({
  imports: [TeamCoreModule],
  controllers: [MaterialLibraryController],
  providers: [MaterialLibraryService],
})
export class MaterialLibraryModule {}
