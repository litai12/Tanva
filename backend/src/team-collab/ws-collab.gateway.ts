import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CollabEventBus,
  channelForProject,
  channelForTeam,
  channelForUser,
} from './collab-event-bus.service';
import { CollabEnvelope, CursorPayload, PresenceUserPayload } from './types';

const WS_PATH = '/ws/collab';
const HEARTBEAT_MS = 25_000;

// 只把这几类信号下发给客户端（其余事件一律不走 WS）
const FORWARD_TYPES: ReadonlySet<string> = new Set([
  'team_credits_changed',
  'user_credits_changed',
  'cursor',
  'task_status',
  'presence_join',
  'presence_leave',
]);

interface WsConn {
  ws: WebSocket;
  connId: string;
  userId: string;
  userName: string;
  teamId: string;
  projectId: string | null;
  unsubs: Array<() => void>;
  isAlive: boolean;
}

interface UpgradeCtx {
  userId: string;
  userName: string;
  teamId: string;
  projectId: string | null;
}

@Injectable()
export class WsCollabGateway implements OnModuleDestroy {
  private readonly logger = new Logger(WsCollabGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly conns = new Set<WsConn>();
  private readonly projectConns = new Map<string, Set<WsConn>>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private originAllowed: ((origin: string) => boolean) | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly bus: CollabEventBus,
  ) {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  /** main.ts 注入 Origin 白名单（与 CORS 配置一致）。 */
  setOriginCheck(fn: (origin: string) => boolean): void {
    this.originAllowed = fn;
  }

  /** main.ts 在 app.listen() 前调用，挂到底层 http server 的 upgrade 事件。 */
  attach(server: HttpServer): void {
    server.on('upgrade', (req, socket, head) => {
      void this.handleUpgrade(req, socket as Duplex, head as Buffer);
    });
  }

  private reject(socket: Duplex, code: number, msg: string): void {
    try {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
    } catch {}
    try {
      socket.destroy();
    } catch {}
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://localhost');
    } catch {
      return this.reject(socket, 400, 'Bad Request');
    }
    // 本进程只有这一个 upgrade 处理器，未匹配路径直接拒绝，避免 socket 悬挂泄漏。
    if (url.pathname !== WS_PATH) return this.reject(socket, 404, 'Not Found');

    const origin = req.headers.origin ?? '';
    if (this.originAllowed && origin && !this.originAllowed(origin)) {
      return this.reject(socket, 403, 'Forbidden Origin');
    }

    const token = url.searchParams.get('token') ?? '';
    const teamId = url.searchParams.get('teamId') ?? '';
    const projectId = url.searchParams.get('projectId');

    let userId = '';
    let userName = '';
    try {
      const payload = await this.jwt.verifyAsync<any>(token);
      userId = String(payload?.sub ?? '');
      userName = String(payload?.name ?? payload?.username ?? userId.slice(0, 8));
    } catch {
      return this.reject(socket, 401, 'Unauthorized');
    }
    if (!userId) return this.reject(socket, 401, 'Unauthorized');

    if (teamId) {
      const member = await this.prisma.teamMembership
        .findUnique({ where: { teamId_userId: { teamId, userId } } })
        .catch(() => null);
      if (!member) return this.reject(socket, 403, 'Forbidden');
    }
    if (projectId) {
      const ok = await this.assertProjectAccess(projectId, userId, teamId).catch(() => false);
      if (!ok) return this.reject(socket, 403, 'Forbidden');
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.register(ws, { userId, userName, teamId, projectId });
    });
  }

  private async assertProjectAccess(
    projectId: string,
    userId: string,
    teamId: string,
  ): Promise<boolean> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return false;
    if (project.userId === userId) return true;
    if (!teamId) return false;
    const share = await this.prisma.teamProjectShare.findUnique({
      where: { projectId_teamId: { projectId, teamId } },
    });
    if (!share) return false;
    const member = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    return Boolean(member);
  }

  private async register(ws: WebSocket, ctx: UpgradeCtx): Promise<void> {
    const conn: WsConn = {
      ws,
      connId: randomUUID(),
      userId: ctx.userId,
      userName: ctx.userName,
      teamId: ctx.teamId,
      projectId: ctx.projectId,
      unsubs: [],
      isAlive: true,
    };
    this.conns.add(conn);

    const forward = (env: CollabEnvelope) => {
      if (!FORWARD_TYPES.has(env.type)) return;
      // 不把自己的光标回推给自己
      if (env.type === 'cursor' && env.senderUserId === conn.userId) return;
      this.safeSend(conn, env);
    };

    if (conn.userId) {
      conn.unsubs.push(await this.bus.subscribeTo(channelForUser(conn.userId), forward));
    }
    if (conn.teamId) {
      conn.unsubs.push(await this.bus.subscribeTo(channelForTeam(conn.teamId), forward));
    }
    if (conn.projectId) {
      conn.unsubs.push(await this.bus.subscribeTo(channelForProject(conn.projectId), forward));
      let set = this.projectConns.get(conn.projectId);
      if (!set) {
        set = new Set();
        this.projectConns.set(conn.projectId, set);
      }
      set.add(conn);
      await this.bus.publishTo(channelForProject(conn.projectId), {
        type: 'presence_join',
        payload: { userId: conn.userId, name: conn.userName },
        ts: Date.now(),
        senderUserId: conn.userId,
        senderConnId: conn.connId,
      } as CollabEnvelope<PresenceUserPayload>);
    }

    // connected ack + presence 快照（type 'connected' 仅用于握手回执，不属 CollabEventType）
    this.safeSend(conn, {
      type: 'connected' as any,
      payload: {
        connId: conn.connId,
        presence: this.getPresence(conn.projectId),
        degraded: this.bus.isDegraded(),
      },
      ts: Date.now(),
    } as CollabEnvelope);

    ws.on('pong', () => {
      conn.isAlive = true;
    });
    ws.on('message', (raw) => this.onClientMessage(conn, raw));
    ws.on('close', () => this.cleanup(conn));
    ws.on('error', () => this.cleanup(conn));
  }

  private onClientMessage(conn: WsConn, raw: RawData): void {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg?.type === 'cursor' && conn.projectId) {
      const p = msg.payload ?? {};
      if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
      void this.bus.publishTo(channelForProject(conn.projectId), {
        type: 'cursor',
        payload: {
          userId: conn.userId,
          name: conn.userName,
          x: p.x,
          y: p.y,
          viewport: p.viewport,
        },
        ts: Date.now(),
        senderUserId: conn.userId,
        senderConnId: conn.connId,
      } as CollabEnvelope<CursorPayload>);
    }
  }

  private getPresence(projectId: string | null): PresenceUserPayload[] {
    if (!projectId) return [];
    const set = this.projectConns.get(projectId);
    if (!set) return [];
    const seen = new Map<string, PresenceUserPayload>();
    for (const c of set) {
      if (!seen.has(c.userId)) seen.set(c.userId, { userId: c.userId, name: c.userName });
    }
    return [...seen.values()];
  }

  private safeSend(conn: WsConn, env: CollabEnvelope): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    try {
      conn.ws.send(JSON.stringify(env));
    } catch {}
  }

  private cleanup(conn: WsConn): void {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    for (const u of conn.unsubs) {
      try {
        u();
      } catch {}
    }
    conn.unsubs = [];
    if (conn.projectId) {
      const set = this.projectConns.get(conn.projectId);
      if (set) {
        set.delete(conn);
        const stillThere = [...set].some((c) => c.userId === conn.userId);
        if (set.size === 0) this.projectConns.delete(conn.projectId);
        if (!stillThere) {
          void this.bus.publishTo(channelForProject(conn.projectId), {
            type: 'presence_leave',
            payload: { userId: conn.userId, name: conn.userName },
            ts: Date.now(),
            senderUserId: conn.userId,
            senderConnId: conn.connId,
          } as CollabEnvelope<PresenceUserPayload>);
        }
      }
    }
    try {
      conn.ws.terminate();
    } catch {}
  }

  private heartbeat(): void {
    for (const conn of [...this.conns]) {
      if (!conn.isAlive) {
        this.cleanup(conn);
        continue;
      }
      conn.isAlive = false;
      try {
        conn.ws.ping();
      } catch {
        this.cleanup(conn);
      }
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const conn of [...this.conns]) this.cleanup(conn);
    try {
      this.wss.close();
    } catch {}
  }
}
