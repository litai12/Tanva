# 租户级支付商户配置 + 多租户自检 设计

- 日期：2026-06-09
- 分支：`feature/multi-business`
- 作者：李碧强 + Claude
- 依赖：租户基座（`2026-06-08-租户基座-design.md`，已落地）

## 目标

让每个子租户可**独立配置自己的微信/支付宝商户号与证书**（可选），未配置则回落主站平台 env（"默认使用主站的"）。主站超管可在「租户管理」后台**查询/修改任意子站**的支付配置。完成后用 workflow 跑一次**多租户隔离自检**，并保证功能可正常使用。

用户选定档位：**支付配置 + 自检**（不修 known-gaps #1/#2/#6，仅自检列出）。私钥/证书 **AES-256-GCM 加密存库**。**微信 + 支付宝都支持**。

## 现状（构建基础）

- 基座已完成：CLS + Prisma 扩展隔离、Host→租户、JWT 绑租户、迁移。
- 范式：`Tenant` 表存可选 override 列（`newApiKey`…），`NewApiKeyResolver`（TTL 缓存 + env 回落 + `invalidate`），`tenant-admin.service` 主站超管管理（只回布尔不泄明文），前端 `TenantManagement.tsx`。
- 支付现状：`PaymentService.onModuleInit` 用全局 env 各建**一个** Alipay/WeChat SDK 单例（`this.alipaySdk`/`this.wechatPay`/`this.wechatApiV3Key`）。回调已 `runAsPlatform 查 order → runAsTenant(order.tenantId)` 发货（`processPaymentSuccess` 内部自切），但**主动查单 `queryXxxTradeStatus` 仍在 default 上下文跑**——单租户无碍，多商户必坏。

## 数据模型（`Tenant` 增列，全部可空 → 空即回落平台 env）

明文（非密）：`wechatAppId` `wechatMchId` `wechatSerialNo` `alipayAppId`
密文（AES-256-GCM）：`wechatPrivateKeyEnc` `wechatCertificateEnc` `wechatApiV3KeyEnc` `alipayPrivateKeyEnc` `alipayPublicKeyEnc`

迁移 `ADD COLUMN IF NOT EXISTS`（postgres，沿用 `20260608130000_tenant_newapi_keys` 风格）。`Tenant` 已是白名单表，扩展不注入。

## 加密工具 `src/utils/secret-crypto.ts`（新）

AES-256-GCM，主密钥 env `TENANT_SECRET_KEY`（base64 32 字节）。密文格式 `v1:<iv_b64>:<tag_b64>:<ct_b64>`。`encryptSecret(plain)` / `decryptSecret(enc)`。**Fail-closed**：要加密但无主密钥 → 抛错（绝不明文落库）。`isEncrypted(s)` 辅助。

## 解析器 `TenantPaymentResolver`（新，镜像 `NewApiKeyResolver`，注册进 `@Global` TenancyModule）

`resolve(explicitTenantId?): Promise<ResolvedPaymentCtx>`：
```
{ alipaySdk, alipayAppId, wechatPay, wechatApiV3Key, wechatAppId, wechatMchId, source }
```
- 平台 ctx：lazy 从 env 构建一次（复刻 onModuleInit 的 serial_no 优先 / formatKey / apiV3Key 逻辑），缓存。
- 租户 ctx：解密 → 构建该租户 SDK，**按渠道**缓存（TTL 60s + `invalidate(tenantId)`）。某渠道未完整配置 → 该渠道回落平台（**逐渠道回落**，非整体）。
- `resolve` 取 CLS 租户（或显式 id）：主站/未配 → 平台 ctx；子租户 → 逐渐道合并（tenant ?? platform）。

`PaymentService` 把所有 `this.alipaySdk`/`this.wechatPay`/`this.wechatApiV3Key` 直引换成 `await this.paymentResolver.resolve()`。SDK 构造逻辑从 `onModuleInit` 迁入 resolver；`onModuleInit` 仅预热平台 ctx + 保留启动日志。

## 回调租户定位（方案 A：租户内嵌 notify_url）

下单在租户 CLS 内 → `notify_url` 末尾带 `/<tenantId>`：
- 微信：`…/api/payment/wechat-notify/:tenantId`
- 支付宝：`…/api/payment/notify/:tenantId`

控制器从 path 取 `tenantId` 传入 handler：
- **微信**：`resource.ciphertext` 用**该租户 apiV3Key** 解密 → `out_trade_no` → `runAsPlatform` 查 order → **校验 `order.tenantId === pathTenantId`**（防跨租户）→ `runAsTenant(order.tenantId)` 内主动查单 + 发货。
- **支付宝**：`out_trade_no` 明文 → 查 order → `runAsTenant(order.tenantId)` 内主动查单（用租户 SDK）+ 发货。

**保留旧全局路由** `/payment/notify`、`/payment/wechat-notify`、`/payment/wechat/notify`（pathTenantId 为空 → 平台/按订单回落），兜在途旧订单，不破坏现网。主动查单仍是权威确认（双保险）。

## 主站后台 + 前端

- `GET /admin/tenants/:id/payment-config`：每字段只回 `{ configured: bool }`，绝不回明文。`listTenants` 顺带返回 `payment: { wechat: bool, alipay: bool }` 概览。
- `POST /admin/tenants/:id/payment-config`：传值=设置（密文字段加密入库），空串=清除，不传=不变；写后 `paymentResolver.invalidate(id)`。
- `ensurePlatformAdmin`（仅主站超管）。前端 `TenantManagement.tsx` 加「支付配置」面板（与 new-api key 并列），密文字段不回填、只显示是否已配。
- 用户列表/前端数据隔离已由基座保证，本次仅**自检**确认。

## 自检 workflow（启用 workflow）

并行 fan-out 审计 agent（find → 对抗式 verify），产出报告：
1. 隔离审计：比对 `tenancy-known-gaps.md`，确认 #1 cron/#2 异步/#6 嵌套写现状并列「接第二租户前必处理」清单；跑 `lint:raw-sql`。
2. 支付新链路审计：回调租户定位正确、逐渐道 env 回落、admin 响应无明文泄漏、加密确实启用、缓存失效正确。
3. 数据隔离确认：admin 用户列表 tenantScope、前端取数按租户。
4. 跑 `test:tenancy` + payment spec。

## 测试

- `secret-crypto.spec.ts`：加解密往返、fail-closed、isEncrypted。
- `tenant-payment-resolver.spec.ts`：租户配置生效 / 逐渐道 env 回落 / 主站走平台 / 缓存失效。
- payment 回调按 pathTenantId 定位 + `order.tenantId` 校验；admin 不泄明文。

## 验收

- [ ] `Tenant` 增列 + 迁移三库可跑（postgres 生产）。
- [ ] 加密工具 fail-closed，密文格式带版本号。
- [ ] resolver 逐渐道回落 + 缓存失效；payment 全部走 resolver。
- [ ] 下单 notify_url 带 tenantId；回调按 path 定位 + 跨租户校验；旧路由兼容。
- [ ] admin get/set 支付配置，只回布尔；前端面板可用。
- [ ] build 通过、`test:tenancy` + payment spec 通过、自检 workflow 报告无阻断项。

## 明确不做

不修 known-gaps #1/#2/#6（仅自检列出）；其余 AI service 不租户化；不做平台↔租户结算（子项目 6）。
