# 数据模型（Prisma / PostgreSQL）

## 数据源
- Prisma datasource：PostgreSQL（`DATABASE_URL`）

## 核心实体（节选）
以 `backend/prisma/schema.prisma` 为准：
- `User`：用户（phone/email、角色、状态、可选的 Google Key 配置等）
- `RefreshToken`：刷新令牌（hash、撤销、过期）
- `Project`：项目（`contentJson` 等；设计 JSON 禁止内联 `data:`/`blob:`/base64 图片）
- `WorkflowHistory`：工作流历史版本（主键：`userId + projectId + updatedAt`；仅保存 `flow` 图快照）
- `CreditAccount` / `CreditTransaction`：积分账户与流水
- `ApiUsageRecord`：API 调用记录（token/image 计量等）
- `CreditPricing` / `CreditPackage`：计费配置与套餐
- `InvitationCode` / `InvitationRedemption`：邀请码与兑换
- `GlobalImageHistory`：全局图片历史
- `PublicTemplate`：公共模板
- `SystemSetting`：系统配置

## 关系要点
- `User` 1..n `Project`
- `Project` 1..n `WorkflowHistory`
- `User` 0..1 `CreditAccount`，`CreditAccount` 1..n `CreditTransaction`
- `User` 1..n `RefreshToken`
