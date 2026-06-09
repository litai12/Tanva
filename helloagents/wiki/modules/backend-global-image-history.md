# 后端模块：全局图片历史（backend-global-image-history）

## 作用
- 记录图片生成/处理等结果的历史（按用户维度检索），用于历史回溯与复用。

## 关键文件
- `backend/src/global-image-history/global-image-history.controller.ts`：`/global-image-history/*`
- `backend/src/global-image-history/global-image-history.service.ts`

## 数据模型关联
- `GlobalImageHistory`

## 写入约定
- 前端历史写入区分展示标题与真实请求提示词：`prompt` / `metadata.requestPrompt` 保存可追溯的生成请求，`metadata.title` 保存列表展示标题（例如 `Generate 22:18:44`）。

## 查询说明
- `GET /api/global-image-history` 支持两种分页方式：
- 游标分页：`cursor + limit`（原有行为，返回 `nextCursor/hasMore`）。
- 页码分页：`page + limit`（新增行为，返回 `page/totalPages/totalCount`，用于前端页码跳转）。
