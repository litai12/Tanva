# 2026-10-09 图片孤儿任务退款与结算机制修复

## 现象

多个用户（含 15996321803）反馈任务一直处理中：后台用量记录已扣费，但没有生成时长（`processingTime` 为空，`responseStatus=pending`），也没有退款。

## 原因

- `GenerationTaskService.reconcileStuckTasks` 每分钟把 processing 超过 20 分钟、queued 超过 40 分钟的 ImageTask 直接 `updateMany` 为 failed（`task stuck/orphaned, auto-failed`），不处理关联的 `ApiUsageRecord`。
- 两类任务会走到这里：Worker 进程崩溃/重启导致的孤儿；Worker 遇到不确定结果（`reconciliation_required`）时保持 processing、用量 pending 后直接返回。
- 2026-09-20 起 `autoRefundStalePendingImageUsages` 改为空操作（避免按年龄误退），于是这些用量再无任何结算路径，永久卡在 pending。

## 机制修复

- `autoRefundStalePendingImageUsages`（每 5 分钟，`CreditsSchedulerService`）改为：仅选取 `requestParams.taskId` 关联的同用户 ImageTask 为 `failed` 且 `imageUrl IS NULL`、创建超过 `CREDITS_PENDING_TIMEOUT_MINUTES`（默认改为 60）的 pending 用量，标记失败后按原 SPEND 批次退款（`refundCredits`，按 apiUsageId 幂等）。
- 年龄本身仍不是退款依据：任务未终态失败、已有图片、或无关联 ImageTask 的记录不处理。
- 沿用原有保护：网关消费订单（`consumptionStatus`）、桌面/DeepSeek 对话跳过；团队用量只标 failed，由团队账本预留过期任务释放，不退到个人账户。
- 只处理新账：`createdAt >= 2026-10-09T02:30:00Z`（本次手动清理结束时间），旧账一律不自动退款；可用 `CREDITS_ORPHAN_IMAGE_REFUND_CUTOVER_AT` 改为实际部署时间。
- 原始 SQL 中 `createdAt` 为 UTC `timestamp`，而数据库会话时区为 `Asia/Shanghai`；比较时用 ISO 字符串 `::timestamp`，不要用 `now()`。
- 回归：`backend/scripts/verify-image-terminal-billing.ts` 覆盖查询条件、个人退款、团队只标失败与网关消费跳过。

## 线上处理（101，用户授权）

- 只读分组：pending 超 1h 的记录中，近 30 天图片孤儿 225 笔 / 12,445 积分 / 73 户（其中 59 笔网关曾返回上游图片 URL 但未落库，用户未收到图）；用户选择只退这一组。
- 使用生产 dist 的 `CreditsService.markApiUsageFailedForUser + refundCredits` 执行，225 笔全部成功，0 失败；结果清单 `/root/tanva-orphan-refund-2026-10-09T02-29-31-740Z.json`（0600）。
- 因数据库 `now()` 时区问题，实际有 2 笔创建不足 1 小时（27、37 分钟），均已被清理任务判 failed 且无出图，属于应退范围。
- 不再处理（用户确认旧账不参与）：5–9 月同类图片孤儿 730 笔 / 41,690 积分；近 30 天无本地任务关联的视频/MJ 等约 13 笔；2–3 月 requestParams 为空的历史视频 1,566 笔 / 约 79.8 万积分。视频孤儿（VideoTask 被判 failed）不在本次机制修复范围内，仍依赖供应商终态补偿查询。
