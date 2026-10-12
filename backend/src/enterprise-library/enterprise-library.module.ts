import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCoreModule } from '../team-core/team-core.module';
import { EnterpriseLibraryController } from './enterprise-library.controller';
import { EnterpriseLibraryService } from './enterprise-library.service';
@Module({ imports: [PrismaModule, TeamCoreModule], controllers: [EnterpriseLibraryController], providers: [EnterpriseLibraryService] })
export class EnterpriseLibraryModule {}
