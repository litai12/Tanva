# 实时协作：WebSocket 传输设计

**日期**: 2026-05-28
**状态**: 待实现
**取代**: `2026-05-26-team-realtime-collab-sse-design.md`（SSE 方案，已禁用）

## 背景与动机

现有实时协作走 SSE（`text/event-stream`），由两个 controller 提供：

- `team-realtime.controller.ts` — 团队/个人积分变更（`team:{id}` / `user:{id}` 频道）
- `team-collab.controller.ts` — 画布 cursor / presence / task_status / 节点锁

前端 hook（`useTeamRealtime`、`useCanvasCollab`）于 2026-05-28 被临时禁用（顶部 `return;`），原因：SSE 是长连接，浏览器对同源 HTTP/1.1 仅 ~6 个连接，多条 SSE + 自动重连 + 其它请求会把连接池占满，导致前端整体挂起。

**目标**：用 **单条 WebSocket** 连接替代 SSE，只推送三类信号——积分变更、对端光标、任务/节点状态。WebSocket 不受 HTTP/1.1 同源连接数限制，从根本上避开连接池耗尽问题。

## 范围

**做**：
- 后端新增 WS 网关（用已安装的 `ws` 包 + Fastify `upgrade`），复用 `CollabEventBus`。
- 前端把两个 SSE hook 合并为一个 `useRealtime` WS hook。
- v1 转发信号：`team_credits_changed`、`cursor`、`task_status`、`presence_join`/`presence_leave`。
- 光标上行（客户端经 WS 上报自己的光标，由网关广播给同项目对端）。
- presence 由 **WS 连接生命周期**驱动（见「presence」一节）。

**v1 不做 / 待生产端**：
- `user_credits_changed`：**当前没有任何生产端**（核对后确认：`TeamCreditsPublisher.publish()` 只发 `team_credits_changed` 到 `channelForTeam`；`team-credits.service.ts`、`payment.service.ts`、`admin.service.ts` 的调用点全是 team 维度）。因此个人模式积分实时**v1 不做**——个人积分仍走前端现有的 `refresh-credits` 轮询/事件。WS 仍订阅 `user:{userId}` 频道并对 `user_credits_changed` 放行（零成本、面向未来），但在补上生产端之前不会触发。

**不做（范围外）**：
- CRDT 文档协作 / 多人同时编辑（`sendPatch`）——明确不做。
- 节点锁（`claimLock` / `releaseLock`）——保留现有 HTTP 请求-响应接口，不进 WS。
- 事件生产端不改动（见下「关键事实」）。

**技术选型结论**：用 `ws` + Fastify upgrade，**不**用 `@hocuspocus/server` + Yjs。后者是 CRDT 文档协作栈，适合多人编辑，对"积分/状态推送"是过度设计且不匹配。两次独立分析（人工 + codex）一致得出此结论。

## 关键事实（已核对）

三类信号**已经**publish 到对应的 bus 频道，WS 网关只需订阅转发，**无需改动任何生产端**：

| 信号 | 频道 | 生产端 |
|---|---|---|
| `team_credits_changed` | `channelForTeam(teamId)` | ✅ 已存在 `team-credits-publisher.service.ts:63`（topup/admin/reserve/deduct/release 均经此） |
| `task_status` | `channelForProject(projectId)` | ✅ 已存在 `image-task.service.ts:108` |
| `cursor` | `channelForProject(projectId)` | ⚠️ 现由 cursor HTTP 接口产生；本设计改为经 WS 上行（见「光标上行」），HTTP cursor 接口可后续删 |
| `presence_join`/`presence_leave` | `channelForProject(projectId)` | ⚠️ 现**仅**由 `CanvasSseManager.subscribe/unsubscribe` 产生（`canvas-sse.manager.ts:66-155`），唯一调用方是 SSE controller。SSE 移除后**必须由 WS 连接生命周期接管**（见「presence」） |
| `user_credits_changed` | `channelForUser(userId)` | ❌ **无生产端**，v1 不触发（见「v1 不做」） |

`CollabEventBus` API：`publishTo(channel, envelope)`、`subscribeTo(channel, handler) => unsub`；Redis pub/sub，无 Redis 时退化为进程内分发。频道助手：`channelForProject`、`channelForTeam`、`channelForUser`（`collab-event-bus.service.ts`）。

Envelope 形状（沿用 `team-collab/types.ts`）：`{ type, payload, ts, senderConnId?, senderUserId?, seq? }`。

## 架构

```
浏览器(1 条 WS) ──/ws/collab?token&teamId&projectId──▶ Fastify upgrade
                                                          │ JWT 校验 → userId
                                                          ▼
                                                   WsCollabGateway
                                          subscribeTo(user:{userId})  ─┐
                                          subscribeTo(team:{teamId})  ─┤→ envelope 原样写回 socket
                                          subscribeTo(canvas:project:{projectId}) ┘
                              ◀── 光标上行(client→server) → publishTo(project) → 广播对端
```

### 后端组件

**`WsCollabGateway`（新增 service，team-collab 模块内）**
- 职责：管理 WS 连接生命周期——鉴权、按连接订阅 bus 频道、转发、心跳、清理。
- 输入接口：`handleUpgrade(request, socket, head)`（由 main.ts 的 upgrade 钩子调用）。
- 依赖：`CollabEventBus`、`JwtService`（或现有 token 校验逻辑）、`PrismaService`（校验 team 成员，沿用 `team-realtime.controller` 的 `assertTeamMember`）。
- 每连接状态：`ws` 实例、`userId`、`teamId`、`projectId`、unsub 列表、`isAlive`(心跳)。

**`main.ts` 接线**（核对后明确，bootstrap 在 `main.ts:154-306`）
- Fastify 实例：`app.getHttpAdapter().getInstance()`；原生 http server：该实例的 `.server`。
- 时机：Nest/Fastify 初始化完成之后、`app.listen()` **之前**挂 `server.on('upgrade', ...)`。
- 一个 `ws` 的 `WebSocketServer({ noServer: true })`；upgrade 钩子里先做**路径判断 + Origin 校验 + 鉴权**，通过后 `wss.handleUpgrade(req, socket, head, ws => gateway.register(ws, ctx))`，否则握手前拒绝（写 `HTTP/1.1 401` 后 `socket.destroy()`）。

### 鉴权（raw upgrade，不能用 Nest Guard）
- `@UseGuards(JwtAuthGuard)` **不会**在裸 `upgrade` listener 上生效，必须**手动**校验。
- query string 带 `token`（JWT）、`teamId`、可选 `projectId`。`jwt.strategy.ts:22-30` 已支持从 query 取 `token`，**复用同一密钥用 `JwtService.verify` 手动校验**。
- 步骤（任一失败 → 握手前拒绝）：① 路径 == `/ws/collab`；② **Origin 白名单**校验（CORS 不保护 WS upgrade，必须显式校验，复用 main.ts 的 CORS origin 配置）；③ `JwtService.verify(token)` → `userId`；④ team 成员校验（沿用 `assertTeamMember`）。
- **安全说明**：query 带 token 会落到日志/浏览器历史/代理记录，属**受限折中**（与现有 SSE 同款做法），非"强安全"；后续可考虑一次性 ticket 换连接。

### 订阅与转发
- 握手成功后订阅：`channelForUser(userId)`、`channelForTeam(teamId)`、（有 projectId 时）`channelForProject(projectId)`。
- handler 收到 envelope → **类型白名单**过滤（固定 4 类：`team_credits_changed`/`user_credits_changed`/`cursor`/`task_status`；`presence_*` 为可选，见「未决」）→ `ws.send(JSON.stringify(envelope))`。
- 回环抑制：转发 `cursor` 时若 `senderUserId === 本连接 userId` 则跳过（自己的光标不回推）。

### 光标上行
- 客户端经 WS 发送 `{ type: 'cursor', payload: {...} }`（沿用 ~10s 限流）。
- 网关收到 inbound `cursor` → 校验 projectId → `publishTo(channelForProject(projectId), envelope)`（带 `senderUserId`）→ 经 bus 广播给同项目其它连接。
- 取代原 HTTP cursor 接口（该接口可后续删除）。

### presence（由 WS 连接生命周期驱动）
- **背景**：`presence_join`/`presence_leave` 现仅在 `CanvasSseManager.subscribe/unsubscribe` 内产生（`canvas-sse.manager.ts:66-155`），唯一调用方是 SSE controller。SSE 移除后若不接管,presence 直接失效。
- **方案**：把 presence 的 join/leave 逻辑做成传输无关——从 `CanvasSseManager` 抽出一个 `PresenceService`（或让 WS 网关直接调用其现有 join/leave 方法）。
  - WS 握手成功且带 `projectId` 时 → 登记该 (connId, userId, projectId) 并 `publish(project, presence_join)`。
  - WS 关闭/`terminate` 时 → 注销并 `publish(project, presence_leave)`。
  - 维护 `project → Set<conn>` 索引,供"当前在线用户"快照（去重 by userId）。
- 同一 userId 多连接（多标签页）：presence 按 userId 去重;最后一个连接关闭才发 `presence_leave`。

### 心跳与重连 / 重复连接 / 切换项目
- 服务端心跳：每 ~25s 对每个 socket `ping()`；维护 `isAlive`，收到 `pong` 置 true；下一轮发现 false 则 `terminate()` 并清理（unsub + presence_leave）。
- 客户端重连：`onclose`/`onerror` 后指数退避（1s→2s→4s→…→上限 30s），复用同一 token/query；页面卸载主动 `close()`。
- **切换 team/project**：客户端**始终只保持一条 WS**。`activeTeamId` 或 `projectId` 变化时 → 关闭旧连接、用新 query 重连（最简单、无半状态）。不做"连内重订阅"的控制消息（YAGNI）。
- **重复连接**：服务端允许同 userId 多连接（多标签页正常）；每条连接独立订阅与清理,presence 去重见上。前端保证单连接,避免重连竞态（旧连接 `close` 后再建新的;用一个 `generation` 计数器丢弃过期 socket 的回调）。

### 前端组件
- 新增 `useRealtime` hook（合并 `useTeamRealtime` + `useCanvasCollab` 的传输层）：
  - 维护单条 `WebSocket`；按 `activeTeamId`/`projectId` 变化重连。
  - `onmessage` 按 `envelope.type` 分发：
    - `*_credits_changed` → 更新积分 store（`patchTeamCredits` / `refresh-credits` 事件）。
    - `cursor` / `presence_*` → 光标层（`CollabCursorLayer` / `usePresence`）。
    - `task_status` → 节点状态更新。
  - 暴露 `sendCursor()`（限流后经 WS 上行）。
- `App.tsx` 挂载 `useRealtime`（替代 `useTeamRealtime()`）；`CollabRoot` 改用同一连接的句柄（光标/presence/toast 仍由它渲染）。

## 数据流（端到端）

1. **积分（团队）**：team 积分服务变更 → `TeamCreditsPublisher.publish` → `publishTo(team)` → bus → 网关 handler → `ws.send` → 前端更新积分 store。（个人 `user_credits_changed` v1 无生产端,不触发。）
2. **任务状态**：`image-task.service` 完成/失败 → `publish(project, task_status)` → bus → 网关 → 前端更新节点状态。
3. **光标（下行）**：对端 `sendCursor` → 网关 publish project → bus → 本端网关 → `ws.send`（非自己）→ 光标层。
4. **光标（上行）**：本端 `sendCursor` → WS inbound → 网关 publish project。

## 错误处理
- 鉴权失败：拒绝握手（不建立连接）。
- Redis 退化：`CollabEventBus` 已内置进程内 fallback；单实例下仍可工作（多实例需 Redis，与 SSE 现状一致）。
- 转发时 `ws.send` 异常：忽略（`close` 事件会触发清理）。
- 连接清理：`close`/`terminate` 时调用所有 unsub，移除心跳。

## 测试与验收
- 双浏览器登录同团队/同项目：
  - A 触发任务完成 → B 看到节点状态更新。
  - A 移动鼠标 → B 看到 A 的光标（~10s 粒度）。
  - 管理端/充值改积分 → 双方积分实时更新。
- 连接数：确认整个 app 对后端只多 **1 条** WS（非每信号一条），不再出现请求 pending 堆积。
- 断线重连：杀后端再起，前端自动重连恢复。
- 鉴权：无 token / 非团队成员 → 握手被拒。

## 迁移与回滚
- 后端旧 SSE controller（`team-realtime`、`team-collab` 的 stream 路由）**先保留休眠**（前端已不连），WS 验证通过后单独 PR 删除。
- 前端 SSE hook 的 `return;` 不恢复；改为接入 `useRealtime`。
- 回滚：WS 出问题时，可临时恢复 SSE hook（去掉 `return;`）作为退路——但需注意这会重新引入连接池风险，仅作短期回滚手段。

## 已核对（原"未决"已解决）
- ✅ `task_status` 已由 task 服务 publish 到 project 频道（`image-task.service.ts:108`），不需新增生产端。
- ✅ `team_credits_changed` 生产端齐全（`team-credits-publisher.service.ts:63`）。
- ✅ Fastify v5 取底层 server：`app.getHttpAdapter().getInstance().server`（见「main.ts 接线」）。
- ✅ `user_credits_changed` **无生产端** → v1 不做，已写入「v1 不做」。
- ✅ presence 必须由 WS 连接生命周期接管 → 已写入「presence」一节。

## 实现时仍需注意
- `JwtService.verify` 要用与 `jwt.strategy.ts` 相同的密钥/配置（从 `ConfigService` 取）。
- Origin 白名单要与 main.ts 现有 CORS origin 列表保持一致（dev: `http://localhost:5174` 等）。
- 多实例部署时 presence 的"在线快照"只反映本进程连接；跨实例 presence 需额外设计（v1 单实例即可，与 SSE 现状一致）。
- 抽 `PresenceService` 时不要破坏 `CanvasSseManager` 现有方法签名（SSE controller 虽休眠但仍在编译）。
