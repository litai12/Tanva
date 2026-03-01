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

