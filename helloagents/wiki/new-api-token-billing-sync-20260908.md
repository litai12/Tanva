# new-api token 按量计费同步（2026-09-08）

## 来源与范围

来源：`/Users/libiqiang/workspace/TapCanvas-pro/apps/new-api`，同步时源仓库最新涉及该目录的提交为 `7358f5bfd`。本次定向迁移 token 阶梯计价、费用越界校验与异常核账，不做整个目录覆盖。保留 Tanva 渠道、媒体适配、部署配置及已有 SQL 补丁；不更改数据库价格，不执行生产迁移。

## 计费合同

- 预扣保留当前最低输入 token 预算，输入与 max output token 分别应用输入/输出倍率；费用用受检计算，拒绝负额度和整数越界。
- 从来源同步 Astra 与 Doubao Seed 2.0 的上下文档位规则，基价仍来自 Tanva 当前配置。该规则是项目间迁移，不代表本次重新验证供应商市场价格。
- 请求开始保存基础输入及输出倍率。实际 usage 到达后按实际 prompt token 重选档位，避免预估跨档或请求期间配置变化导致结算错误。固定价不应用 token 档位。
- 缓存读取/写入继续使用现有 OpenAI/Claude usage 语义，缓存读入替代对应普通输入 token，避免重复扣费。
- 结算金额越界时保留预扣与结果，写入 `billing_reconciliation_required` 错误日志，供人工核账。此日志不是自动补账系统。
- 本次没有迁移上游账户/渠道折扣字段、价格展示倍率、用户管理和协议架构；没有修改 Tanva backend 的业务积分计费层。

## 验证

- `go test ./common ./service ./setting/ratio_setting` 通过。
- `go build ./...` 通过。
- 新增回归：预估高实际低/预估低实际高、缓存与输出计价、补扣/退差额/零消耗结算幂等，以及上游同步的溢出与上下文计价测试。
- `go test ./relay/helper` 存在既有失败 `TestStreamScannerHandler_StreamStatus_PreInitialized`（expected=1, actual=0）。用 Go overlay 恢复修改前 helper/price.go 后单独重复 10 次均复现，记录为既有流式测试问题。
- 无真实付费调用、无数据库写入、无部署；线上模型是否仍有固定价优先配置需在上线验收时核对。

## 后续同步

同日后续能力同步已修复 StreamStatus 被重置的问题，PreInitialized 现已通过；helper 完整串行测试通过，并行测试的全局超时配置干扰另行记录。见 `new-api-capability-sync-20260908.md`。
