# 实时协作 WebSocket 传输 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用单条 WebSocket 连接替代已禁用的 SSE，向客户端推送三类信号（团队积分 / 光标 / 任务状态）并支持光标上行。

**Architecture:** 后端新增 `WsCollabGateway`（用已装的 `ws` 包 + Fastify `upgrade`），复用 `CollabEventBus` 的 Redis pub/sub 频道做扇出，事件生产端不改。前端新增一个共享 WS 客户端单例 `realtimeClient`，两个原 SSE hook（`useTeamRealtime` 全局、`useCanvasCollab` 画布页）改为接入该客户端；`CanvasCollabHandle` 接口保持不变，下游 `CollabRoot`/`usePresence`/`useCollabToast`/`useTaskBroadcast` 无需改动。

**Tech Stack:** NestJS 10 on Fastify 5、`ws`@8、`@nestjs/jwt`、Prisma；前端 React + Vite + Zustand。

**测试说明（本仓库现状）：** 后端与前端**均无单元测试框架**（无 jest/vitest，无 test 脚本）。本计划用以下手段做验证，不引入测试框架：
- 后端：`npm run build`（`tsc`）编译通过 + 一个独立 Node `ws` 冒烟脚本 `backend/scripts/ws-smoke.mjs`（连接/鉴权/光标双客户端互通）。
- 前端：`npx tsc --noEmit` 类型检查通过 + spec 的双浏览器人工验收。
- 频繁提交：每个 Task 末尾提交。

参考 spec：`docs/superpowers/specs/2026-05-28-realtime-collab-websocket-design.md`

---

## 文件结构

**后端**
- 新建 `backend/src/team-collab/ws-collab.gateway.ts` — WS 网关 provider：upgrade 握手+鉴权、按连接订阅 bus 频道、presence join/leave、光标上行、心跳。
- 修改 `backend/src/team-collab/team-collab.module.ts` — 引入 `JwtModule`，注册并导出 `WsCollabGateway`。
- 修改 `backend/src/main.ts` — `app.listen()` 前把网关挂到底层 http server 的 `upgrade` 事件，并注入 Origin 白名单。
- 新建 `backend/scripts/ws-smoke.mjs` — 冒烟验证脚本。

**前端**
- 新建 `frontend/src/services/realtimeClient.ts` — 单例 WS 客户端：连接/重连(退避)/generation 去竞态、`setContext({teamId,projectId})`、`subscribe(listener)`、`send(env)`。
- 修改 `frontend/src/hooks/useTeamRealtime.ts` — 去掉 `return;` 与 EventSource，改为接入 `realtimeClient`（设置 team 上下文 + 订阅积分）。
- 修改 `frontend/src/hooks/useCanvasCollab.ts` — 去掉 `return;` 与 EventSource，`connect`/主 effect 改为接入 `realtimeClient`（设置 project 上下文 + 把消息喂给现有 `dispatch`）；`sendCursor` 经客户端上行；锁方法保持 no-op（`connId` 维持 null）。

---

## Task 1: 后端 WS 网关 service

**Files:**
- Create: `backend/src/team-collab/ws-collab.gateway.ts`

- [ ] **Step 1: 创建网关文件**

```ts
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
    if (url.pathname !== WS_PATH) return; // 非本网关路径，忽略（其它 upgrade 监听器可处理）

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
```

- [ ] **Step 2: 编译检查（此时 main/module 还没接线，仅验证文件本身无语法/类型错误）**

Run: `cd backend && npx tsc -p tsconfig.build.json --noEmit`
Expected: 不出现 `ws-collab.gateway.ts` 的报错（可能出现 module 未注册的"未使用"提示——忽略，下一 Task 接线）。

- [ ] **Step 3: Commit**

```bash
git add backend/src/team-collab/ws-collab.gateway.ts
git commit -m "feat(collab): add WsCollabGateway (ws upgrade + bus fan-out)"
```

---

## Task 2: 在 team-collab 模块注册网关 + JwtModule

**Files:**
- Modify: `backend/src/team-collab/team-collab.module.ts`

- [ ] **Step 1: 改写 module（加入 JwtModule + WsCollabGateway）**

将文件整体替换为：

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { CanvasSseManager } from './canvas-sse.manager';
import { TeamCollabController } from './team-collab.controller';
import { TeamRealtimeController } from './team-realtime.controller';
import { CollabEventBus } from './collab-event-bus.service';
import { CollabEventLog } from './collab-event-log.service';
import { NodeLockService } from './node-lock.service';
import { TeamCreditsPublisher } from './team-credits-publisher.service';
import { WsCollabGateway } from './ws-collab.gateway';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') || 'dev-access-secret',
      }),
    }),
  ],
  controllers: [TeamCollabController, TeamRealtimeController],
  providers: [
    CollabEventBus,
    CollabEventLog,
    NodeLockService,
    CanvasSseManager,
    TeamCreditsPublisher,
    WsCollabGateway,
  ],
  exports: [
    CanvasSseManager,
    CollabEventBus,
    CollabEventLog,
    NodeLockService,
    TeamCreditsPublisher,
    WsCollabGateway,
  ],
})
export class TeamCollabModule {}
```

- [ ] **Step 2: 编译检查**

Run: `cd backend && npx tsc -p tsconfig.build.json --noEmit`
Expected: PASS（0 error）。

- [ ] **Step 3: Commit**

```bash
git add backend/src/team-collab/team-collab.module.ts
git commit -m "feat(collab): register WsCollabGateway + JwtModule in TeamCollabModule"
```

---

## Task 3: 在 main.ts 接线 upgrade

**Files:**
- Modify: `backend/src/main.ts`（import 区 + `app.listen()` 之前，约 line 304）

- [ ] **Step 1: 在 import 区加入网关 import**

在 `backend/src/main.ts` 顶部 import 段末尾追加：

```ts
import { WsCollabGateway } from "./team-collab/ws-collab.gateway";
```

- [ ] **Step 2: 在 `await app.listen(...)` 之前挂 upgrade**

定位 `backend/src/main.ts:306` 的 `await app.listen({ port, host });`。在它**之前**插入：

```ts
  // 实时协作：把 WS 网关挂到底层 http server 的 upgrade 事件（仅 /ws/collab）
  const wsGateway = app.get(WsCollabGateway);
  wsGateway.setOriginCheck((origin: string) => {
    if (corsDevAllowAll || corsAllowAll) return true;
    if (corsOrigins.length === 0) return true;
    return corsOrigins.includes(origin);
  });
  wsGateway.attach(fastifyInstance.server);
```

> 注：`fastifyInstance` 已在 `main.ts:154` 定义；`corsOrigins`/`corsDevAllowAll`/`corsAllowAll` 在 `main.ts:251` 附近的 CORS 配置处定义。若变量名不同，按该处实际命名调整，使 Origin 白名单与 CORS 一致。

- [ ] **Step 3: 编译检查 + 启动验证**

Run: `cd backend && npx tsc -p tsconfig.build.json --noEmit`
Expected: PASS。

Run（开发态起服务，确认无启动异常）: `cd backend && npm run dev`
Expected: 控制台出现 `API listening on http://localhost:4000`，无 upgrade 相关报错。确认后保留该进程用于 Task 4。

- [ ] **Step 4: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat(collab): wire WsCollabGateway upgrade handler in bootstrap"
```

---

## Task 4: 后端冒烟脚本（鉴权 + 双客户端光标互通）

**Files:**
- Create: `backend/scripts/ws-smoke.mjs`

前置：需要一个有效的 access token 与一个 teamId/projectId。脚本从环境变量读取，便于手动跑。

- [ ] **Step 1: 写冒烟脚本**

```js
// backend/scripts/ws-smoke.mjs
// 用法:
//   TOKEN=<access_token> TEAM_ID=<teamId> PROJECT_ID=<projectId> node scripts/ws-smoke.mjs
//   (PROJECT_ID 可选；不传则只验证 credits/鉴权通道)
import WebSocket from 'ws';

const BASE = process.env.WS_BASE || 'ws://localhost:4000';
const TOKEN = process.env.TOKEN || '';
const TEAM_ID = process.env.TEAM_ID || '';
const PROJECT_ID = process.env.PROJECT_ID || '';

if (!TOKEN || !TEAM_ID) {
  console.error('需要 TOKEN 和 TEAM_ID 环境变量');
  process.exit(2);
}

const q = (extra) => {
  const p = new URLSearchParams({ token: TOKEN, teamId: TEAM_ID, ...extra });
  return `${BASE}/ws/collab?${p.toString()}`;
};

function open(label, url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => reject(new Error(`${label} 连接超时`)), 5000);
    ws.on('open', () => console.log(`[${label}] open`));
    ws.on('message', (raw) => {
      const env = JSON.parse(raw.toString());
      console.log(`[${label}] <-`, env.type, JSON.stringify(env.payload).slice(0, 120));
      if (env.type === 'connected') {
        clearTimeout(t);
        resolve(ws);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(t);
      reject(new Error(`${label} error: ${e.message}`));
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(t);
      reject(new Error(`${label} handshake rejected: HTTP ${res.statusCode}`));
    });
  });
}

async function main() {
  // 1) 鉴权失败必须被拒
  await new Promise((resolve) => {
    const ws = new WebSocket(q({ token: 'bad-token' }));
    ws.on('open', () => {
      console.error('FAIL: 坏 token 竟然握手成功');
      process.exit(1);
    });
    ws.on('unexpected-response', (_r, res) => {
      console.log(`OK: 坏 token 被拒 (HTTP ${res.statusCode})`);
      resolve();
    });
    ws.on('error', () => resolve()); // 某些环境直接 error，也算拒绝
  });

  // 2) 合法连接拿到 connected ack
  const a = await open('A', q(PROJECT_ID ? { projectId: PROJECT_ID } : {}));
  console.log('OK: 合法连接收到 connected ack');

  // 3) 若有 projectId，开第二个客户端验证光标互通
  if (PROJECT_ID) {
    const cursorSeen = new Promise((resolve, reject) => {
      const tm = setTimeout(() => reject(new Error('B 未收到 A 的 cursor')), 5000);
      const b = open('B', q({ projectId: PROJECT_ID }));
      b.then((ws) => {
        ws.on('message', (raw) => {
          const env = JSON.parse(raw.toString());
          if (env.type === 'cursor' && env.payload?.x === 123) {
            clearTimeout(tm);
            console.log('OK: B 收到 A 的 cursor 广播');
            resolve();
          }
        });
        // A 发一个光标
        setTimeout(() => a.send(JSON.stringify({ type: 'cursor', payload: { x: 123, y: 456 } })), 300);
      }).catch(reject);
    });
    await cursorSeen;
  }

  console.log('SMOKE PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('SMOKE FAIL:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: 运行冒烟脚本**

先准备一个有效 token（可从浏览器 DevTools 的 cookie `access_token` 复制，或登录接口获取）。然后：

Run: `cd backend && TOKEN='<access_token>' TEAM_ID='<teamId>' PROJECT_ID='<projectId>' node scripts/ws-smoke.mjs`
Expected 输出包含：
```
OK: 坏 token 被拒 (HTTP 401)
OK: 合法连接收到 connected ack
OK: B 收到 A 的 cursor 广播
SMOKE PASS
```

> 若无法取得真实 token，至少验证「坏 token 被拒」+「合法连接 connected ack」两项（不带 PROJECT_ID 跑）。

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/ws-smoke.mjs
git commit -m "test(collab): add ws gateway smoke script"
```

---

## Task 5: 前端共享 WS 客户端单例

**Files:**
- Create: `frontend/src/services/realtimeClient.ts`

- [ ] **Step 1: 写客户端单例**

```ts
import { getAccessToken } from './authTokenStorage';

type Listener = (env: any) => void;

const httpBase =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000';
const wsBase = httpBase.replace(/^http/i, 'ws'); // http->ws, https->wss

const MAX_BACKOFF_MS = 30_000;

let ws: WebSocket | null = null;
let generation = 0; // 每次 (重)连接自增，用于丢弃过期 socket 的回调
let teamId: string | null = null;
let projectId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 1_000;
let connId: string | null = null;
const listeners = new Set<Listener>();

function buildUrl(): string | null {
  const token = getAccessToken() ?? '';
  if (!token || !teamId) return null;
  const params = new URLSearchParams({ token, teamId });
  if (projectId) params.set('projectId', projectId);
  return `${wsBase}/ws/collab?${params.toString()}`;
}

function closeSocket(): void {
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    } catch {}
    ws = null;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = backoff;
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect(): void {
  const url = buildUrl();
  closeSocket();
  if (!url) return; // 缺 token/teamId，不连
  const gen = ++generation;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    if (gen !== generation) {
      try { sock.close(); } catch {}
      return;
    }
    backoff = 1_000;
  };
  sock.onmessage = (e) => {
    if (gen !== generation) return;
    let env: any;
    try {
      env = JSON.parse(e.data);
    } catch {
      return;
    }
    if (env?.type === 'connected') connId = env.payload?.connId ?? null;
    for (const l of listeners) {
      try {
        l(env);
      } catch {}
    }
  };
  sock.onclose = () => {
    if (gen !== generation) return;
    scheduleReconnect();
  };
  sock.onerror = () => {
    try { sock.close(); } catch {}
  };
}

export const realtimeClient = {
  /** 设置连接上下文；teamId/projectId 变化会用新参数重连（始终只保持一条连接）。 */
  setContext(next: { teamId?: string | null; projectId?: string | null }): void {
    let changed = false;
    if (next.teamId !== undefined && next.teamId !== teamId) {
      teamId = next.teamId;
      changed = true;
    }
    if (next.projectId !== undefined && next.projectId !== projectId) {
      projectId = next.projectId;
      changed = true;
    }
    if (changed) connect();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  send(env: unknown): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(env));
      } catch {}
    }
  },
  getConnId(): string | null {
    return connId;
  },
  stop(): void {
    generation += 1;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    closeSocket();
  },
};
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 不出现 `realtimeClient.ts` 报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/realtimeClient.ts
git commit -m "feat(collab): add shared realtime WS client singleton"
```

---

## Task 6: 接入 useTeamRealtime（积分）

**Files:**
- Modify: `frontend/src/hooks/useTeamRealtime.ts`

- [ ] **Step 1: 整体替换为接入 realtimeClient 版本**

将 `frontend/src/hooks/useTeamRealtime.ts` 整体替换为：

```ts
import { useEffect } from 'react';
import { useTeamStore } from '@/stores/teamStore';
import { useAuthStore } from '@/stores/authStore';
import { realtimeClient } from '@/services/realtimeClient';
import type {
  CollabEnvelope,
  TeamCreditsChangedPayload,
} from '@/collab/types';

/**
 * 通过共享 WS 客户端订阅团队积分实时变更，保持本地余额同步。
 * 在 App 外壳挂载一次；activeTeamId 变化时由 realtimeClient 用新参数重连。
 */
export function useTeamRealtime(): void {
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const patchTeamCredits = useTeamStore((s) => s.patchTeamCredits);

  useEffect(() => {
    if (!activeTeamId || !userId) {
      realtimeClient.setContext({ teamId: null });
      return;
    }
    realtimeClient.setContext({ teamId: activeTeamId });

    const unsub = realtimeClient.subscribe((env: CollabEnvelope) => {
      if (env.type === 'team_credits_changed') {
        const p = env.payload as TeamCreditsChangedPayload;
        if (!p?.teamId) return;
        patchTeamCredits(p.teamId, p.availableCredits);
        try {
          window.dispatchEvent(new CustomEvent('team-credits-changed', { detail: p }));
        } catch {}
      } else if (env.type === 'user_credits_changed') {
        try {
          window.dispatchEvent(new CustomEvent('refresh-credits'));
        } catch {}
      }
    });

    return () => {
      unsub();
    };
  }, [activeTeamId, userId, patchTeamCredits]);
}
```

> 说明：`App.tsx:64` 已 `useTeamRealtime()` 挂载，无需改动 App.tsx。

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 不出现 `useTeamRealtime.ts` 报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useTeamRealtime.ts
git commit -m "feat(collab): team credits realtime via shared WS client"
```

---

## Task 7: 接入 useCanvasCollab（光标/presence/任务状态）

**Files:**
- Modify: `frontend/src/hooks/useCanvasCollab.ts`（`connect` 回调 line 110-184、主 effect line 186-201、`sendCursor` line 218-231）

保留 `CanvasCollabHandle` 接口与 `subscribe`/`dispatch`/锁方法不变；只把传输从 EventSource 换成 `realtimeClient`，并让 `sendCursor` 经客户端上行。锁方法（`claimLock`/`renewLock`/`releaseLock`）保持现状——`connIdRef.current` 维持 `null`，因此它们继续早退为 no-op（与当前禁用态一致，不引入 403 噪音）。

- [ ] **Step 1: 顶部 import 加入 realtimeClient**

在 `frontend/src/hooks/useCanvasCollab.ts` 的 import 段（line 1-11 区域）追加：

```ts
import { realtimeClient } from '../services/realtimeClient';
```

- [ ] **Step 2: 替换 `connect` 回调**

将 line 110-184 的整个 `const connect = useCallback(() => { ... }, [projectId, activeTeamId, dispatch]);` 替换为：

```ts
  const connect = useCallback(() => {
    // 设置 project 上下文（realtimeClient 会用新参数重连，始终单连接）。
    realtimeClient.setContext({ projectId: projectId || null });
    const unsub = realtimeClient.subscribe((env: CollabEnvelope) => {
      if (!env || typeof env.type !== 'string') return;
      if (env.type === 'connected') {
        const data = env.payload as ConnectedPayload;
        setConnected(true);
        setDegraded(Boolean(data?.degraded));
        // 注意：connId 故意不写入 connIdRef（锁功能 v1 不启用，保持 no-op）。
        dispatch({ type: 'connected', payload: data, ts: Date.now() });
        return;
      }
      if (env.type === 'access_revoked') {
        onAccessRevokedRef.current?.();
        return;
      }
      if (env.type === 'snapshot_required') {
        onSnapshotRequiredRef.current?.();
      }
      // 抑制自己发出的事件
      if (env.senderConnId && env.senderConnId === connIdRef.current) return;
      dispatch(env);
    });
    // 保存退订函数到 esRef 占位（复用既有清理路径）
    cleanupRef.current = unsub;
  }, [projectId, dispatch]);
```

> 说明：原 `esRef`（EventSource ref）不再使用。改用新增 `cleanupRef` 持有退订函数（下一步声明）。`activeTeamId` 不再作为依赖——team 上下文由 `useTeamRealtime` 统一设置。

- [ ] **Step 3: 新增 cleanupRef 声明（替换 esRef 用途）**

定位 line 53 `const esRef = useRef<EventSource | null>(null);`，在其下方追加一行：

```ts
  const cleanupRef = useRef<(() => void) | null>(null);
```

（保留 `esRef` 声明不删，避免牵动其它引用；它将不再被赋值。）

- [ ] **Step 4: 替换主 effect 的清理逻辑**

将 line 186-201 的主 effect 替换为：

```ts
  useEffect(() => {
    connect();
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      // 离开画布：清掉 project 上下文（团队连接仍由 useTeamRealtime 维持）
      realtimeClient.setContext({ projectId: null });
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      setConnected(false);
      setConnId(null);
      connIdRef.current = null;
    };
  }, [connect]);
```

- [ ] **Step 5: 替换 `sendCursor` 走 WS 上行**

将 line 218-231 的 `sendCursor` 替换为：

```ts
  const sendCursor = useCallback(
    (x: number, y: number, viewport?: { zoom?: number; offsetX?: number; offsetY?: number }) => {
      const now = Date.now();
      if (now - cursorLastSent.current < CURSOR_THROTTLE_MS) return;
      cursorLastSent.current = now;
      realtimeClient.send({ type: 'cursor', payload: { x, y, viewport } });
    },
    [],
  );
```

- [ ] **Step 6: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS（0 error）。若报 `esRef` 未使用，可忽略（TS 默认不因未使用的 ref 报错）；若严格模式报错，则删除 line 53 的 `esRef` 声明。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useCanvasCollab.ts
git commit -m "feat(collab): canvas cursor/presence/task_status via shared WS client"
```

---

## Task 8: 端到端联调验收（双浏览器）

**Files:** 无（人工验收）

- [ ] **Step 1: 起服务**

Run（两个终端）:
```bash
cd backend && npm run dev
cd frontend && npm run dev
```
Expected: 后端 `API listening on http://localhost:4000`；前端 Vite 启动（如 `http://localhost:5174`）。

- [ ] **Step 2: 单条 WS 验证（连接池不再耗尽）**

打开浏览器 DevTools → Network → WS 过滤。登录后进入一个团队项目画布。
Expected:
- 仅出现 **1 条** `/ws/collab` WS 连接（状态 101 Switching Protocols），不再有 SSE（`stream`）的 pending EventStream。
- 页面不再出现请求长时间 pending 堆积。

- [ ] **Step 3: 三类信号验收（A、B 两个浏览器/隐身窗，同团队同项目）**

Expected:
- **任务状态**：A 触发一次生成，任务完成后 A（及共享该项目的 B）节点状态从 running → succeeded。
- **光标**：A 移动鼠标，B 在 ~10s 内看到 A 的光标（`CollabCursorLayer`）。
- **团队积分**：管理端/充值改该团队积分 → A、B 余额实时更新（无需刷新）。

- [ ] **Step 4: 断线重连验收**

操作：A 连接建立后，重启后端（停止再 `npm run dev`）。
Expected: 前端 WS 断开后按退避自动重连；后端恢复后功能恢复（再次改积分/移动光标可见）。

- [ ] **Step 5: 鉴权验收**

操作：退出登录（无 token）或非团队成员账号进入。
Expected: WS 握手被拒（Network 中 `/ws/collab` 显示 401/403，不建立连接），页面无报错崩溃。

- [ ] **Step 6: 标记完成（无需提交，纯验收）**

若全部通过，本计划实现完成。SSE controller（后端 `team-realtime`/`team-collab` 的 stream 路由）保留休眠，作为回滚退路，后续单独 PR 清理。

---

## 范围外 / 后续

- 节点锁（`claimLock`/`releaseLock`）当前为 no-op；如需协作锁，需把 WS connId 注册到锁校验侧（`team-collab.controller.assertConnAndRate` 现依赖 `CanvasSseManager.hasConn`），属后续。
- `user_credits_changed` 暂无生产端（个人模式积分实时）；如需，另加发布点到 `channelForUser`。
- 多实例部署下 presence 跨实例聚合需额外设计（v1 单实例，与 SSE 现状一致）。
- WS 验证稳定后，单独 PR 删除休眠的 SSE controller 及前端遗留 EventSource 代码（`esRef` 等）。
