import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';

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

  @Put(':id')
  async rename(@Req() req: any, @Param('id') id: string, @Body() dto: CreateProjectDto) {
    return this.projects.rename(req.user.sub, id, dto.name || '未命名项目');
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.projects.remove(req.user.sub, id);
  }
}
