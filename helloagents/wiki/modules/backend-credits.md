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
- 定时任务每 5 分钟扫描超时 `pending` 并自动退款：
  - 图像类：`CREDITS_PENDING_TIMEOUT_MINUTES`（默认 15 分钟）
  - 视频类：`CREDITS_PENDING_VIDEO_TIMEOUT_MINUTES`（默认 30 分钟）
- 视频类自动退款默认带分界线：仅处理 `createdAt >= 2026-03-28T00:00:00.000Z` 的记录，避免历史 `pending` 上线后集中退款。
  - 可通过 `CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT` 覆盖时间点；
  - 设置为 `off/none/0` 可关闭分界线过滤。

## 数据模型关联
- `CreditAccount`、`CreditTransaction`、`ApiUsageRecord`、`CreditPricing`、`CreditPackage`
