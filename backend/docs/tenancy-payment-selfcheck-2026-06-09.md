# 租户级支付商户配置 — 多租户自检报告（2026-06-09）

> 由 workflow `tenancy-payment-selfcheck`（5 并行审计 agent + 对抗式复核）产出，人工核对后归档。

## 结论：可上线（已修高危项）

| 审计点 | 结果 |
|--------|------|
| A 回调租户定位 / 防跨租户 | warn（1 high 已修，2 medium 见下，pre-existing） |
| B 机密加密与不泄漏 | **pass** |
| C 隔离基座 / known-gaps 无回归 | **pass** |
| D 后台/前端隔离 + 主站超管权限 | **pass** |
| E 编译与测试实跑 | **pass**（后端 tsc 0 err；26 用例过；test:tenancy 37 用例过；前端 tsc -b 0 err） |

## 已修复（high，对抗式复核确认非误报）

**租户解密/SDK 构建失败时静默回落平台 → 租户级商户订单永久漏单。**
原实现：`TenantPaymentResolver` 解密抛错被 catch 后渠道 sdk=null，`resolve()` 逐渐道回落平台 → 该租户订单用**平台商户**查单/发货，上游 ORDERNOTEXIST → 静默漏单，仅一条 error 日志。

修复：渠道解析区分三态——
- 已配且成功 → 用租户商户；
- **已配但密文解密抛错（主密钥缺失/轮换、密文损坏）→ fail-closed**：sdk=null 且**不回落平台**（`source:'error'`）。下单二维码会显式报错、回调返回 false 触发支付网关重试 + 告警，不会用错商户静默吞单；
- 字段不全（从未是可用商户，如只填 appId）→ 仍宽松回落平台。

覆盖测试：`tenant-payment-resolver.service.spec.ts` 「fail-closed：…不回落平台」。

## 待处理（medium，**pre-existing**，非本次引入；建议后续单独处理）

1. **主动查单金额为 null 时金额校验被跳过**：`isAmountMatched(expected, null)` 返回 true（payment.service.ts），所有回调/对账依赖它。上游成功但金额解析为 null 时形同虚设。建议：成功路径下 `actual===null` 视为校验失败并告警。影响面广（reconcile/getOrderStatus/sync 均用），需评估后改。
2. **回调无签名校验**：支付宝 RSA2 / 微信 Wechatpay-Signature 未校验（`handleWechatNotify` 丢弃 headers），安全完全压在主动查单。建议至少对微信启用 SDK `verifySign`（用对应租户证书）。

> 两项均为既有支付域设计选择（以主动查单为权威），不影响本次租户化正确性；列入 known-gaps 跟踪。

## 复核要点（pass 项摘录）

- B：`secret-crypto` AES-256-GCM、fail-closed、`v1:` 版本前缀、`setAuthTag` 完整性校验；admin 私钥/证书/APIv3key 仅回布尔，明文私钥不经 API/日志。
- C：支付回调「查单+发货」已 `runAsPlatform 定位 → runAsTenant(order.tenantId)` 包裹，相对 known-gaps #2 属支付域内已完成范式；#1 cron / #2 AI worker / #6 嵌套写 仍是接第二租户前硬门槛。
- D：`payment-config` GET/POST 经 `ensurePlatformAdmin`（role=admin 且 tenantId=default）；用户列表 tenantScope 子站强制本租户；前端面板仅非主站显示、密文不回填。
