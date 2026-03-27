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

## 数据模型关联
- `CreditAccount`、`CreditTransaction`、`ApiUsageRecord`、`CreditPricing`、`CreditPackage`
