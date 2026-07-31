import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StoryboardSkillsController } from './storyboard-skills.controller';
import { StoryboardSkillsService } from './storyboard-skills.service';

@Module({
  imports: [PrismaModule],
  controllers: [StoryboardSkillsController],
  providers: [StoryboardSkillsService],
})
export class StoryboardSkillsModule {}
