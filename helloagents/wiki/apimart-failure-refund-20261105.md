# APIMart 图片失败积分不退（2026-11-05）

## 现象

文庭（133****3001）的 Gemini 3 Pro 4K 生成报 `new-api HTTP 502: The task did not finish within the time limit ... refunded automatically.（上游任务已受理，结果或费用待核实，按原任务回执结算）`，三笔共 255 积分一直 pending。

- 超时本身来自上游：11-05 09 时起渠道 9（APIMart，`api.aishuch.com`）的 `gemini-3-pro-image-preview` 变慢，4K normal 成功均耗时从 83s 升到 315s，APIMart 在约 600s 判定 `generation_timeout`，当天 27 笔，此前 7 天没有。渠道 22（stable）不受影响。上游变慢不是代码能修的。
- 积分不退是我们的缺陷：10-21 起 APIMart 所有终态失败的图片任务都卡在 pending，共 224 笔、9,820 积分、29 户（内容审核 105、超时 25、无原因 88 等）。

## 原因

- 后端只有在回执 `billing_status === 'refunded'` 时才认定上游失败已确认（`image-execution-state.ts`），否则进入 `reconciliation_required`。但图片回执核账并没有自动流程，孤儿退款任务也会跳过带回执的记录，所以这些记录只能一直 pending。
- APIMart `GET /v1/tasks/{id}` 不返回 `billing` 对象，网关只解析 `billing.status`，所以 APIMart 的回执永远拿不到 billing_status。官方文档里对应的字段是 `cost`（本次任务扣费金额）和 `credits_cost`（本次任务扣费积分），https://docs.apimart.ai/cn/api-reference/tasks/status.md。
- 实测：超时和大部分内容审核失败的 `cost=0, credits_cost=0`；另有 81 笔内容审核失败上游收了 $0.002–0.005（`cost>0`），即便按 cost 判断也永远不会是 refunded。

## 修复

- 网关（`relay/channel/apimart/image_errors.go`）：仅限 APIMart 包裹格式，任务终态为 failed/cancelled、没有 billing 字段，且 `cost`、`credits_cost` 都显式为数字 0 时，回执写 `billing_status=refunded`，HTTP 返回 422。字段缺失、null、字符串或非零时保持未知。ToAPIs 不变。
- 后端（`image-execution-state.ts`）：上游已受理、终态 failed/cancelled 的回执，统一视为用户无需付费，按明确失败处理并走 rollback 立即退款，不再依赖 billing_status。上游实际收的少量费用（如审核费）由平台承担。非终态、回执不完整或保存回执失败的，仍按待核实处理。
- 测试：`image_errors_test.go` 新增 9 个 cost 判定用例；`image-execution-state.spec.ts` 和 `scripts/verify-image-terminal-billing.ts` 改为新规则，`terminal-unconfirmed` 场景改用非终态回执。`verify-image-terminal-billing.ts` 的 worker `success` 场景（第 106 行 committed）在改动前就失败，与本次无关；去掉这个场景后其余全部通过。

## 101 发布

- 网关：基于线上提交 `2b188c1a` 加入本修复（`f963acbf`，main 上为 cherry-pick 版），没有带上 main 上尚未部署的 `b6fafe3d`。镜像 `backend-new-api:apimart-zero-cost-20261105`，二进制 sha256 `a26ec42a…8736`，版本 `v0.0.0-f963acbf`。UTC 2026-11-05 08:06:19 先暂停图片队列，待 active 图片任务和未结网关请求都为 0 后切换；环境变量和挂载一致，内外网健康，重启 0 次。回退镜像为 `backend-new-api:tapcanvas-plan-20261025`。
- 后端：只替换了 `dist/ai/services/image-execution-state.js`（sha256 `1630bd11…f9b`，与线上旧版的差异只有这一处条件）。同样排空后在 UTC 08:10:16 执行 `pm2 reload tanvas-api`，health 200。旧文件备份在 `/opt/tanva-backups/apimart-zero-cost-20261105/`。
- 发布目录 `/opt/tanva-releases/apimart-zero-cost-20261105/`（deploy.py / deploy-backend.py / drain*.cjs / 日志）。

## 历史退款（用户授权）

- 脚本 `/opt/tanva-releases/apimart-zero-cost-20261105/apimart-refund.cjs`（dry / apply）。范围：pending 用量，关联 ImageTask 为 failed、没有 imageUrl，且带 APIMart 回执。逐笔重新查询上游，证据写入清单。执行时调用生产 dist 的 `markApiUsageFailedForUser` 和 `refundCredits`（按 apiUsageId 幂等，按原批次退回），ImageTask 标为 `confirmed_failed`，文案改为「上游未出图，积分已退还」。
- 结果：224/224 已退，9,820 积分，29 户，全部是个人扣费，没有团队用量。上游证据：150 笔查到 failed（其中 81 笔上游有少量扣费）；72 笔上游已过期查不到；2 笔上游后来生成成功，但 Tanvas 侧已判失败、用户没拿到图，也一并退款，上游费用由平台承担。复核结果：224 笔用量均为 failed，refund 合计 +9,820，正好抵消 spend；带 APIMart 回执的 pending 记录为 0。清单 `/root/tanva-apimart-refund-apply-2026-11-05T08-15-42-301Z.json`（0600）。
- 第一次 apply 时 `$queryRaw` 把 processingTime 返回成 BigInt，224 笔在第一步就全部失败，没有改动任何数据；改为 Number 后重跑。
- 按原批次退回的结果：9,270 积分退回有效批次，370 积分没有批次扣减记录；140 积分退回到状态已是 expired 的批次，按 10-09 的先例仍计入余额；1 户有 40 积分退回到已过期但状态仍为 active 的赠送批次，到期任务可能会清掉，目前没有补偿。

## 后续

- 上游慢的问题需要联系 APIMart，或调整 Gemini 3 Pro 4K 的路由。
- 回执非终态（轮询中断、15 分钟传输超时）的任务仍然停在待核实，目前没有按 task_id 重新查询上游的自动核账流程。
