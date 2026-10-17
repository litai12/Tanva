# 后端模块：用户（backend-users）

## 作用
- 提供用户信息查询与账户侧设置能力（例如 Google API Key 配置）。

## 关键文件
- `backend/src/users/users.controller.ts`：`/users/*`
- `backend/src/users/users.service.ts`：用户查询/创建、Google API Key 读写（Prisma）

## API（前缀 `/api/users`）
- `GET me`：获取当前用户信息（JWT）
- `GET google-api-key`：获取 Google Key 配置（返回脱敏）
- `PATCH google-api-key`：更新/清除 Google Key

## 数据模型关联
- `User.googleCustomApiKey` / `User.googleKeyMode`（见 `backend/prisma/schema.prisma`）

## 管理员用户列表邀请来源
- `GET /api/admin/users` 增加 `inviterPhone: string | null`，按 `User.invitedBy.phone` 返回填写邀请码所关联的邀请人手机号；关系查询仅选取手机号，不返回邀请人其他资料。
- 邀请码兑换与 `User.invitedById` 写入在同一事务完成。无邀请关系或邀请人无手机号时返回 `null`；管理员直接创建的用户同样返回 `null`。
- Admin 用户列表在用户手机号右侧展示“邀请人手机号”，无值显示“—”。沿用管理员权限，无数据库迁移，不修改邀请码兑换或积分发放规则。

