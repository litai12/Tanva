# 团队模式集成设计文档

**日期：** 2026-05-20  
**状态：** 待实现  
**参考来源：** TapCanvas-pro `/apps/hono-api` 团队模块  
**目标项目：** Tanva（NestJS + Fastify + Prisma + PostgreSQL）

---

## 1. 背景与目标

Tanva 目前是完整的个人工具平台（认证、积分、会员、支付、AI、项目），但**完全缺失团队协作功能**。本设计将从 TapCanvas-pro 提取并适配以下五个子系统，全量集成：

| 子系统 | 说明 |
|--------|------|
| 团队管理 | 创建/解散团队、成员管理、角色权限（owner/admin/member）、多团队支持 |
| 项目共享 | 项目共享到团队、共享权限管理、团队可见项目列表 |
| 实时协作 | SSE canvas patch 广播、光标同步、连接池管理 |
| 团队套餐 | 按座位计费的独立团队套餐、月/年续费、定时积分续期 |
| 团队积分消费 | 独立团队积分池（有批次有效期）、预留-扣除-释放三步消费、成员配额管理 |

**关键设计决策：**
- 用户可加入**多个团队**（有别于 TapCanvas 的单团队约束）
- 团队积分**完全独立**于个人积分（复用 CreditLot 有效期机制）
- 实时协作使用 **SSE**（不是 WebSocket）
- 团队套餐与个人会员套餐**完全独立**
- 后端架构：**方案 B 领域分离模块**（5 个 NestJS 模块）

---

## 2. 数据库模型（Prisma）

### 2.1 新增模型

```prisma
// 团队实体
model Team {
  id          String   @id @default(uuid())
  name        String
  ownerId     String
  status      String   @default("active") // active | dissolved
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  memberships    TeamMembership[]
  invites        TeamInvite[]
  projectShares  TeamProjectShare[]
  subscriptions  TeamSubscription[]
  creditAccount  TeamCreditAccount?
}

// 团队成员（多团队：联合主键，无单用户唯一索引）
model TeamMembership {
  teamId              String
  userId              String
  role                String   @default("member") // owner | admin | member
  creditQuotaMonthly  Int?     // null = 不限制
  creditUsedThisCycle Int      @default(0)
  quotaCycleStartAt   DateTime @default(now())
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  team Team @relation(fields: [teamId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@id([teamId, userId])
  @@index([userId])
}

// 邀请（支持邮箱/手机/用户名三种方式）
model TeamInvite {
  id             String    @id @default(uuid())
  teamId         String
  code           String    @unique
  email          String?
  phone          String?
  status         String    @default("pending") // pending | accepted | revoked | expired
  expiresAt      DateTime?
  inviterUserId  String
  acceptedUserId String?
  acceptedAt     DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  team Team @relation(fields: [teamId], references: [id])
}

// 项目共享到团队
model TeamProjectShare {
  projectId      String
  teamId         String
  access         String   @default("edit") // edit（后续可扩展 view）
  sharedByUserId String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  team    Team    @relation(fields: [teamId], references: [id])
  project Project @relation(fields: [projectId], references: [id])

  @@id([projectId, teamId])
}

// 团队积分账户
model TeamCreditAccount {
  id            String   @id @default(uuid())
  teamId        String   @unique
  balance       Int      @default(0)
  frozenBalance Int      @default(0)
  totalEarned   Int      @default(0)
  totalSpent    Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  team   Team               @relation(fields: [teamId], references: [id])
  lots   TeamCreditLot[]
  ledger TeamCreditLedger[]
}

// 团队积分批次（有有效期）
model TeamCreditLot {
  id              String    @id @default(uuid())
  teamCreditAccId String
  amount          Int
  remaining       Int
  expiresAt       DateTime?
  source          String    // subscription_renewal | topup | manual
  sourceRefId     String?
  createdAt       DateTime  @default(now())

  account TeamCreditAccount @relation(fields: [teamCreditAccId], references: [id])
}

// 团队积分账本（幂等操作记录）
model TeamCreditLedger {
  id          String   @id @default(uuid())
  teamAccId   String
  entryType   String   // topup | reserve | deduct | release | subscription_renewal
  amount      Int
  taskId      String?
  taskKind    String?
  actorUserId String?
  note        String?
  createdAt   DateTime @default(now())

  account TeamCreditAccount @relation(fields: [teamAccId], references: [id])

  @@unique([teamAccId, entryType, taskId]) // 幂等约束
}

// 团队套餐定义
model TeamSubscriptionPlan {
  id                     String   @id @default(uuid())
  name                   String
  tier                   String   // starter | pro | enterprise
  priceMonthlyFen        Int
  priceAnnualFen         Int
  creditsPerSeatPerMonth Int
  maxSeats               Int
  minSeats               Int
  features               Json
  sortWeight             Int      @default(0)
  enabled                Boolean  @default(true)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  subscriptions TeamSubscription[]
}

// 团队订阅实例
model TeamSubscription {
  id                  String    @id @default(uuid())
  teamId              String
  planId              String
  billingCycle        String    // monthly | annual
  seatCount           Int
  status              String    @default("active") // active | expired | cancelled
  currentPeriodStart  DateTime
  currentPeriodEnd    DateTime
  nextCreditRenewalAt DateTime
  lastRenewedAt       DateTime?
  creditsPerRenewal   Int       // 缓存值：seatCount × creditsPerSeatPerMonth
  cancelledAt         DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  team Team                 @relation(fields: [teamId], references: [id])
  plan TeamSubscriptionPlan @relation(fields: [planId], references: [id])

  @@index([nextCreditRenewalAt, status])
}
```

### 2.2 扩展现有模型

```prisma
// Project 模型新增反向关系
model Project {
  // ...现有字段
  teamShares TeamProjectShare[]
}

// User 模型新增反向关系
model User {
  // ...现有字段
  teamMemberships TeamMembership[]
}
```

---

## 3. 模块架构

### 3.1 目录结构

```
backend/src/
├── team-core/
│   ├── team-core.module.ts
│   ├── team-core.controller.ts
│   ├── team-core.service.ts
│   ├── team-invite.service.ts
│   └── dto/
│       ├── create-team.dto.ts
│       ├── invite-member.dto.ts
│       └── update-member-role.dto.ts
│
├── team-subscription/
│   ├── team-subscription.module.ts
│   ├── team-subscription.controller.ts
│   ├── team-subscription.service.ts
│   ├── team-subscription-scheduler.service.ts
│   └── dto/
│
├── team-credits/
│   ├── team-credits.module.ts
│   ├── team-credits.controller.ts
│   ├── team-credits.service.ts
│   ├── team-credit-ledger.service.ts
│   └── dto/
│
├── team-collab/
│   ├── team-collab.module.ts
│   ├── team-collab.controller.ts
│   ├── canvas-sse.manager.ts
│   └── dto/
│       └── canvas-patch.dto.ts
│
└── projects/（扩展现有模块）
    ├── projects.service.ts   # 新增 shareWithTeam / unshare / listForTeam
    └── dto/
        └── share-project.dto.ts
```

### 3.2 模块间依赖关系

```
team-core ←──────────── team-subscription
    ↑                        ↑
    └──── team-credits ───────┘
    ↑
projects（扩展）
    ↑
team-collab（独立，仅依赖 projects 权限检查）
```

---

## 4. API 端点

### team-core
```
POST   /teams                               创建团队
GET    /teams                               获取我的所有团队
GET    /teams/:teamId                       团队详情
DELETE /teams/:teamId                       解散团队（owner only，含清理事务）
GET    /teams/:teamId/members               成员列表
PATCH  /teams/:teamId/members/:userId       修改成员角色（owner/admin）
DELETE /teams/:teamId/members/:userId       移除成员（或主动退出）
POST   /teams/:teamId/transfer-ownership    转让所有权（owner only）
POST   /teams/:teamId/invites               创建邀请
GET    /teams/:teamId/invites               邀请列表
DELETE /teams/:teamId/invites/:inviteId     撤销邀请
POST   /invites/:code/accept                接受邀请
```

### team-subscription
```
GET    /team-plans                          套餐列表（公开）
GET    /teams/:teamId/subscription          当前订阅详情
POST   /teams/:teamId/subscription          购买/变更订阅（生成支付订单）
DELETE /teams/:teamId/subscription          取消订阅
```

### team-credits
```
GET    /teams/:teamId/credits               账户余额 + 批次列表
GET    /teams/:teamId/credits/ledger        消费记录（分页）
GET    /teams/:teamId/credits/members       成员本期用量
POST   /teams/:teamId/credits/topup         充值（生成支付订单）
PATCH  /teams/:teamId/members/:userId/quota 设置成员月配额
```

### team-collab
```
GET    /canvas/:projectId/stream            SSE 流（需 teamId query）
POST   /canvas/:projectId/patch             推送 patch 广播
```

### projects（扩展）
```
POST   /projects/:id/team-shares            共享到团队
DELETE /projects/:id/team-shares/:teamId   取消共享
GET    /projects?teamId=xxx                 团队可见项目（含个人项目 + 共享项目）
```

**鉴权约定：** JWT + 可选 `X-Team-Id` 请求头。所有团队端点的 Guard 内验证用户是该团队成员，部分端点额外验证角色（owner/admin）。

---

## 5. 核心业务流程

### 5.1 团队积分消费流程（AI 任务）

```
请求到达
  1. JWT 鉴权 + X-Team-Id → 确认用户是团队成员
  2. 配额检查（行锁原子更新，防并发绕过）：
     UPDATE TeamMembership SET creditUsedThisCycle += amount
     WHERE creditUsedThisCycle + amount <= creditQuotaMonthly（或 null）
  3. 积分预留（幂等）：
     INSERT TeamCreditLedger(reserve, taskId) ON CONFLICT DO NOTHING
     UPDATE TeamCreditAccount SET frozenBalance += amount
     WHERE balance - frozenBalance >= amount
  4. 执行 AI 任务
  5a. 成功 → 扣除：INSERT deduct，balance -= amount，frozenBalance -= amount
  5b. 失败/超时 → 释放：INSERT release，frozenBalance -= amount
```

### 5.2 团队套餐积分续期（定时任务）

```
@Cron('*/5 * * * *')  每 5 分钟扫描
  查询 TeamSubscription WHERE nextCreditRenewalAt <= now AND status = 'active'
  
  对每条订阅（事务内原子执行）：
    1. 计算 creditsToGrant = seatCount × creditsPerSeatPerMonth
    2. INSERT TeamCreditLot（expiresAt = 30 天后）
    3. UPDATE TeamCreditAccount: balance += creditsToGrant, totalEarned += creditsToGrant
    4. INSERT TeamCreditLedger(subscription_renewal, key = "renewal_{subId}_{date}")
    5. 重置所有成员：creditUsedThisCycle = 0, quotaCycleStartAt = now
    6. UPDATE TeamSubscription: nextCreditRenewalAt += 1 个月
    
  幂等保证：步骤 4 的 @@unique 约束阻止 double-grant
```

### 5.3 项目共享与访问

```
POST /projects/:id/team-shares
  1. 校验 ownerId == 当前用户
  2. 校验用户在 teamId 中角色是 owner 或 admin
  3. UPSERT TeamProjectShare

GET /projects?teamId=xxx
  - 无 teamId：仅返回 ownerId = userId 的个人项目
  - 有 teamId：返回个人项目 ∪ 通过 TeamProjectShare 可见的项目
    附带 access 字段（"owner" | "team_edit"）
```

### 5.4 SSE 实时协作

```
GET /canvas/:projectId/stream?teamId=xxx
  1. 鉴权：用户对该 project 有访问权
  2. 注册 SseConn 到 CanvasSseManager（projectId → Set<SseConn>）
  3. 每 20s 发送心跳 ":keepalive\n\n"
  4. 监听 broadcast 事件推送 patch

POST /canvas/:projectId/patch { patch, connId }
  1. 鉴权同上
  2. CanvasSseManager.broadcast(projectId, patch, senderConnId)
     → 推送给同 projectId 除发送者外所有连接

取消共享时：CanvasSseManager.kickConnections(projectId, teamId)
  → 推送 { type: "access_revoked" }，强制断开
```

### 5.5 解散团队（事务）

```
DELETE /teams/:teamId（owner only）
  事务内顺序执行：
    1. 释放所有 frozen credits（frozenBalance 归零，insert release 记录）
    2. DELETE TeamProjectShare WHERE teamId = ?
    3. CanvasSseManager.kickAllConnections(teamId)
    4. UPDATE TeamSubscription SET status = 'cancelled'
    5. DELETE TeamMembership WHERE teamId = ?
    6. UPDATE Team SET status = 'dissolved'
```

### 5.6 Owner 退出团队规则

```
DELETE /teams/:teamId/members/:userId（userId = 当前 owner）
  - 团队只剩 1 人（owner 自己）→ 自动解散（走 5.5 流程）
  - 团队有其他 admin → 提升最早加入的 admin 为 owner
  - 团队无 admin → 提升最早加入的 member 为 owner
  - 不允许 owner 直接退出，必须先转让或达到上述条件
```

---

## 6. 隐藏业务漏洞及修复方案

| # | 漏洞 | 场景 | 修复 |
|---|------|------|------|
| 1 | **Owner 离开后无主团队** | Owner 退出，团队无人管理 | 退出前自动转让所有权（见 5.6）或解散 |
| 2 | **积分预留永久冻结** | 任务崩溃，reserve 永不 deduct/release | reserve 记录加 `reserveExpiresAt`，定时任务自动释放 |
| 3 | **成员配额并发绕过** | 并发请求同时通过应用层配额检查 | 配额检查改为 DB 原子 UPDATE（行锁），拒绝超额 |
| 4 | **积分批次过期时未处理冻结** | 过期批次含冻结积分，清理后 balance 为负 | 过期清理时先 release 关联的未完成 reserve |
| 5 | **取消共享时 SSE 连接不断开** | 成员权限被撤销但仍继续编辑 | 取消共享时 kick 该团队所有 SSE 连接，推送 access_revoked |
| 6 | **多团队下 X-Team-Id 语义不明** | 不带 teamId 请求项目列表返回什么 | 明确规范：无 teamId 只返回个人项目 |
| 7 | **接受邀请不检查座位上限** | 已满员团队邀请链接仍可接受 | acceptInvite 时原子检查当前成员数 < seatCount |
| 8 | **订阅续期积分 double-grant** | 定时任务重启导致同一续期触发两次 | 幂等 key `renewal_{subId}_{date}` + DB @@unique 约束 |
| 9 | **解散团队时资源未清理** | 共享项目、frozen credits、SSE 连接残留 | 解散走事务，顺序清理所有关联资源（见 5.5） |
| 10 | **配额周期与积分续期不同步** | 配额已重置但积分未发，或积分已发但配额未重置 | 续期定时任务内同一事务原子重置成员配额周期 |

---

## 7. 前端集成

### 7.1 新增 Zustand Stores

```typescript
// teamStore.ts
interface TeamStore {
  teams: Team[]
  activeTeamId: string | null  // localStorage 持久化（key: 'tanva_active_team_id'）
  setActiveTeam(teamId: string | null): void
  fetchTeams(): Promise<void>
}

// teamCreditsStore.ts
interface TeamCreditsStore {
  account: TeamCreditAccount | null
  memberUsages: MemberUsage[]
  fetchAccount(teamId: string): Promise<void>
}
```

### 7.2 API 客户端扩展

在现有 axios 拦截器中注入 `X-Team-Id`：

```typescript
axiosInstance.interceptors.request.use(config => {
  const teamId = useTeamStore.getState().activeTeamId
  if (teamId) config.headers['X-Team-Id'] = teamId
  return config
})
```

### 7.3 新增页面/组件

| 组件/页面 | 说明 |
|-----------|------|
| `TeamSwitcher`（Header） | 多团队切换下拉、创建团队入口 |
| `TeamManagementModal` | 成员列表、邀请、角色修改、解散团队 |
| `TeamSubscriptionPage` (`/team-plans`) | 套餐选择、座位数、支付 |
| `TeamCreditsPage` (`/team-credits`) | 余额、批次、成员用量、充值 |

### 7.4 SSE 实时协作 Hook

```typescript
function useCanvasCollab(projectId: string) {
  // 防抖 200ms 发送 patch
  // 光标节流 150ms
  // 断线重连 3s
  // 收到 access_revoked 时跳转离开
}
```

---

## 8. 实现优先级与分阶段

建议按以下顺序实现（依赖关系从基础到上层）：

```
Phase 1 - 基础数据层
  ├── Prisma schema 迁移
  ├── team-core 模块（团队/成员/邀请 CRUD）
  └── TeamMemberGuard（X-Team-Id 鉴权中间件）

Phase 2 - 积分与套餐
  ├── team-credits 模块（积分池/批次/预留-扣除-释放）
  ├── team-subscription 模块（套餐/续期定时任务）
  └── AI 模块接入团队积分消费

Phase 3 - 项目共享
  ├── projects 模块扩展（shareWithTeam/unshare/listForTeam）
  └── 修复漏洞 5（取消共享时踢 SSE）

Phase 4 - 实时协作
  ├── team-collab 模块（CanvasSseManager + 路由）
  └── 前端 useCanvasCollab Hook

Phase 5 - 前端 UI
  ├── teamStore / teamCreditsStore
  ├── TeamSwitcher（多团队切换）
  ├── TeamManagementModal
  ├── TeamSubscriptionPage
  └── TeamCreditsPage
```

---

## 9. 关键文件参考

| 参考来源（TapCanvas-pro） | 对应当前项目目标路径 |
|---------------------------|----------------------|
| `hono-api/src/modules/team/team.service.ts` | `backend/src/team-core/team-core.service.ts` |
| `hono-api/src/modules/team/team.repo.ts` | Prisma 调用（无独立 repo 层） |
| `hono-api/src/modules/team/team-subscription.service.ts` | `backend/src/team-subscription/team-subscription.service.ts` |
| `hono-api/src/modules/chapter/canvas-sse.manager.ts` | `backend/src/team-collab/canvas-sse.manager.ts` |
| `web/src/canvas/sync/useCanvasSync.ts` | `frontend/src/hooks/useCanvasCollab.ts` |
| `web/src/ui/team/TeamManagementModal.tsx` | `frontend/src/components/TeamManagementModal.tsx` |

---

*由 Claude Code 辅助生成，基于 TapCanvas-pro 代码分析*
