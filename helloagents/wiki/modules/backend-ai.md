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
- `POST video-task-success` / `POST video-task-refund`（异步视频任务前端轮询后的成功/失败回写）
- `POST generate-paperjs` / `img2vector`
- `GET veo/models` / `POST veo/generate`
- `POST dashscope/generate-wan2-6-*`
- `POST analyze-video`
- `POST minimax-speech` / `POST minimax-music`

## 注意事项
- `generate-image` 在上游仅返回外链 `imageUrl`（如 Seedream/Nano2）时，会统一下载并转存 OSS 后返回稳定 URL；管理员/白名单只跳过水印，不再直返第三方临时链接。
- Seedream5 supports system setting key seedream5_provider (doubao / watcha), defaulting to doubao when missing.
- Watcha Seedream channel env vars: WATCHA_SEEDREAM_API_KEY, optional WATCHA_SEEDREAM_ENDPOINT, optional WATCHA_SEEDREAM_MODEL.
- Seedance（doubao）视频任务成功后，后端会将上游视频拉取并上传到 OSS，仅返回自有 OSS 公网链接给前端。
- 异步视频计费为“先扣费 + 后确认”：创建任务后记录保持 `pending`，前端轮询成功调用 `video-task-success` 标记 `success`，失败调用 `video-task-refund` 标记失败并退款。
- `edit-image` / `blend-images` 支持 `sourceImageUrl(s)`，后端会按 OSS 白名单拉取并转换为 dataURL。
- Banana 文本链路（`text-chat` / `tool-selection`）支持独立于图像链路的供应商配置键 `banana_text_provider`：`auto`（Apimart→147）、`legacy_auto`（147→Apimart）、`apimart`、`legacy`。
- Banana 文本走 Apimart 时使用 `https://api.apimart.ai/v1/chat/completions`（OpenAI Chat Completions 兼容格式），鉴权复用 `NANO2_API_KEY`。
- Banana 文本链路默认模型已统一为 `gemini-3-flash-preview`（包含 Apimart 通道默认值与 controller/provider fallback 默认值）。
- `minimax-music` 默认强制 `output_format=url`、`stream=false`，并在上游返回 `status=1`（合成中）或请求超时时返回友好错误提示。

## 配置项（以代码与环境为准）
- Gemini/第三方：`GOOGLE_GEMINI_API_KEY`、`RUNNINGHUB_API_KEY` 等
- 视频/供应商：`DASHSCOPE_API_KEY`、`SORA2_API_ENDPOINT`、`BANANA_API_KEY` 等
- Banana/Apimart 文本与图像：`BANANA_API_KEY`（147）、`NANO2_API_KEY`（Apimart）
