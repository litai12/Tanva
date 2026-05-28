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

## 约束（设计 JSON）
- `contentJson` 属于「设计 JSON」：只允许保存远程 URL/路径引用；禁止 `data:`/`blob:`/裸 base64（如 `iVBORw0...`）进入 DB/OSS。
- 后端会在读写 `contentJson` 时做清洗（见 `backend/src/utils/designJsonSanitizer.ts`）；历史数据可用 `backend/scripts/sanitize-design-json.ts` 批量修复。

## 性能观测
- `PUT /api/projects/:id/content` 是整包项目 JSON 保存，是 100 人级在线编辑时的核心压力点。
- 保存慢或内容大时会输出 `[ProjectSaveHotspot]` 日志，包含 `contentBytes`、`durationMs`、`timings.sanitizeAndHashMs`、`ossPutMs`、`dbUpdateMs`、`workflowHistoryMs`、`duplicate` 等字段。
- 日志阈值可通过 `PROJECT_SAVE_SLOW_LOG_MS`（默认 2000ms）和 `PROJECT_SAVE_LARGE_LOG_BYTES`（默认 2MB）调整。
