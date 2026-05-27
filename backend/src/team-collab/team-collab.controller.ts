import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CanvasSseManager } from './canvas-sse.manager';
import {
  CanvasCursorDto,
  CanvasLockDto,
  CanvasPatchDto,
  CanvasToastDto,
} from './dto/canvas-patch.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CollabEventBus } from './collab-event-bus.service';
import { CollabEventLog } from './collab-event-log.service';
import { NodeLockService } from './node-lock.service';
import {
  CollabEnvelope,
  CursorPayload,
  NodeLockPayload,
  ToastPayload,
} from './types';

const POST_RATE_LIMIT_PER_SEC = 30;

@ApiTags('team-collab')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('canvas')
export class TeamCollabController {
  private readonly rateBuckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly sse: CanvasSseManager,
    private readonly prisma: PrismaService,
    private readonly bus: CollabEventBus,
    private readonly log: CollabEventLog,
    private readonly locks: NodeLockService,
  ) {}

  @Get(':projectId/stream')
  async stream(
    @Req() req: any,
    @Res({ passthrough: false }) res: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Query('after') after?: string,
  ) {
    const userId: string = req.user.sub;
    const userName: string = req.user.name ?? req.user.username ?? userId.slice(0, 8);
    await this.assertProjectAccess(projectId, userId, teamId);

    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('X-Accel-Buffering', 'no');
    res.raw.flushHeaders?.();

    const lastEventId = (req.headers?.['last-event-id'] as string | undefined) ?? after ?? '0';
    const afterSeq = Number.parseInt(lastEventId, 10) || 0;

    const subResult = await this.sse.subscribe(projectId, userId, userName, teamId ?? '', res);
    if ('error' in subResult) {
      res.raw.write(
        `event: error\ndata: ${JSON.stringify({ error: subResult.error })}\n\n`,
      );
      res.raw.end();
      return;
    }
    const { connId, unsubscribe } = subResult;

    // initial connected ack + presence snapshot
    const presence = this.sse.getPresence(projectId);
    res.raw.write(
      `event: connected\ndata: ${JSON.stringify({ connId, presence, degraded: this.bus.isDegraded() })}\n\n`,
    );

    // replay persisted events if client provided a cursor
    if (afterSeq > 0) {
      const { envelopes, truncated } = await this.log.readAfter(projectId, afterSeq, 200);
      if (truncated) {
        res.raw.write(
          `event: snapshot_required\ndata: ${JSON.stringify({ after: afterSeq })}\n\n`,
        );
      }
      for (const env of envelopes) {
        const id = typeof env.seq === 'number' ? `id: ${env.seq}\n` : '';
        res.raw.write(`event: ${env.type}\n${id}data: ${JSON.stringify(env)}\n\n`);
      }
    }

    req.raw.on('close', async () => {
      unsubscribe();
      const released = await this.locks.releaseByConn(projectId, connId);
      for (const nodeId of released) {
        const env: CollabEnvelope<NodeLockPayload> = {
          type: 'node_lock',
          payload: { nodeId, action: 'release', userId, expiresAt: 0 },
          ts: Date.now(),
        };
        this.bus.publish(projectId, env).catch(() => undefined);
      }
    });
  }

  @Post(':projectId/patch')
  @HttpCode(202)
  async patch(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CanvasPatchDto,
  ) {
    const userId: string = req.user.sub;
    await this.assertProjectAccess(projectId, userId, teamId);
    this.assertConnAndRate(dto.connId, userId);
    const seq = await this.log.nextSeq(projectId);
    const envelope: CollabEnvelope = {
      type: 'node_patch',
      payload: dto.patch,
      ts: Date.now(),
      senderConnId: dto.connId,
      senderUserId: userId,
      seq,
    };
    await this.log.append(projectId, envelope);
    await this.bus.publish(projectId, envelope);
    return { ok: true, seq };
  }

  @Post(':projectId/cursor')
  @HttpCode(202)
  async cursor(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CanvasCursorDto,
  ) {
    const userId: string = req.user.sub;
    const userName: string = req.user.name ?? req.user.username ?? userId.slice(0, 8);
    await this.assertProjectAccess(projectId, userId, teamId);
    this.assertConnAndRate(dto.connId, userId);
    const envelope: CollabEnvelope<CursorPayload> = {
      type: 'cursor',
      payload: {
        userId,
        name: userName,
        x: dto.x,
        y: dto.y,
        viewport: dto.viewport as CursorPayload['viewport'],
      },
      ts: Date.now(),
      senderConnId: dto.connId,
      senderUserId: userId,
    };
    await this.bus.publish(projectId, envelope);
    return { ok: true };
  }

  @Post(':projectId/lock')
  async lock(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CanvasLockDto,
  ) {
    const userId: string = req.user.sub;
    await this.assertProjectAccess(projectId, userId, teamId);
    this.assertConnAndRate(dto.connId, userId);
    const result = await this.locks.claim(projectId, dto.nodeId, userId, dto.connId);
    if (result.acquired) {
      const env: CollabEnvelope<NodeLockPayload> = {
        type: 'node_lock',
        payload: {
          nodeId: dto.nodeId,
          action: 'claim',
          userId,
          expiresAt: result.expiresAt,
        },
        ts: Date.now(),
        senderConnId: dto.connId,
        senderUserId: userId,
      };
      await this.bus.publish(projectId, env);
    }
    return {
      acquired: result.acquired,
      holder: result.holder,
      expiresAt: result.expiresAt,
    };
  }

  @Post(':projectId/lock/renew')
  async renew(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CanvasLockDto,
  ) {
    const userId: string = req.user.sub;
    await this.assertProjectAccess(projectId, userId, teamId);
    this.assertConnAndRate(dto.connId, userId);
    const result = await this.locks.renew(projectId, dto.nodeId, userId, dto.connId);
    if (result.acquired) {
      const env: CollabEnvelope<NodeLockPayload> = {
        type: 'node_lock',
        payload: {
          nodeId: dto.nodeId,
          action: 'renewed',
          userId,
          expiresAt: result.expiresAt,
        },
        ts: Date.now(),
        senderConnId: dto.connId,
        senderUserId: userId,
      };
      await this.bus.publish(projectId, env);
    }
    return result;
  }

  @Post(':projectId/unlock')
  async unlock(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CanvasLockDto,
  ) {
    const userId: string = req.user.sub;
    await this.assertProjectAccess(projectId, userId, teamId);
    this.assertConnAndRate(dto.connId, userId);
    const ok = await this.locks.release(projectId, dto.nodeId, userId, dto.connId);
    if (ok) {
      const env: CollabEnvelope<NodeLockPayload> = {
        type: 'node_lock',
        payload: { nodeId: dto.nodeId, action: 'release', userId, expiresAt: 0 },
        ts: Date.now(),
        senderConnId: dto.connId,
        senderUserId: userId,
      };
      await this.bus.publish(projectId, env);
    }
    return { released: ok };
  }

  @Post(':projectId/toast')
  @HttpCode(202)
  async toast(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CanvasToastDto,
  ) {
    const userId: string = req.user.sub;
    const userName: string = req.user.name ?? req.user.username ?? userId.slice(0, 8);
    await this.assertProjectAccess(projectId, userId, teamId);
    if (dto.connId) this.assertConnAndRate(dto.connId, userId);
    const env: CollabEnvelope<ToastPayload> = {
      type: 'toast',
      payload: {
        userId,
        name: userName,
        kind: (dto.kind as ToastPayload['kind']) ?? 'info',
        text: dto.text,
      },
      ts: Date.now(),
      senderConnId: dto.connId,
      senderUserId: userId,
    };
    await this.bus.publish(projectId, env);
    return { ok: true };
  }

  private assertConnAndRate(connId: string, userId: string): void {
    if (!this.sse.hasConn(connId)) {
      throw new ForbiddenException('connection_not_found');
    }
    const owner = this.sse.getConnUserId(connId);
    if (owner !== userId) {
      throw new ForbiddenException('conn_user_mismatch');
    }
    const now = Date.now();
    const bucket = this.rateBuckets.get(connId);
    if (!bucket || bucket.resetAt < now) {
      this.rateBuckets.set(connId, { count: 1, resetAt: now + 1000 });
      return;
    }
    bucket.count++;
    if (bucket.count > POST_RATE_LIMIT_PER_SEC) {
      throw new ForbiddenException('rate_limited');
    }
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
