# 后端模块：管理后台（backend-admin）

## 作用
- 提供管理侧的用户、API 使用、定价、系统设置、模板管理等接口。

## 关键文件
- `backend/src/admin/admin.controller.ts`：`/admin/*`
- `backend/src/admin/admin.service.ts`
- `backend/src/admin/services/template.service.ts`
- `backend/src/admin/dto/*`

## API（前缀 `/api/admin`，节选）
- `GET dashboard`
- `GET users` / `GET users/:userId`
- `PATCH users/:userId/status` / `PATCH users/:userId/role`
- `POST users/:userId/credits/add` / `POST users/:userId/credits/deduct`
- `GET api-usage/stats` / `GET api-usage/records`
- `GET pricing`
- `GET settings` / `GET settings/:key` / `POST settings`
- `POST templates` / `GET templates` / `GET templates/:id` / `PATCH templates/:id` / `DELETE templates/:id`
- `GET templates/categories` / `POST templates/categories`

## 注意事项
- 认证/鉴权细节以 Guard 与具体实现为准（通常依赖 JWT + 用户 role/status）。

