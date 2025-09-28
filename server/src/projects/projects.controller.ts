import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectContentDto } from './dto/update-project-content.dto';

@ApiTags('projects')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(@Req() req: any) {
    return this.projects.list(req.user.sub);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateProjectDto) {
    return this.projects.create(req.user.sub, dto.name);
  }

  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    return this.projects.get(req.user.sub, id);
  }

  @Put(':id')
  async rename(@Req() req: any, @Param('id') id: string, @Body() dto: CreateProjectDto) {
    return this.projects.rename(req.user.sub, id, dto.name || '未命名项目');
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.projects.remove(req.user.sub, id);
  }

  @Get(':id/content')
  async getContent(@Req() req: any, @Param('id') id: string) {
    return this.projects.getContent(req.user.sub, id);
  }

  @Put(':id/content')
  async updateContent(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProjectContentDto) {
    return this.projects.updateContent(req.user.sub, id, dto.content, dto.version);
  }
}
