import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectContentDto } from './dto/update-project-content.dto';
import { ShareProjectDto } from './dto/share-project.dto';

@ApiTags('projects')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(
    @Req() req: any,
    @Query('teamId') queryTeamId?: string,
    @Query('scope') scope?: string,
  ) {
    const teamId = queryTeamId || (req.headers?.['x-team-id'] as string | undefined);
    if (teamId && scope === 'team') {
      return this.projects.listTeamOnly(req.user.sub, teamId);
    }
    if (scope === 'personal') {
      return this.projects.list(req.user.sub);
    }
    return this.projects.listWithTeamAccess(req.user.sub, teamId);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateProjectDto) {
    const teamId = (req.headers?.['x-team-id'] as string | undefined) || undefined;
    return this.projects.create(req.user.sub, dto.name, teamId);
  }

  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    return this.projects.get(req.user.sub, id, req.user.role);
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(req.user.sub, id, {
      name: dto.name,
      thumbnailUrl: dto.thumbnailUrl,
    }, req.user.role);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.projects.remove(req.user.sub, id);
  }

  @Get(':id/content')
  async getContent(@Req() req: any, @Param('id') id: string) {
    return this.projects.getContent(req.user.sub, id, req.user.role);
  }

  @Put(':id/content')
  async updateContent(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProjectContentDto) {
    return this.projects.updateContent(req.user.sub, id, dto.content, dto.version, {
      createWorkflowHistory: dto.createWorkflowHistory,
      workflowHistoryMeta: dto.workflowHistoryMeta,
    }, req.user.role);
  }

  @Get(':id/workflow-history')
  async listWorkflowHistory(
    @Req() req: any,
    @Param('id') id: string,
    @Query('limit') limit?: string
  ) {
    return this.projects.listWorkflowHistory(req.user.sub, id, limit, req.user.role);
  }

  @Get(':id/workflow-history/:updatedAt')
  async getWorkflowHistory(
    @Req() req: any,
    @Param('id') id: string,
    @Param('updatedAt') updatedAt: string
  ) {
    return this.projects.getWorkflowHistory(req.user.sub, id, updatedAt, req.user.role);
  }

  @Post(':id/team-shares')
  shareWithTeam(@Req() req: any, @Param('id') id: string, @Body() dto: ShareProjectDto) {
    return this.projects.shareWithTeam(id, dto.teamId, req.user.sub);
  }

  @Delete(':id/team-shares/:teamId')
  unshareFromTeam(
    @Req() req: any,
    @Param('id') id: string,
    @Param('teamId') teamId: string,
  ) {
    return this.projects.unshareFromTeam(id, teamId, req.user.sub);
  }

  @Post(':id/clone-to-team')
  cloneToTeam(
    @Req() req: any,
    @Param('id') id: string,
    @Body('teamId') teamId: string,
  ) {
    return this.projects.cloneToTeam(id, teamId, req.user.sub);
  }
}
