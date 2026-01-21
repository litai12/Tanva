# 后端模块：AI（backend-ai）

## 作用
- 提供图像生成/编辑/融合/分析、文本对话、背景移除、2D→3D、图片扩展、视频生成、Paper.js/向量化等能力。

## 关键文件
- `backend/src/ai/ai.controller.ts`：`/ai/*` 路由集合（主要入口）
- `backend/src/ai/ai.service.ts`：AI 业务逻辑（Gemini 等）
- `backend/src/ai/tool-selection-json.util.ts`：工具选择响应提取/解析（支持前后缀文本/markdown code fence/非严格 JSON/从文本提取工具名）
- `backend/src/ai/services/*`：不同能力/供应商的服务拆分
- `backend/src/ai/providers/*`：供应商适配（以实现为准）
- `backend/src/ai/dto/*`：请求/响应 DTO

## API（前缀 `/api/ai`，节选）
- `POST tool-selection`
- `POST generate-image`：返回 `imageUrl`（后端上传 OSS 后给前端），不再返回 base64 `imageData`
- `POST edit-image` / `blend-images`
- `POST analyze-image` / `text-chat`
- `POST remove-background`（含 public 变体）/ `GET background-removal-info`
- `POST convert-2d-to-3d` / `expand-image`
- `POST generate-video` / `generate-video-provider` / `GET video-task/:provider/:taskId`
- `POST generate-paperjs` / `img2vector`
- `GET veo/models` / `POST veo/generate`
- `POST dashscope/generate-wan2-6-*`
- `POST analyze-video`

## 注意事项
- Seedance（doubao）视频任务成功后，后端会将上游视频拉取并上传到 OSS，仅返回自有 OSS 公网链接给前端。
- `edit-image` / `blend-images` 支持 `sourceImageUrl(s)`，后端会按 OSS 白名单拉取并转换为 dataURL。

## 配置项（以代码与环境为准）
- Gemini/第三方：`GOOGLE_GEMINI_API_KEY`、`RUNNINGHUB_API_KEY` 等
- 视频/供应商：`DASHSCOPE_API_KEY`、`SORA2_API_ENDPOINT`、`BANANA_API_KEY` 等
