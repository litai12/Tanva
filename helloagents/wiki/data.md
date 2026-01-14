# 数据模型（Prisma / PostgreSQL）

## 数据源
- Prisma datasource：PostgreSQL（`DATABASE_URL`）

## 核心实体（节选）
以 `backend/prisma/schema.prisma` 为准：
- `User`：用户（phone/email、角色、状态、可选的 Google Key 配置等）
- `RefreshToken`：刷新令牌（hash、撤销、过期）
- `Project`：项目（`contentJson` 等）
- `CreditAccount` / `CreditTransaction`：积分账户与流水
- `ApiUsageRecord`：API 调用记录（token/image 计量等）
- `CreditPricing` / `CreditPackage`：计费配置与套餐
- `InvitationCode` / `InvitationRedemption`：邀请码与兑换
- `GlobalImageHistory`：全局图片历史
- `PublicTemplate`：公共模板
- `SystemSetting`：系统配置

## 关系要点
- `User` 1..n `Project`
- `User` 0..1 `CreditAccount`，`CreditAccount` 1..n `CreditTransaction`
- `User` 1..n `RefreshToken`

