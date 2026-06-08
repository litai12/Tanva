# 租户基座 — 已知缺口与上线前硬性门槛

> 基座（子项目1）已落地：数据隔离、Host→租户、JWT 绑租户、支付回调/对账 cron 已按订单租户切上下文。
> 下列项在**当前单租户（全部 default）下行为正确**，但在**接入第 2 个租户之前必须处理**，否则会静默漏处理非主站租户的数据。

## 1. 非支付类定时任务（cron）未做跨租户扫描 —— 硬门槛

cron 运行时没有 HTTP 请求、无 CLS 上下文，Prisma 扩展会默认回落到主站 `default`。
因此以下 scheduler 目前**只会处理 default 租户的数据**，接入第二个租户后会静默跳过其它租户：

- `src/membership/membership-scheduler.service.ts`（6 个 @Cron：会员到期/续费/快照等）
- `src/credits/credits-scheduler.service.ts`（积分到期/重置/对账）
- `src/team-credits/team-credit-ledger.service.ts`（团队积分续期）
- `src/team-subscription/team-subscription.scheduler.ts`（团队订阅续费）
- `src/projects/projects-scheduler.service.ts`（项目清理）
- `src/volc-asset/volc-asset-scheduler.service.ts`（素材清理）

**处理模式**（逐个改造，需读懂各自逻辑后再动，勿盲目包裹）：
```ts
// 平台态跨租户取候选集，再逐租户/逐行 runAsTenant 处理
const rows = await this.tenantContext.runAsPlatform(() => this.prisma.x.findMany({ where: {...} }));
for (const row of rows) {
  await this.tenantContext.runAsTenant(row.tenantId, () => this.handle(row));
}
// 或对「按租户周期」类逻辑：先取活跃租户列表，对每个 runAsTenant 跑原逻辑
```
参考已完成的范式：`payment.service.ts` 的 `reconcileExpiredOrders` / `cleanupExpiredOrders` / `processPaymentSuccess`。

## 2. AI 异步任务回调/轮询的租户归因 —— 接第二租户前处理

`ImageTask` / `VideoTask` / `ApiUsageRecord` 在**请求期创建**时已自动带 `tenantId`（CLS 生效）。
但**异步轮询/回调更新任务**若发生在无 CLS 的 worker 中，更新会被限定到 default 租户。
需对这些 worker 按任务行 `runAsTenant(task.tenantId)`。请在接第二租户前审计：
```
rg -n "imageTask\.|videoTask\.|apiUsageRecord\." src
```

## 3. 微信扫码登录回调的跨租户定位 —— 接第二租户前处理

`WechatLoginSession.sceneKey` 为全局唯一。扫码回调到达时的 Host 可能不是发起站点。
当前单租户下回调落 default、session 也在 default，正常。多租户时需：
回调按 `sceneKey` 平台态查 session → `runAsTenant(session.tenantId)` 再查/绑定用户。
（`WechatLoginSession` 已含 `tenantId` 列，发起扫码时写入当前租户。）

## 4. 严格 Host 模式（TENANT_STRICT_HOST）默认关闭

未知域名当前兜底主站（非破坏性）。开启 `TENANT_STRICT_HOST=true` 前必须：
- 把全部对外域名（含 `www.`、回调域名）登记进 `TenantDomain`；
- 为支付回调 / 健康检查 / 内部回调路由做豁免（否则被 404）。
见子项目 2（域名路由 + 品牌分站）。

## 6. Prisma 扩展不处理嵌套写 / connect —— 硬门槛（codex 实现复审·严重）

`tenant-prisma.extension.ts` 只注入**顶层** data/where/create/update，**不递归** nested writes /
`connect` / `connectOrCreate`。后果：
- 嵌套创建的租户表行会落到 DB 列默认值 `'default'`（而非当前租户）→ 多租户下数据归属错乱；
- `connect` 可引用异租户实体 → 跨租户外键拼接。
单租户（全 default）下无影响。多租户上线前：审计约 28 处嵌套写
（`rg -n "create:\s*\{|connect:\s*\{|connectOrCreate" backend/src`），改为显式分步写 +
`assertSameTenant`，或对租户表避免嵌套写。

## 7. 支付通用下单接口的 team_seat 越权 —— 既有 authz 缺口（codex 实现复审·高）

`POST /payment/order`（`createOrder`）接受客户端提交的 `orderType:'team_seat'` 与任意
`metadata.teamId`，绕过 `TeamSeatPackageService.createOrder` 的团队角色校验。
**跨租户**部分已由发货时校验堵住（`processPaymentSuccess` 对 team_seat 校验 team 同租户，
异租户/不存在则拒绝发席位）。但**同租户内**「给自己不管理的团队买席位」的角色校验仍缺，
属既有 authz 问题，建议：通用下单接口拒绝 `team_seat`（强制走带角色校验的专用入口），
或在 `createOrder` 内对 team_seat 校验调用者团队角色。

## 8. JWT 旧 token 缺 tenantId —— 过渡期后收紧

`JwtStrategy` 仅在 `payload.tenantId` 存在时校验租户一致；旧 token 无 tenantId 时不显式拒绝，
但仍由 `findById`（租户作用域）兜底——查不到当前 Host 租户用户即 401，**不构成跨租户访问**。
access token TTL 短，过渡期（一个 TTL 周期）后设 `TENANT_STRICT_TOKEN=true` 显式拒绝无 tenantId 的 token。

## 9. 子租户 new-api key 仅覆盖主力 provider —— 其余 12 个 AI service 仍走平台 key

已支持：`Tenant` 存三组 key（normal/VIP/SVIP），`NewApiKeyResolver` 按当前租户解析（未配回落 env），
已接入主力 `new-api.provider.ts`（出图/视频主路径），主站超管在「租户管理」配置。
**未覆盖**：`background-removal` / `tencent-speech` / `tencent-vod-aigc` / `sora2-video` / `veo-video` /
`seed3d` / `seedream5` / `minimax-speech` / `minimax-music` / `video-provider` 等约 12 个 service
仍在构造时读 env key（用平台共享池）。要做到这些服务也按租户分账，需把它们的 `private readonly apiKey = env`
改为请求时 `await keyResolver.resolve(tier, envFallback)`（参考 new-api.provider 的改法）。
当前单租户/未配租户下行为不变（全用平台 key）。

## 5. 裸 SQL 审计（P8 已加 CI 闸）

`$queryRaw/$executeRaw` 绕过租户扩展。CI 脚本 `npm run lint:raw-sql` 会拦截未带
`tenant_id` 且无 `ALLOW_RAW_NO_TENANT` 注释的裸 SQL。存量命中需逐个补条件或标注。
