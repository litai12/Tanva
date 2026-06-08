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

## 5. 裸 SQL 审计（P8 已加 CI 闸）

`$queryRaw/$executeRaw` 绕过租户扩展。CI 脚本 `npm run lint:raw-sql` 会拦截未带
`tenant_id` 且无 `ALLOW_RAW_NO_TENANT` 注释的裸 SQL。存量命中需逐个补条件或标注。
