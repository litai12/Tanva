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
import { CollabEventLog } from './collab-event-log.service';
import { CollabEnvelope, CursorPayload, PresenceUserPayload } from './types';

const WS_PATH = '/ws/collab';
const HEARTBEAT_MS = 25_000;

// 下发给客户端的事件类型（其余事件一律不走 WS）。
// node_patch / node_lock / toast 是协作编辑的核心信号，必须转发，
// 否则远端编辑、锁、提示都无法到达其他在线成员。
const FORWARD_TYPES: ReadonlySet<string> = new Set([
  'team_credits_changed',
  'user_credits_changed',
  'cursor',
  'task_status',
  'presence_join',
  'presence_leave',
  'node_patch',
  'canvas_patch',
  'node_lock',
  'toast',
  'snapshot_required',
  'access_revoked',
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
  /** 断线重连时客户端携带的最后已处理 seq，用于补帧。 */
  afterSeq: number;
}

@Injectable()
export class WsCollabGateway implements OnModuleDestroy {
  private readonly logger = new Logger(WsCollabGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly conns = new Set<WsConn>();
  private readonly projectConns = new Map<string, Set<WsConn>>();
  /** connId -> conn，供 HTTP patch/lock 端点校验连接归属。 */
  private readonly connIndex = new Map<string, WsConn>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private originAllowed: ((origin: string) => boolean) | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly bus: CollabEventBus,
    private readonly log: CollabEventLog,
  ) {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  /** 连接是否存在（HTTP patch/lock 端点用它替代失效的 SSE 校验）。 */
  hasConn(connId: string): boolean {
    return this.connIndex.has(connId);
  }

  /** 连接所属用户（校验 connId 与发起用户一致）。 */
  getConnUserId(connId: string): string | undefined {
    return this.connIndex.get(connId)?.userId;
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
    const afterSeq = Number.parseInt(url.searchParams.get('after') ?? '0', 10) || 0;

    let userId = '';
    let tokenName = '';
    let role = '';
    try {
      const payload = await this.jwt.verifyAsync<any>(token);
      userId = String(payload?.sub ?? '');
      tokenName = String(payload?.name ?? payload?.username ?? '').trim();
      role = String(payload?.role ?? '');
    } catch {
      return this.reject(socket, 401, 'Unauthorized');
    }
    if (!userId) return this.reject(socket, 401, 'Unauthorized');

    // presence 显示名以 DB 当前用户名为准（JWT 里的 name 可能是登录时的旧值，且
    // 普通访问令牌并不携带 name → 旧逻辑会回落成 userId 前 8 位的占位 id）。
    // 团队内所有人据此看到彼此真实用户名，改名后重连即生效。
    const userName = await this.resolveDisplayName(userId, tokenName);

    // 仅当 token 声称 admin 时才查 DB 确认当前角色（普通用户零额外开销），
    // 避免被降权用户凭旧 token 在过期前继续越权访问协作流。
    const isSuperAdmin =
      role.toLowerCase() === 'admin' ? await this.isUserSuperAdmin(userId) : false;

    if (teamId && !isSuperAdmin) {
      const member = await this.prisma.teamMembership
        .findUnique({ where: { teamId_userId: { teamId, userId } } })
        .catch(() => null);
      if (!member) return this.reject(socket, 403, 'Forbidden');
    }
    if (projectId) {
      if (isSuperAdmin) {
        // 超管绕过成员校验，但仍需确认项目存在，避免进入无效协作空间。
        const exists = await this.prisma.project
          .findUnique({ where: { id: projectId }, select: { id: true } })
          .catch(() => null);
        if (!exists) return this.reject(socket, 404, 'Not Found');
      } else {
        const ok = await this.assertProjectAccess(projectId, userId, teamId).catch(() => false);
        if (!ok) return this.reject(socket, 403, 'Forbidden');
      }
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.register(ws, { userId, userName, teamId, projectId, afterSeq });
    });
  }

  /**
   * 解析 presence 显示名：DB 当前用户名优先，其次 token 内名字，最后回落 userId 前 8 位。
   * 每次连接查一次（非逐消息），开销可忽略；保证团队成员看到的是真实、最新的用户名。
   */
  private async resolveDisplayName(userId: string, tokenName: string): Promise<string> {
    const user = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { name: true } })
      .catch(() => null);
    const dbName = typeof user?.name === 'string' ? user.name.trim() : '';
    return dbName || tokenName || userId.slice(0, 8);
  }

  /** 以数据库当前角色为准判断超级管理员，避免信任可能过期的 JWT role。 */
  private async isUserSuperAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { role: true } })
      .catch(() => null);
    return typeof user?.role === 'string' && user.role.toLowerCase() === 'admin';
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
    this.connIndex.set(conn.connId, conn);

    const forward = (env: CollabEnvelope) => {
      if (!FORWARD_TYPES.has(env.type)) return;
      // 不把自己发出的事件回推给自己（patch/lock/toast/cursor 统一按 connId 抑制）。
      if (env.senderConnId && env.senderConnId === conn.connId) return;
      // 光标额外按 userId 抑制（同一用户多连接时也不回推）。
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

    // 断线重连补帧：客户端带上最后已处理 seq，回放其后持久化的事件（node_patch 等）。
    // 缺帧过多（事件日志已截断）则下发 snapshot_required，客户端转为拉取全量快照。
    if (ctx.projectId && ctx.afterSeq > 0) {
      try {
        const { envelopes, truncated } = await this.log.readAfter(ctx.projectId, ctx.afterSeq, 200);
        if (truncated) {
          this.safeSend(conn, {
            type: 'snapshot_required' as any,
            payload: { after: ctx.afterSeq },
            ts: Date.now(),
          } as CollabEnvelope);
        }
        for (const env of envelopes) {
          this.safeSend(conn, env);
        }
      } catch {}
    }

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
    this.connIndex.delete(conn.connId);
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
