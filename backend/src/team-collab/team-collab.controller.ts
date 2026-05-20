import {
  Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CanvasSseManager } from './canvas-sse.manager';
import { CanvasPatchDto } from './dto/canvas-patch.dto';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('team-collab')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('canvas')
export class TeamCollabController {
  constructor(
    private readonly sse: CanvasSseManager,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':projectId/stream')
  async stream(
    @Req() req: any,
    @Res({ passthrough: false }) res: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
  ) {
    const userId: string = req.user.sub;
    await this.assertProjectAccess(projectId, userId, teamId);

    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.flushHeaders?.();

    const { connId, unsubscribe } = this.sse.subscribe(projectId, userId, teamId ?? '', res);
    res.raw.write(`data: ${JSON.stringify({ type: 'connected', connId })}\n\n`);

    req.raw.on('close', unsubscribe);
  }

  @Post(':projectId/patch')
  async patch(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CanvasPatchDto,
  ) {
    await this.assertProjectAccess(projectId, req.user.sub, teamId);
    this.sse.broadcast(projectId, dto.patch, dto.connId);
    return { ok: true };
  }

  private async assertProjectAccess(projectId: string, userId: string, teamId?: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.userId === userId) return;

    if (!teamId) throw new ForbiddenException('无权访问此项目');

    const share = await this.prisma.teamProjectShare.findUnique({
      where: { projectId_teamId: { projectId, teamId } },
    });
    if (!share) throw new ForbiddenException('项目未共享到此团队');

    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership) throw new ForbiddenException('非团队成员');
  }
}
