# 后端模块：AI（backend-ai）

## 作用
- 提供图像生成/编辑/融合/分析、文本对话、背景移除、2D→3D、图片扩展、视频生成、Paper.js/向量化等能力。

## 关键文件
- `backend/src/ai/ai.controller.ts`：`/ai/*` 路由集合（主要入口）
- `backend/src/ai/ai.service.ts`：AI 业务逻辑（Gemini 等）
- `backend/src/ai/services/*`：不同能力/供应商的服务拆分
- `backend/src/ai/providers/*`：供应商适配（以实现为准）
- `backend/src/ai/dto/*`：请求/响应 DTO

## API（前缀 `/api/ai`，节选）
- `POST tool-selection`
- `POST generate-image` / `edit-image` / `blend-images`
- `POST analyze-image` / `text-chat`
- `POST remove-background`（含 public 变体）/ `GET background-removal-info`
- `POST convert-2d-to-3d` / `expand-image`
- `POST generate-video` / `generate-video-provider` / `GET video-task/:provider/:taskId`
- `POST generate-paperjs` / `img2vector`
- `GET veo/models` / `POST veo/generate`
- `POST dashscope/generate-wan2-6-*`
- `POST analyze-video`

## 配置项（以代码与环境为准）
- Gemini/第三方：`GOOGLE_GEMINI_API_KEY`、`RUNNINGHUB_API_KEY` 等
- 视频/供应商：`DASHSCOPE_API_KEY`、`SORA2_API_ENDPOINT`、`BANANA_API_KEY` 等

