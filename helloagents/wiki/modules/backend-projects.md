# 后端模块：项目（backend-projects）

## 作用
- 管理用户项目（创建/列表/更新/删除）以及项目内容（content JSON）读写与版本控制。

## 关键文件
- `backend/src/projects/projects.controller.ts`：`/projects/*`（JWT）
- `backend/src/projects/projects.service.ts`：项目业务逻辑（Prisma + 可选 OSS/其他依赖以实现为准）
- `backend/src/projects/dto/*`：DTO（Create/Update/Content）

## API（前缀 `/api/projects`）
- `GET /`：列表
- `POST /`：创建
- `GET /:id`：获取单个
- `PUT /:id`：更新基础信息
- `DELETE /:id`：删除
- `GET /:id/content`：获取项目内容
- `PUT /:id/content`：更新项目内容（带版本号）

## 数据模型关联
- `Project`（`contentJson`, `contentVersion`, `thumbnailUrl`, `ossPrefix` 等）

