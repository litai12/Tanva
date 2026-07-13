import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import { AgentRuntimeService } from './agent-runtime.service';

const HEARTBEAT_MS = 25_000;

@ApiTags('agent')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('agent')
export class AgentController {
  constructor(private readonly agentRuntime: AgentRuntimeService) {}

  @Post('runs')
  createRun(@Body() dto: CreateAgentRunDto, @Req() req: any) {
    const userId = this.resolveUserId(req);
    const teamId = req.headers?.['x-team-id'] as string | undefined;
    return this.agentRuntime.createRun(dto, userId, teamId);
  }

  @Get('runs/:runId')
  getRun(@Param('runId') runId: string, @Req() req: any) {
    return this.agentRuntime.getRun(runId, this.resolveUserId(req));
  }

  @Get('runs/:runId/events')
  streamRunEvents(
    @Param('runId') runId: string,
    @Req() req: any,
    @Res({ passthrough: false }) res: any,
  ) {
    const userId = this.resolveUserId(req);
    const existingEvents = this.agentRuntime.getEvents(runId, userId);

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

    const write = (event: any) => {
      try {
        res.raw.write(
          `event: ${event.type}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      } catch {}
    };

    for (const event of existingEvents) {
      write(event);
    }
    const unsubscribe = this.agentRuntime.subscribe(runId, userId, write);

    res.raw.write(
      `event: connected\ndata: ${JSON.stringify({ runId, userId })}\n\n`,
    );

    const heartbeat = setInterval(() => {
      try {
        res.raw.write(':keepalive\n\n');
      } catch {}
    }, HEARTBEAT_MS);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      try {
        unsubscribe();
      } catch {}
    });
  }

  private resolveUserId(req: any): string {
    return req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
  }
}
