# 后端模块：积分系统（backend-credits）

## 作用
- 维护用户积分余额、交易流水、API 使用记录与服务定价。
- 提供每日奖励领取与管理员加/扣积分接口。

## 关键文件
- `backend/src/credits/credits.controller.ts`：`/credits/*`
- `backend/src/credits/credits.service.ts`：积分/定价/流水/使用记录逻辑（Prisma）
- `backend/src/credits/dto/credits.dto.ts`：DTO

## 图像计费规则（当前）
- 生图：按 `resolutionPricing` 区分（如 Pro 2K=60，Ultra 2K=45）。
- 图像编辑：
  - Pro（`gemini-image-edit`）1K=40，2K=60，4K=120，其余分辨率默认 30。
  - Ultra（`gemini-3.1-image-edit`）0.5K=20，2K=45，4K=60，其余分辨率默认 30。
- 图像融合：
  - Pro（`gemini-image-blend`）1K=40，2K=60，4K=120，其余分辨率默认 30。
  - Ultra（`gemini-3.1-image-blend`）0.5K=20，2K=45，4K=60，其余分辨率默认 30。
- 账单流水中的 `description` 由后端生成，格式为 `使用 {serviceName}（{imageSize}）`，前端直接展示。

## API（前缀 `/api/credits`，节选）
- `GET balance`
- `GET daily-reward/status` / `POST daily-reward/claim`
- `GET pricing`
- `GET transactions`：返回流水基础字段 + `channel`（渠道）、`provider`、`model`、`apiResponseStatus`、`processingTime`
- `GET usage`
- `POST admin/add` / `POST admin/deduct`（需要管理员角色）

## 渠道与模型追踪（图像分析）
- `POST /api/ai/analyze-image` 的计费请求参数会写入 `aiProvider/channelHint`，用于在积分流水中识别执行渠道。
- 流水列表前端可直接展示“渠道 + 模型”，用于核对“使用了哪个渠道、哪个模型”。

## pending 收敛与自动退款
- 异步视频链路支持前端回写成功：`POST /api/ai/video-task-success` 将 `ApiUsageRecord.responseStatus` 从 `pending` 更新为 `success`。
- 异步任务失败可调用 `POST /api/ai/video-task-refund`：先标记 `failed` 再退款；退款交易按 `apiUsageId` 幂等。
- 状态机保护：`updateApiUsageStatus` 禁止 `failed -> success` 与 `success -> failed` 的反向回写，避免“已退款后又标记成功”或“已成功后又标记失败”的状态/账务不一致。
- 定时任务每 5 分钟扫描超时 `pending` 并自动退款：
  - 图像类：`CREDITS_PENDING_TIMEOUT_MINUTES`（默认 15 分钟）
  - 视频类：`CREDITS_PENDING_VIDEO_TIMEOUT_MINUTES`（默认 30 分钟）
- 视频类自动退款默认带分界线：仅处理 `createdAt >= 2026-03-28T00:00:00.000Z` 的记录，避免历史 `pending` 上线后集中退款。
  - 可通过 `CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT` 覆盖时间点；
  - 设置为 `off/none/0` 可关闭分界线过滤。

## 数据模型关联
- `CreditAccount`、`CreditTransaction`、`ApiUsageRecord`、`CreditPricing`、`CreditPackage`

## 多形态积分基础层（2026-04-08）
- 新增 `backend/src/credits/credit-lot-policy.ts`：提供积分批次（lot）候选类型、默认扣减策略、lot 可用性过滤、优先级排序和扣减规划函数。
- 新增 `backend/src/credits/credit-lot-grants.ts`：提供充值、管理员补发、新用户注册赠送等“永久 lot”构建函数。
- 新增 Prisma 模型基础设施：
  - `CreditLot`：表示一批具有同一来源/有效期规则的积分，支持 `permanent`、`fixed_window`、`membership_bound` 三类生命周期。
  - `CreditConsumePolicy`：表示扣减优先级策略，支持按生命周期、来源、scope specificity 等规则排序。
- `CreditTransaction` 补充 lot / policy 审计字段：
  - `creditLotId`
  - `consumePolicyCode`
  - `consumePolicyVersion`
- 当前仍是基础层，现有 `CreditsService.preDeductCredits` 生产扣费逻辑尚未切换到 lot 真值扣减；后续迁移应分阶段接入，避免一次性重写线上账务链路。
- 已接入的发放链路：
  - `PaymentService.processPaymentSuccess`：充值成功后创建 `sourceType=recharge` 的 permanent lot。
  - `CreditsService.adminAddCredits`：管理员补发积分时创建 `sourceType=manual` 的 permanent lot。
  - `CreditsService.getOrCreateAccount`：新用户注册赠送与邀请注册额外赠送创建 `sourceType=promo` 的 permanent lot。
- 尚未接入的链路：
  - 每日签到（现有过期清理仍以 `CreditTransaction` 为主）
  - lot 真值扣减与 lot 级退款恢复
