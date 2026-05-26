# 团队实时协作 SSE 设计

## 范围

在现有 `team-collab` 基础设施上补完团队实时协作能力，覆盖：

1. 鼠标光标实时同步 + 在线成员列表
2. 生成任务进度广播（项目范围，所有协作者可见）
3. 画布节点增删改实时同步（已有协议骨架，未接入业务）
4. 操作通知 toast

## 关键决策

- 部署：多 Node 实例，跨进程通信走 Redis Pub/Sub
- 冲突策略：客户端 claim/release 锁；拖拽开始锁、拖拽结束/失焦释放；服务端 Redis SETEX TTL 10s + 5s 心跳续租；断线 SSE close 立即释放
- 任务可见性：项目范围
- 写放大才是瓶颈：cursor 服务端合并 + 慢消费者主动断开

## 架构（分层）

```
Client (React)
  useCanvasCollab (SSE 连接、断线重连、seq 去重)
    ├─ usePresence       (cursor 渲染 + 在线列表)
    ├─ useNodeLock       (claim/release/renew + 续租 timer)
    ├─ useTaskBroadcast  (任务进度回调)
    └─ useCollabToast    (toast 通知)
  ↓ SSE / POST
Server (NestJS)
  TeamCollabController
    GET  /canvas/:projectId/stream?after=<seq>   订阅
    POST /canvas/:projectId/patch                节点 patch
    POST /canvas/:projectId/cursor               光标
    POST /canvas/:projectId/lock                 claim
    POST /canvas/:projectId/lock/renew           续租
    POST /canvas/:projectId/unlock               release
  ↓
  CanvasSseManager (transport)
    - 项目级连接表 + 共享心跳调度器（单 timer）
    - 订阅 CollabEventBus，本地转发到 SSE
    - 每连接发送队列上限 + 慢消费者断开
    - cursor 合并（100ms flush）
  ↓
  CollabEventBus (Redis Pub/Sub)
    - 频道 canvas:project:{projectId}
    - publish(projectId, envelope)
    - subscribe(projectId, handler)
  ↑
  CollabEventLog (Redis Streams, 用于重连补帧)
    - XADD canvas:log:{projectId} MAXLEN ~ 500
    - XREAD after=<seq>
  ↑
  NodeLockService (Redis SETEX, TTL 10s)
    - claim / renew / release / releaseByConn
  ↑
  GenerationTaskService （已有，扩展发布 task_status 事件）
```

## 事件协议

### 统一信封

```ts
interface CollabEnvelope<T = unknown> {
  type: 'cursor' | 'node_patch' | 'node_lock' | 'task_status' | 'toast'
      | 'presence_join' | 'presence_leave' | 'access_revoked';
  payload: T;
  ts: number;
  senderConnId?: string;
  senderUserId?: string;
  seq?: number;   // 仅持久事件
}
```

### SSE 帧格式

使用命名事件 + JSON data：

```
event: cursor
id: 0
data: {"type":"cursor","payload":{...},"ts":...,"senderConnId":"..."}

event: task_status
id: 1234
data: {"type":"task_status","payload":{...},"ts":...,"seq":1234}
```

仅持久事件填 `id:` 字段（=seq），客户端用作 `lastEventId` 重连游标。

### 各事件 payload

| type | payload | 频率 | seq | 持久化 |
|------|---------|------|-----|--------|
| `cursor` | `{ userId, name, color, x, y, viewport? }` | ~6/s/人 | 否 | 否 |
| `presence_join` / `presence_leave` | `{ userId, name, color }` | 极低 | 否 | 否 |
| `node_patch` | `{ upsertNodes?, removeNodeIds?, upsertEdges?, removeEdgeIds? }` | 中频 | 是 | Redis Stream + Project.contentJson |
| `node_lock` | `{ nodeId, action, userId, expiresAt }` | 低频 | 否 | Redis SETEX |
| `task_status` | `{ taskId, nodeId?, taskType, status, progress?, resultPreview?, error? }` | 中低频 | 是 | Redis Stream + VideoTask/ImageTask |
| `toast` | `{ userId, name, kind, text }` | 极低 | 否 | 否 |
| `access_revoked` | `{}` | 极低 | 否 | 否，定向单连接 |

### 客户端 → 服务端 REST 命令

```
POST /canvas/:projectId/cursor   { x, y, viewport?, connId }   节流 150ms
POST /canvas/:projectId/patch    { patch, connId }              防抖 200ms
POST /canvas/:projectId/lock     { nodeId, connId }
POST /canvas/:projectId/lock/renew { nodeId, connId }            每 5s
POST /canvas/:projectId/unlock   { nodeId, connId }
```

## 关键机制

### 重连补帧

1. 客户端断线后保留 `lastAppliedSeq`
2. 重连时 SSE URL 带 `?after=<seq>` 或浏览器自动发的 `Last-Event-ID` header
3. 服务端 controller:
   - 若 `after` 有值：先 `XREAD canvas:log:{projectId} from after+1` 推送积压
   - 若积压超过 stream 容量 → 回应 `event: snapshot_required` → 前端拉一次全量 `GET /projects/:id/content`
   - 然后 `SUBSCRIBE canvas:project:{projectId}` 实时
4. 客户端按 `(projectId, seq)` 去重保留最近 200 条

### 写放大与 backpressure

- **共享心跳调度器**：单全局 `setInterval` 50ms tick，扫描所有连接（不再每连接一个 timer）
- **cursor 合并**：每 SSE 连接每发送者维护 latest-cursor buffer，按 tick 节奏 flush（100ms）
- **发送队列**：每连接 maxQueue=1000，超限 → 主动 `unsubscribe(connId)` + 关闭 socket，前端自动重连
- **连接上限**：每用户每项目 2 个连接、每项目 50 个连接
- **限流**：每 connId 每秒最多 10 次 POST（cursor 不受限因为已节流）

### 锁机制

- 客户端拖拽开始 → POST `/lock` → 服务端 `SET canvas:lock:{projectId}:{nodeId} {connId} NX EX 10`
- 持锁期间客户端每 5s 续租 → 服务端 `EXPIRE ... 10`（仅当 GET 值等于 connId 才续）
- 客户端拖拽结束/失焦 → POST `/unlock` → 服务端 DEL（同样校验所有权）
- SSE 断线 → controller 调用 `releaseByConn(projectId, connId)`，扫描 `KEYS canvas:lock:{projectId}:*` 找属于该 connId 的锁批量删除
- 锁动作通过 CollabEventBus 广播 `node_lock` 事件，其他客户端更新 UI（节点边框高亮+用户色）

### Redis 抖动降级

- ioredis 自动重连
- 重连失败超过阈值（如连续 3 次）→ 进入 degraded mode
- degraded mode 下保留本进程内广播能力（写到本进程 Set，不发 Redis）
- 给所有当前连接发 `event: toast` 提示"实时协作降级"
- 恢复后自动退出 degraded mode

### access_revoked

- 现有方法 `kickTeamConnections` 保留，扩展为：
  1. 通过 EventBus 发 `access_revoked` 到目标 connId（payload 含目标 connId）
  2. 立即关闭该 SSE 连接
  3. 释放该用户在该项目所有锁

## 文件清单

### 后端新增/修改

```
backend/src/team-collab/
  types.ts                            [新增] CollabEnvelope + event types
  collab-event-bus.service.ts         [新增] Redis Pub/Sub 抽象
  collab-event-log.service.ts         [新增] Redis Streams 历史
  node-lock.service.ts                [新增] 锁服务
  canvas-sse.manager.ts               [重构] 共享心跳、send queue、cursor coalesce
  team-collab.controller.ts           [扩展] 新增 cursor/lock 等端点 + resume
  team-collab.module.ts               [更新] 注册新 provider

backend/src/ai/services/
  generation-task.service.ts          [扩展] 注入 CollabEventBus，create/update 时发布
backend/src/ai/ai.module.ts           [更新] import TeamCollabModule

backend/src/team-core/
  team-core.service.ts                [可选扩展] 移除成员时调用 access_revoked
```

### 前端新增/修改

```
frontend/src/hooks/
  useCanvasCollab.ts                  [重构] 命名事件分发 + seq 去重 + 重连游标
  usePresence.ts                      [新增] cursor 渲染 + 在线列表 state
  useNodeLock.ts                      [新增] claim/release/renew + 续租 timer
  useTaskBroadcast.ts                 [新增] 任务事件订阅
  useCollabToast.ts                   [新增] toast 订阅

frontend/src/components/canvas/
  CollabCursorLayer.tsx               [新增] 其他人光标渲染层
  CollabPresenceList.tsx              [新增] 在线成员头像列表

frontend/src/pages/Canvas.tsx         [更新] 接入 useCanvasCollab 顶层 hook
```

## 性能预算

- 10 人协作场景：
  - cursor 入站到 Redis ≈ 60 msg/s（已经 150ms 节流）
  - SSE 写放大 ≈ 540 msg/s，cursor 合并后降至 ~ 90 msg/s
  - 节点 patch 防抖 200ms，假设有效编辑频率 1/s/人 = 10 msg/s
  - 每连接 RAM 占用 < 16KB（含缓冲）
- 100 个项目 × 5 协作者 = 500 连接，预估占用 < 8MB + Node socket 开销

## 不在本期范围

- WebSocket 双向通信（保持 SSE + REST 组合，简单可靠）
- 富文本协作（OT/CRDT 算法）
- 跨项目通知中心
- 移动端浏览器测试矩阵

## 风险与回滚

- 风险：Redis Pub/Sub 引入额外依赖。回滚策略：保留 `EventBus.publishLocalOnly()` 路径，未配置 REDIS_URL 时自动 fallback 到内存模式（单实例可用，多实例不可用但不会崩）
- 风险：现有 `useCanvasCollab` 行为变化。回滚策略：保留兼容字段 `peers`，外部 API 不变
- 风险：cursor 频率过高导致 Node 卡顿。回滚策略：cursor 合并间隔可配置（环境变量 `COLLAB_CURSOR_FLUSH_MS`），默认 100ms 可调高
