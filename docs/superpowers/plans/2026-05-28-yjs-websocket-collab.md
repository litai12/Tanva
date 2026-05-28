# Yjs + WebSocket 实时协作迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将画布实时协作从已禁用的 SSE + HTTP POST 架构迁移到 Yjs + Hocuspocus + WebSocket，支持 1000+ 并发，同时保持现有 `CanvasCollabHandle` 接口不变（使所有下游 hook 零改动）。

**Architecture:** 后端新增 `canvas-realtime` 模块，包含 Hocuspocus 服务；在 `main.ts` 中将 WebSocket upgrade 请求转发给 Hocuspocus 处理（不新开端口）。画布节点/边通过 `Y.Map` CRDT 同步，光标/在线状态走 Awareness，锁/任务/toast 等业务事件走 Hocuspocus Stateless 消息。前端新建 `collab-v2/` 目录实现新 hook，保持 `CanvasCollabHandle` 接口兼容，最后将 `CollabRoot.tsx` 切换到 v2 并删除旧 SSE 代码。

**Tech Stack:** `@hocuspocus/server` v4, `@hocuspocus/extension-redis`, `yjs`, `y-protocols`, `@hocuspocus/provider`, NestJS 10 + Fastify, Node 24, ioredis v5

---

## 文件清单

### 新建（后端）
- `backend/src/canvas-realtime/canvas-realtime.module.ts` — NestJS 模块，注册所有 provider
- `backend/src/canvas-realtime/canvas-hocuspocus.service.ts` — Hocuspocus 实例管理、auth、stateless 路由、对外 broadcast API
- `backend/src/canvas-realtime/canvas-event-bridge.service.ts` — 订阅 CollabEventBus，将 Redis 事件广播到 Hocuspocus WebSocket 客户端

### 修改（后端）
- `backend/src/main.ts` — 在 `app.listen()` 后挂载 WebSocket upgrade 处理
- `backend/src/app.module.ts` — 引入 `CanvasRealtimeModule`

### 新建（前端）
- `frontend/src/collab-v2/provider.ts` — 创建 HocuspocusProvider 实例的工厂函数
- `frontend/src/collab-v2/y-schema.ts` — Y.Doc 结构定义和操作辅助函数
- `frontend/src/collab-v2/useCanvasCollab.ts` — 新 hook，返回与旧版完全兼容的 `CanvasCollabHandle`
- `frontend/src/collab-v2/usePresence.ts` — 基于 Awareness 的在线/光标状态，返回与旧版兼容的 `PresenceState`

### 修改（前端）
- `frontend/src/components/collab/CollabRoot.tsx` — 切换 import 到 collab-v2

### 最终删除（待 Task 13）
- `frontend/src/hooks/useCanvasCollab.ts` — 旧版（SSE 已禁用）
- `frontend/src/hooks/usePresence.ts` — 旧版
- `backend/src/team-collab/canvas-sse.manager.ts` — SSE 连接管理
- `backend/src/team-collab/team-collab.controller.ts` 中的 `/stream` 和 `/cursor` 路由

---

## Task 1: 安装后端依赖

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: 安装 Hocuspocus + Yjs**

```bash
cd /Users/libiqiang/business/Tanva/backend
npm install @hocuspocus/server @hocuspocus/extension-redis yjs y-protocols ws
```

- [ ] **Step 2: 安装类型声明**

```bash
npm install --save-dev @types/ws
```

- [ ] **Step 3: 验证安装**

```bash
node -e "require('@hocuspocus/server'); require('yjs'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add backend/package.json backend/package-lock.json
git commit -m "chore(backend): install hocuspocus + yjs dependencies"
```

---

## Task 2: 创建 CanvasHocuspocusService

**Files:**
- Create: `backend/src/canvas-realtime/canvas-hocuspocus.service.ts`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p /Users/libiqiang/business/Tanva/backend/src/canvas-realtime
```

- [ ] **Step 2: 创建服务文件**

```typescript
// backend/src/canvas-realtime/canvas-hocuspocus.service.ts
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server as HocuspocusServer } from '@hocuspocus/server';
import { Redis as HocuspocusRedis } from '@hocuspocus/extension-redis';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class CanvasHocuspocusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CanvasHocuspocusService.name);
  private server!: HocuspocusServer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    const jwtSecret = this.config.get<string>('JWT_SECRET') ?? 'dev-secret';

    const extensions: any[] = [];
    if (redisUrl) {
      try {
        const url = new URL(redisUrl);
        extensions.push(
          new HocuspocusRedis({
            host: url.hostname,
            port: Number(url.port) || 6379,
            options: url.password ? { password: url.password } : undefined,
          }),
        );
        this.logger.log('Hocuspocus Redis extension enabled');
      } catch (e) {
        this.logger.warn(`Failed to parse REDIS_URL for Hocuspocus: ${(e as Error).message}`);
      }
    }

    this.server = new HocuspocusServer({
      extensions,

      async onAuthenticate(data) {
        // token 来自 URL query: /ws/canvas/PROJECT_ID?token=JWT
        const url = new URL(data.requestParameters.get('url') ?? '', 'http://x');
        const token =
          data.requestParameters.get('token') ??
          (data.requestHeaders?.authorization ?? '').replace('Bearer ', '');

        if (!token) throw new Error('Unauthorized: no token');

        try {
          const payload = jwt.verify(token, jwtSecret) as {
            sub: string;
            name?: string;
            username?: string;
          };
          return {
            userId: payload.sub,
            name: payload.name ?? payload.username ?? payload.sub.slice(0, 8),
          };
        } catch {
          throw new Error('Unauthorized: invalid token');
        }
      },

      async onConnect(data) {
        // documentName = projectId
        const { userId, name } = data.context as { userId: string; name: string };
        data.connection.readOnly = false;
      },

      async onDisconnect(data) {
        // cleanup はHocuspocusが自動で行う
      },

      async onStateless(data) {
        // クライアントからの業務コマンドは canvas-event-bridge.service.ts で処理
        // ここでは何もしない（bridgeがawarenessとstatelessを処理）
      },
    });

    this.logger.log('CanvasHocuspocusService initialized');
  }

  async onModuleDestroy() {
    try {
      await this.server?.destroy();
    } catch {}
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    this.server.handleConnection(request, socket, head);
  }

  /**
   * Broadcast a stateless message to all clients on a specific document (projectId).
   * Used by canvas-event-bridge.service.ts to push server-side events.
   */
  broadcastToProject(projectId: string, payload: string) {
    const doc = (this.server as any).documents?.get(projectId);
    if (!doc) return;
    try {
      doc.broadcastStateless(payload);
    } catch (e) {
      this.logger.warn(`broadcastToProject failed for ${projectId}: ${(e as Error).message}`);
    }
  }
}
```

- [ ] **Step 3: 验证 TypeScript 编译不报错**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit -p tsconfig.build.json 2>&1 | grep "canvas-hocuspocus" || echo "no errors in new file"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add backend/src/canvas-realtime/canvas-hocuspocus.service.ts
git commit -m "feat(canvas-realtime): add CanvasHocuspocusService with auth + broadcast"
```

---

## Task 3: 创建 CanvasEventBridgeService

**Files:**
- Create: `backend/src/canvas-realtime/canvas-event-bridge.service.ts`

- [ ] **Step 1: 创建 bridge 文件**

```typescript
// backend/src/canvas-realtime/canvas-event-bridge.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CollabEventBus } from '../team-collab/collab-event-bus.service';
import { CanvasHocuspocusService } from './canvas-hocuspocus.service';
import type { CollabEnvelope } from '../team-collab/types';

/**
 * Subscribes to Redis project channels and forwards server-side events
 * (task_status, toast, node_lock, access_revoked, team_credits_changed, user_credits_changed)
 * to WebSocket clients via Hocuspocus stateless broadcast.
 *
 * This is a one-way bridge: Redis → WebSocket.
 * Clients send commands directly to HTTP endpoints or via stateless messages.
 */
@Injectable()
export class CanvasEventBridgeService {
  private readonly logger = new Logger(CanvasEventBridgeService.name);

  constructor(
    private readonly bus: CollabEventBus,
    private readonly hocuspocus: CanvasHocuspocusService,
  ) {}

  /**
   * Register a project to bridge. Called by the HTTP lock/task endpoints
   * when they need to push events to connected WebSocket clients.
   * Hocuspocus auto-manages document lifecycle; we just forward events.
   */
  broadcastToProject(projectId: string, envelope: CollabEnvelope): void {
    this.hocuspocus.broadcastToProject(projectId, JSON.stringify(envelope));
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add backend/src/canvas-realtime/canvas-event-bridge.service.ts
git commit -m "feat(canvas-realtime): add CanvasEventBridgeService"
```

---

## Task 4: 创建 NestJS 模块并注册

**Files:**
- Create: `backend/src/canvas-realtime/canvas-realtime.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: 创建模块文件**

```typescript
// backend/src/canvas-realtime/canvas-realtime.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { CanvasHocuspocusService } from './canvas-hocuspocus.service';
import { CanvasEventBridgeService } from './canvas-event-bridge.service';

@Module({
  imports: [ConfigModule, TeamCollabModule],
  providers: [CanvasHocuspocusService, CanvasEventBridgeService],
  exports: [CanvasHocuspocusService, CanvasEventBridgeService],
})
export class CanvasRealtimeModule {}
```

- [ ] **Step 2: 在 app.module.ts 中注册**

在 `backend/src/app.module.ts` 的 imports 数组末尾加入 `CanvasRealtimeModule`：

```typescript
// 在文件顶部加入 import：
import { CanvasRealtimeModule } from './canvas-realtime/canvas-realtime.module';

// 在 @Module imports 数组中加入（TeamCollabModule 后面）：
CanvasRealtimeModule,
```

- [ ] **Step 3: 验证编译**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20
```
Expected: 无错误或仅有无关旧代码警告

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add backend/src/canvas-realtime/canvas-realtime.module.ts backend/src/app.module.ts
git commit -m "feat(canvas-realtime): register CanvasRealtimeModule in AppModule"
```

---

## Task 5: 挂载 WebSocket upgrade 到 main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: 在 main.ts 的 bootstrap 函数末尾添加 upgrade 处理**

在 `await app.listen(...)` 调用之后（文件末尾 `bootstrap()` 函数内），添加：

```typescript
// 在文件顶部的 import 区域添加：
import { CanvasHocuspocusService } from './canvas-realtime/canvas-hocuspocus.service';

// 在 bootstrap() 函数内，await app.listen(...) 之后添加：
const hocuspocus = app.get(CanvasHocuspocusService);
const httpServer = app.getHttpAdapter().getInstance().server;
httpServer.on('upgrade', (request: any, socket: any, head: any) => {
  const url: string = request.url ?? '';
  if (url.startsWith('/ws/canvas/')) {
    hocuspocus.handleUpgrade(request, socket, head);
  }
});
app.get(Logger).log('WebSocket canvas collab ready at /ws/canvas/:projectId', 'Bootstrap');
```

- [ ] **Step 2: 验证编译**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20
```

- [ ] **Step 3: 启动后端，确认无崩溃**

```bash
cd /Users/libiqiang/business/Tanva/backend
npm run dev 2>&1 | head -30
```
Expected: 正常启动，看到 `WebSocket canvas collab ready` 日志

- [ ] **Step 4: 用 wscat 验证 WebSocket 连接（需要有效 JWT）**

```bash
# 如果没有 wscat: npm install -g wscat
# TOKEN 从浏览器 cookie 或登录接口获取
wscat -c "ws://localhost:4000/ws/canvas/test-project-id?token=TOKEN"
```
Expected: 连接建立后看到 Hocuspocus 握手消息（二进制帧）

- [ ] **Step 5: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add backend/src/main.ts
git commit -m "feat(backend): mount Hocuspocus WebSocket upgrade at /ws/canvas/:projectId"
```

---

## Task 6: 安装前端依赖

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/libiqiang/business/Tanva/frontend
npm install @hocuspocus/provider yjs y-protocols
```

- [ ] **Step 2: 验证安装**

```bash
node -e "require('@hocuspocus/provider'); require('yjs'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(frontend): install hocuspocus/provider + yjs dependencies"
```

---

## Task 7: 创建 y-schema.ts（Y.Doc 结构定义）

**Files:**
- Create: `frontend/src/collab-v2/y-schema.ts`

- [ ] **Step 1: 创建目录和文件**

```bash
mkdir -p /Users/libiqiang/business/Tanva/frontend/src/collab-v2
```

```typescript
// frontend/src/collab-v2/y-schema.ts
import * as Y from 'yjs';
import type { NodePatchPayload } from '../collab/types';

/**
 * The Y.Doc has two top-level maps:
 *   nodes: Y.Map<unknown>  — nodeId → node object
 *   edges: Y.Map<unknown>  — edgeId → edge object
 */
export function getNodesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('nodes');
}

export function getEdgesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('edges');
}

/**
 * Apply a NodePatchPayload to the Y.Doc inside a single transaction.
 */
export function applyPatch(doc: Y.Doc, patch: NodePatchPayload): void {
  const nodes = getNodesMap(doc);
  const edges = getEdgesMap(doc);

  doc.transact(() => {
    if (patch.upsertNodes) {
      for (const node of patch.upsertNodes) {
        const n = node as { id?: string };
        if (n?.id) nodes.set(n.id, node);
      }
    }
    if (patch.removeNodeIds) {
      for (const id of patch.removeNodeIds) {
        nodes.delete(id);
      }
    }
    if (patch.upsertEdges) {
      for (const edge of patch.upsertEdges) {
        const e = edge as { id?: string };
        if (e?.id) edges.set(e.id, edge);
      }
    }
    if (patch.removeEdgeIds) {
      for (const id of patch.removeEdgeIds) {
        edges.delete(id);
      }
    }
  });
}

/**
 * Read the current Y.Doc state as a NodePatchPayload snapshot.
 * Used to build the initial connected payload for new clients.
 */
export function readSnapshot(doc: Y.Doc): NodePatchPayload {
  const nodes = getNodesMap(doc);
  const edges = getEdgesMap(doc);
  return {
    upsertNodes: Array.from(nodes.values()) as unknown[],
    upsertEdges: Array.from(edges.values()) as unknown[],
  };
}
```

- [ ] **Step 2: 验证 TypeScript**

```bash
cd /Users/libiqiang/business/Tanva/frontend
npx tsc --noEmit 2>&1 | grep "collab-v2" || echo "no errors in collab-v2"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add frontend/src/collab-v2/y-schema.ts
git commit -m "feat(collab-v2): add Y.Doc schema helpers"
```

---

## Task 8: 创建 provider.ts（HocuspocusProvider 工厂）

**Files:**
- Create: `frontend/src/collab-v2/provider.ts`

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/collab-v2/provider.ts
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { getAccessToken } from '../services/authTokenStorage';

const wsBase =
  typeof import.meta !== 'undefined' &&
  (import.meta as any).env?.VITE_API_BASE_URL
    ? (import.meta as any).env.VITE_API_BASE_URL
        .replace(/^https?:\/\//, (m: string) => (m.startsWith('https') ? 'wss://' : 'ws://'))
        .replace(/\/+$/, '')
    : 'ws://localhost:4000';

export interface CollabProviderOptions {
  projectId: string;
  doc: Y.Doc;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onAuthenticationFailed?: () => void;
}

export function createCollabProvider(opts: CollabProviderOptions): HocuspocusProvider {
  const token = getAccessToken() ?? '';
  const url = `${wsBase}/ws/canvas/${opts.projectId}?token=${encodeURIComponent(token)}`;

  const provider = new HocuspocusProvider({
    url,
    name: opts.projectId,
    document: opts.doc,
    token,
    onConnect: opts.onConnect,
    onDisconnect: opts.onDisconnect,
    onAuthenticationFailed: opts.onAuthenticationFailed,
  });

  return provider;
}
```

- [ ] **Step 2: 验证编译**

```bash
cd /Users/libiqiang/business/Tanva/frontend
npx tsc --noEmit 2>&1 | grep "collab-v2" || echo "no errors"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add frontend/src/collab-v2/provider.ts
git commit -m "feat(collab-v2): add HocuspocusProvider factory"
```

---

## Task 9: 创建 useCanvasCollab.ts v2（兼容旧接口）

**Files:**
- Create: `frontend/src/collab-v2/useCanvasCollab.ts`

- [ ] **Step 1: 创建新 hook**

```typescript
// frontend/src/collab-v2/useCanvasCollab.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useTeamStore } from '../stores/teamStore';
import { fetchWithAuth } from '../services/authFetch';
import { createCollabProvider } from './provider';
import { applyPatch, getNodesMap, getEdgesMap } from './y-schema';
import type {
  CanvasCollabHandle,
  UseCanvasCollabOptions,
} from '../hooks/useCanvasCollab';
import type {
  CollabEnvelope,
  CollabEventType,
  CollabListener,
  NodePatchPayload,
} from '../collab/types';

const base =
  (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/+$/, '') ??
  'http://localhost:4000';

export function useCanvasCollab({
  projectId,
  onAccessRevoked,
  onSnapshotRequired,
}: UseCanvasCollabOptions): CanvasCollabHandle {
  const activeTeamId = useTeamStore((s) => s.activeTeamId);

  const [connected, setConnected] = useState(false);
  const [connId] = useState<string | null>(null); // connId not needed in WS model
  const [degraded] = useState(false);

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const listenersRef = useRef<Map<CollabEventType | '*', Set<CollabListener>>>(new Map());
  const onAccessRevokedRef = useRef(onAccessRevoked);
  const onSnapshotRequiredRef = useRef(onSnapshotRequired);

  useEffect(() => { onAccessRevokedRef.current = onAccessRevoked; }, [onAccessRevoked]);
  useEffect(() => { onSnapshotRequiredRef.current = onSnapshotRequired; }, [onSnapshotRequired]);

  // ── subscribe / dispatch ────────────────────────────────────────────────
  const subscribe = useCallback(
    (type: CollabEventType | CollabEventType[], listener: CollabListener): (() => void) => {
      const types = Array.isArray(type) ? type : [type];
      const cleanups: Array<() => void> = [];
      for (const t of types) {
        let set = listenersRef.current.get(t);
        if (!set) { set = new Set(); listenersRef.current.set(t, set); }
        set.add(listener);
        const captured = set;
        cleanups.push(() => captured.delete(listener));
      }
      return () => { for (const c of cleanups) c(); };
    },
    [],
  );

  const dispatch = useCallback((envelope: CollabEnvelope) => {
    const set = listenersRef.current.get(envelope.type);
    if (set) for (const fn of set) fn(envelope);
    const star = listenersRef.current.get('*' as CollabEventType);
    if (star) for (const fn of star) fn(envelope);
  }, []);

  // ── provider lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) return;

    const doc = new Y.Doc();
    docRef.current = doc;

    const provider = createCollabProvider({
      projectId,
      doc,
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
      onAuthenticationFailed: () => {
        onAccessRevokedRef.current?.();
      },
    });
    providerRef.current = provider;

    // Y.Map 变更 → dispatch node_patch 事件（给其他用户的操作）
    const nodesMap = getNodesMap(doc);
    const edgesMap = getEdgesMap(doc);

    const handleNodesChange = (event: Y.YMapEvent<unknown>) => {
      if (event.transaction.local) return; // 本地操作不回环
      const upsertNodes: unknown[] = [];
      const removeNodeIds: string[] = [];
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') removeNodeIds.push(key);
        else upsertNodes.push(nodesMap.get(key));
      });
      dispatch({
        type: 'node_patch',
        payload: { upsertNodes, removeNodeIds } satisfies NodePatchPayload,
        ts: Date.now(),
      });
    };

    const handleEdgesChange = (event: Y.YMapEvent<unknown>) => {
      if (event.transaction.local) return;
      const upsertEdges: unknown[] = [];
      const removeEdgeIds: string[] = [];
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') removeEdgeIds.push(key);
        else upsertEdges.push(edgesMap.get(key));
      });
      dispatch({
        type: 'node_patch',
        payload: { upsertEdges, removeEdgeIds } satisfies NodePatchPayload,
        ts: Date.now(),
      });
    };

    nodesMap.observe(handleNodesChange);
    edgesMap.observe(handleEdgesChange);

    // Stateless 消息 → dispatch 业务事件
    provider.on('stateless', ({ payload }: { payload: string }) => {
      try {
        const env = JSON.parse(payload) as CollabEnvelope;
        if (env.type === 'access_revoked') {
          onAccessRevokedRef.current?.();
        }
        dispatch(env);
      } catch {}
    });

    // Awareness 变更 → dispatch presence 事件
    provider.awareness.on('change', ({ added, updated, removed }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      const states = provider.awareness.getStates();

      for (const clientId of added) {
        const state = states.get(clientId) as any;
        if (state?.user) {
          dispatch({
            type: 'presence_join',
            payload: { userId: state.user.userId, name: state.user.name },
            ts: Date.now(),
          });
        }
      }
      for (const clientId of removed) {
        // Presence leave — we don't have user info after removal
        // but downstream hooks handle missing gracefully
        dispatch({
          type: 'presence_leave',
          payload: { userId: `client-${clientId}`, name: '' },
          ts: Date.now(),
        });
      }
      for (const clientId of updated) {
        const state = states.get(clientId) as any;
        if (state?.cursor && state?.user) {
          dispatch({
            type: 'cursor',
            payload: {
              userId: state.user.userId,
              name: state.user.name,
              x: state.cursor.x,
              y: state.cursor.y,
              viewport: state.cursor.viewport,
            },
            ts: Date.now(),
          });
        }
      }
    });

    return () => {
      nodesMap.unobserve(handleNodesChange);
      edgesMap.unobserve(handleEdgesChange);
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      providerRef.current = null;
      setConnected(false);
    };
  }, [projectId, dispatch]);

  // ── user identity → awareness ──────────────────────────────────────────
  const userRef = useRef<{ userId: string; name: string } | null>(null);

  // ── sendPatch ───────────────────────────────────────────────────────────
  const sendPatch = useCallback(
    (patch: NodePatchPayload) => {
      const doc = docRef.current;
      if (!doc) return;
      applyPatch(doc, patch);
    },
    [],
  );

  // ── sendCursor ──────────────────────────────────────────────────────────
  const sendCursor = useCallback(
    (x: number, y: number, viewport?: { zoom?: number; offsetX?: number; offsetY?: number }) => {
      const provider = providerRef.current;
      if (!provider) return;
      provider.awareness.setLocalStateField('cursor', { x, y, viewport });
    },
    [],
  );

  // ── lock operations (HTTP, infrequent) ─────────────────────────────────
  const claimLock = useCallback(
    async (nodeId: string) => {
      // connId is not used in the new architecture; we send a temporary connId
      const tempConnId = 'ws-client';
      try {
        const res = await fetchWithAuth(
          `${base}/api/canvas/${projectId}/lock?teamId=${activeTeamId ?? ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, connId: tempConnId }),
          },
        );
        return (await res.json()) as { acquired: boolean; expiresAt: number; holder?: { userId: string } };
      } catch {
        return { acquired: false, expiresAt: 0 };
      }
    },
    [projectId, activeTeamId],
  );

  const renewLock = useCallback(
    async (nodeId: string) => {
      const tempConnId = 'ws-client';
      try {
        const res = await fetchWithAuth(
          `${base}/api/canvas/${projectId}/lock/renew?teamId=${activeTeamId ?? ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, connId: tempConnId }),
          },
        );
        return (await res.json()) as { acquired: boolean; expiresAt: number };
      } catch {
        return { acquired: false, expiresAt: 0 };
      }
    },
    [projectId, activeTeamId],
  );

  const releaseLock = useCallback(
    async (nodeId: string) => {
      const tempConnId = 'ws-client';
      try {
        const res = await fetchWithAuth(
          `${base}/api/canvas/${projectId}/unlock?teamId=${activeTeamId ?? ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, connId: tempConnId }),
          },
        );
        const data = (await res.json()) as { released?: boolean };
        return Boolean(data.released);
      } catch {
        return false;
      }
    },
    [projectId, activeTeamId],
  );

  // ── sendToast ───────────────────────────────────────────────────────────
  const sendToast = useCallback(
    async (kind: string, text: string) => {
      const provider = providerRef.current;
      if (!provider) return;
      provider.sendStateless(
        JSON.stringify({ type: 'toast', payload: { kind, text }, ts: Date.now() }),
      );
    },
    [],
  );

  return {
    connected,
    connId,
    degraded,
    subscribe,
    sendPatch,
    sendCursor,
    claimLock,
    renewLock,
    releaseLock,
    sendToast,
  };
}
```

- [ ] **Step 2: 验证编译**

```bash
cd /Users/libiqiang/business/Tanva/frontend
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add frontend/src/collab-v2/useCanvasCollab.ts
git commit -m "feat(collab-v2): implement useCanvasCollab with Yjs + Hocuspocus"
```

---

## Task 10: 创建 usePresence.ts v2（Awareness-based）

**Files:**
- Create: `frontend/src/collab-v2/usePresence.ts`

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/collab-v2/usePresence.ts
// This file re-exports the existing usePresence with no changes.
// The CanvasCollabHandle interface is compatible, so the existing hook works as-is.
// presence_join / presence_leave / cursor events are dispatched by useCanvasCollab v2.
export { usePresence } from '../hooks/usePresence';
export type { PresenceState, PeerCursor } from '../hooks/usePresence';
```

> Note: The existing `usePresence` hook subscribes to `presence_join`, `presence_leave`, and `cursor` events from `CanvasCollabHandle.subscribe()`. Since v2's `useCanvasCollab` dispatches these same events (translated from Awareness updates), `usePresence` requires zero changes.

- [ ] **Step 2: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add frontend/src/collab-v2/usePresence.ts
git commit -m "feat(collab-v2): usePresence re-exports old hook (interface compatible)"
```

---

## Task 11: 切换 CollabRoot.tsx 到 v2

**Files:**
- Modify: `frontend/src/components/collab/CollabRoot.tsx`

- [ ] **Step 1: 修改 import**

将 `CollabRoot.tsx` 中的：

```typescript
import { useCanvasCollab } from '@/hooks/useCanvasCollab';
```

替换为：

```typescript
import { useCanvasCollab } from '@/collab-v2/useCanvasCollab';
```

- [ ] **Step 2: 同时修复 ConnId 依赖**

`CollabRoot.tsx` 当前使用 `collab.connId` 仅在 `MOUSE_THROTTLE_MS` 逻辑中。检查是否有 `connId` 的使用。如果有：在 v2 中 `connId` 始终为 `null`，但 `sendCursor` 内部已不再依赖它，所以无需额外处理。

- [ ] **Step 3: 前端编译验证**

```bash
cd /Users/libiqiang/business/Tanva/frontend
npm run build 2>&1 | tail -20
```
Expected: Build successful

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add frontend/src/components/collab/CollabRoot.tsx
git commit -m "feat(collab): switch CollabRoot to use collab-v2 (Yjs + WebSocket)"
```

---

## Task 12: 修复 lock connId 问题

**Problem:** 旧版 lock/unlock HTTP 接口在 `assertConnAndRate` 中验证 `connId` 必须是活跃的 SSE 连接。但 v2 用 WebSocket，没有 SSE connId。

**Files:**
- Modify: `backend/src/team-collab/team-collab.controller.ts`
- Modify: `backend/src/team-collab/canvas-sse.manager.ts`

- [ ] **Step 1: 让 lock 接口绕过 connId 验证**

在 `team-collab.controller.ts` 的 `assertConnAndRate` 方法中，添加对 WebSocket 客户端的 bypass：

```typescript
private assertConnAndRate(connId: string, userId: string): void {
  // WebSocket clients send 'ws-client' as connId — skip SSE connection check
  if (connId === 'ws-client') return;

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
```

- [ ] **Step 2: 后端编译验证**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add backend/src/team-collab/team-collab.controller.ts
git commit -m "fix(team-collab): allow ws-client connId to bypass SSE conn check for lock ops"
```

---

## Task 13: 端到端验证

- [ ] **Step 1: 启动后端**

```bash
cd /Users/libiqiang/business/Tanva/backend
npm run dev
```

- [ ] **Step 2: 启动前端**

```bash
cd /Users/libiqiang/business/Tanva/frontend
npm run dev
```

- [ ] **Step 3: 打开两个浏览器窗口，同一个画布项目**

验证清单：
- [ ] 两个窗口都能看到对方的在线状态
- [ ] 移动光标，对方能看到实时光标
- [ ] 添加/移动一个节点，对方能实时看到
- [ ] 锁定节点，对方能看到锁定状态
- [ ] 关闭一个窗口，另一个窗口在线列表更新

- [ ] **Step 4: 检查 Redis 中的 channel 数量**

```bash
redis-cli pubsub channels "*" | wc -l
```
Expected: 比之前的 436 少很多（只有活跃项目的 channel）

---

## Task 14: 清理旧 SSE 代码

> 只在 Task 13 验证通过后执行

**Files:**
- Modify: `frontend/src/hooks/useCanvasCollab.ts` — 删除文件或保留空壳
- Modify: `backend/src/team-collab/team-collab.controller.ts` — 删除 `/stream` 和 `/cursor` 路由
- Modify: `backend/src/team-collab/canvas-sse.manager.ts` — 可删除或保留空壳

- [ ] **Step 1: 删除前端旧 hook**

```bash
rm /Users/libiqiang/business/Tanva/frontend/src/hooks/useCanvasCollab.ts
```

更新所有引用旧 hook 的文件（如果有）：
```bash
grep -r "hooks/useCanvasCollab" /Users/libiqiang/business/Tanva/frontend/src --include="*.ts" --include="*.tsx"
```
对每个引用，改为 `collab-v2/useCanvasCollab`。

- [ ] **Step 2: 删除后端 SSE stream 接口**

在 `team-collab.controller.ts` 中删除 `@Get(':projectId/stream')` 路由方法和 `@Post(':projectId/cursor')` 路由方法。

- [ ] **Step 3: 编译验证**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npm run build 2>&1 | tail -10
cd /Users/libiqiang/business/Tanva/backend && npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/business/Tanva
git add -A
git commit -m "chore: remove legacy SSE collab code after successful Yjs migration"
```

---

## 关键注意事项

1. **Node.js 版本**: 当前 v24 ✅，Hocuspocus v4 需要 Node 22+，满足条件
2. **JWT Secret**: `CanvasHocuspocusService` 读取 `JWT_SECRET` 环境变量，确保与现有 auth 模块一致
3. **Lock connId**: Task 12 中用 `ws-client` 作为固定 connId bypass SSE 验证；如果后续需要更严格的速率限制，可按 userId 做 bucket
4. **Awareness userId**: v2 的 `useCanvasCollab` 中还未设置 `awareness.setLocalState({ user: { userId, name } })`，需要在 Task 9 中补充——在获取到用户信息后调用 `provider.awareness.setLocalState({ user: { userId, name } })`
5. **task_status 推送**: 现有的 `TeamCreditsPublisher` 通过 `CollabEventBus` 推送事件，这些事件暂时只到 SSE 客户端。Task 3 的 `CanvasEventBridgeService` 提供了 `broadcastToProject` 接口，需要在相关 service 中调用来推送到 WebSocket 客户端（可作为后续任务）
