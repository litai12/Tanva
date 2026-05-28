import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  CollabEventBus,
  channelForTeam,
  channelForUser,
} from './collab-event-bus.service';
import { CollabEnvelope } from './types';

const HEARTBEAT_MS = 25_000;

@ApiTags('team-realtime')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('team-realtime')
export class TeamRealtimeController {
  constructor(
    private readonly bus: CollabEventBus,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Generic SSE stream for non-project events scoped to a team (e.g. credit
   * balance changes). The connected client gets:
   *   - `team:{teamId}` events for the requested team
   *   - `user:{userId}` events for the calling user
   */
  @Get('teams/:teamId/stream')
  async stream(
    @Req() req: any,
    @Res({ passthrough: false }) res: any,
    @Param('teamId') teamId: string,
  ) {
    const userId: string = req.user.sub;
    await this.assertTeamMember(teamId, userId);

    const origin = req.headers?.origin;
    if (origin) {
      res.raw.setHeader('Access-Control-Allow-Origin', origin);
      res.raw.setHeader('Access-Control-Allow-Credentials', 'true');
      res.raw.setHeader('Vary', 'Origin');
    }
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('X-Accel-Buffering', 'no');
    res.raw.flushHeaders?.();

    const write = (envelope: CollabEnvelope) => {
      try {
        const data = JSON.stringify(envelope);
        const idLine = typeof envelope.seq === 'number' ? `id: ${envelope.seq}\n` : '';
        res.raw.write(`event: ${envelope.type}\n${idLine}data: ${data}\n\n`);
      } catch {
        // socket already closed; cleanup runs via 'close' below
      }
    };

    const teamUnsub = await this.bus.subscribeTo(channelForTeam(teamId), write);
    const userUnsub = await this.bus.subscribeTo(channelForUser(userId), write);

    res.raw.write(
      `event: connected\ndata: ${JSON.stringify({
        teamId,
        userId,
        degraded: this.bus.isDegraded(),
      })}\n\n`,
    );

    const heartbeat = setInterval(() => {
      try {
        res.raw.write(':keepalive\n\n');
      } catch {}
    }, HEARTBEAT_MS);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      try {
        teamUnsub();
      } catch {}
      try {
        userUnsub();
      } catch {}
    });
  }

  private async assertTeamMember(teamId: string, userId: string): Promise<void> {
    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership) throw new ForbiddenException('非团队成员');
  }
}
