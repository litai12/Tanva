import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { UpsertStoryboardSkillDto } from './dto/upsert-storyboard-skill.dto';
import { StoryboardSkillsService } from './storyboard-skills.service';

@ApiTags('storyboard-skills')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('storyboard-skills')
export class StoryboardSkillsController {
  constructor(private readonly storyboardSkills: StoryboardSkillsService) {}

  @Get()
  @ApiOperation({ summary: '获取当前账号的剧本转分镜 Skill' })
  list(@Req() req: any) {
    return this.storyboardSkills.list(req.user.sub);
  }

  @Post()
  @ApiOperation({ summary: '创建或更新当前账号的剧本转分镜 Skill' })
  upsert(@Req() req: any, @Body() dto: UpsertStoryboardSkillDto) {
    return this.storyboardSkills.upsert(req.user.sub, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除当前账号的剧本转分镜 Skill' })
  remove(@Req() req: any, @Param('id') id: string) {
    return this.storyboardSkills.remove(req.user.sub, id);
  }
}
