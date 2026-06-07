# 后端模块：AI（backend-ai�?

## 作用
- 提供图像生成/编辑/融合/分析、文本对话、背景移除�?D�?D、图片扩展、视频生成、Paper.js/向量化等能力�?

## 关键文件
- `backend/src/ai/ai.controller.ts`：`/ai/*` 路由集合（主要入口）
- `backend/src/ai/ai.service.ts`：AI 业务逻辑（Gemini 等）
- `backend/src/ai/tool-selection-json.util.ts`：工具选择响应提取/解析（支持前后缀文本/markdown code fence/非严�?JSON/从文本提取工具名�?
- `backend/src/ai/services/*`：不同能�?供应商的服务拆分
- `backend/src/ai/providers/*`：供应商适配（以实现为准�?
- `backend/src/ai/dto/*`：请�?响应 DTO

## API（前缀 `/api/ai`，节选）
- `POST tool-selection`
- `POST generate-image`：返�?`imageUrl`（后端上�?OSS 后给前端），不再返回 base64 `imageData`
- `POST edit-image` / `blend-images`
- `POST analyze-image` / `text-chat`
- `POST remove-background`（含 public 变体�? `GET background-removal-info`
- `POST convert-2d-to-3d` / `expand-image`
- `POST generate-video` / `generate-video-provider` / `GET video-task/:provider/:taskId`
- `POST video-task-success` / `POST video-task-refund`（异步视频任务前端轮询后的成�?失败回写�?
- `POST generate-paperjs` / `img2vector`
- `GET veo/models` / `POST veo/generate`
- `POST dashscope/generate-wan2-6-*`
- `POST analyze-video`
- `POST minimax-speech` / `POST minimax-music`
- `GET banana-route-success-rates`：按客户端时区统计当天 Banana `normal/stable` 路线成功率，返回成功/失败/处理中调用数，供工作区顶部路线切换展示

## Agent Runtime
- `backend/src/agent/*` provides the first-stage Agent Runtime skeleton outside `/api/ai`: `POST /api/agent/runs` creates an authenticated in-memory run, and `GET /api/agent/runs/:runId/events` streams run/step/plan/tool events over SSE.
- Current Agent runs are planning/trace-only and intentionally hand off actual generation/edit/text execution to the existing AI Chat tool paths, preserving current billing, async task, OSS, and refund semantics.
- The initial workflow detector recognizes research/case lookup, image generation/edit/blend/analyze, video, vector, and text chat intents, emitting visible plan steps and a suggested existing tool.
- `research_cases` emits an additional `research_result` event with architecture case cards, source links, and image slots. When `VOLC_SEARCH_ENABLED=true`, backend calls the Volcengine search API through `VolcResearchSearchService` (`VOLC_SEARCH_*`), asks the configured text model (`VOLC_SEARCH_SUMMARY_MODEL` / `ARK_WEB_SEARCH_MODEL` / default text model) to extract structured case JSON from those real web sources, then searches images for the extracted cases. Deterministic static case cards are only used when search is disabled, fails, or returns no parseable cases/results.

## 注意事项
- `NewApiProvider` image generate/edit/blend only sends the upstream `size` field when callers provide an explicit `aspectRatio`; omitted/Auto aspect ratio stays omitted instead of falling back to `1:1`.
- `NewApiProvider` text chat retries once without `web_search_preview` when an enabled web-search tools request fails with an upstream tools/5xx-style error. Successful fallback responses carry `metadata.webSearchFallback = true`, and `POST /api/ai/text-chat` returns readable `503` provider failures instead of a generic Nest 500.
- `generate-image` 在上游仅返回外链 `imageUrl`（如 Seedream/Nano2）时，会统一下载并转�?OSS 后返回稳�?URL；管理员/白名单只跳过水印，不再直返第三方临时链接�?
- 图像同步接口（`generate-image` / `edit-image` / `blend-images`）现要求“成功响应必须包含可用图像载荷（`imageData` �?`imageUrl`）”；若上游出�?`HTTP 200` 但空图返回，接口会按失败处理并进入积分失�?退款路径，避免假成功扣分�?
- Seedream5 supports system setting key seedream5_provider (doubao / watcha), defaulting to doubao when missing.
- `GET /api/ai/seedream5/provider` returns current Seedream channel provider/model for frontend node UI capability gating.
- Seedream5 image generation now accepts optional `modelVersion` (`4.5` / `5.0`): when provider is doubao it maps to `doubao-seedream-4-5-251128` or `doubao-seedream-5-0-260128`; when provider is watcha it stays pinned to watcha model (default `seedream-5.0-lite`).
- Watcha Seedream channel env vars: WATCHA_SEEDREAM_API_KEY, optional WATCHA_SEEDREAM_ENDPOINT, optional WATCHA_SEEDREAM_MODEL.
- Tencent route for `kling-2.6` uses official start-end mapping: first frame goes to `FileInfos` (`Usage=FirstFrame`) and tail frame goes to `LastFrameUrl`; non-start-end reference images use `Usage=Reference`.
- Tencent `kling-2.6` output constraints are normalized server-side: duration `5/10`, resolution `720P/1080P`, and start-end mode always sends `OutputConfig.AudioGeneration=Disabled`.
- `generateVideo` now prioritizes `klingModel=kling-v3-0` as managed `kling-3.0` routing, even if payload provider is `kling-o3`, to avoid accidentally entering `kling-3.0-omni` execution path.
- `queryTask` now detects managed Tencent task prefixes before provider-branch routing, ensuring `kling-v3-0` polling remains correct even when request provider is `kling-o3`.
- Seedance（doubao）视频任务成功后，后端会将上游视频拉取并上传�?OSS，仅返回自有 OSS 公网链接给前端�?
- Seedance 2.0 现在统一�?`seedance-2.0` 模型管理键，但运行时可按请求里的 `seedanceModel` �?`doubao-seedance-2-0-260128` �?`doubao-seedance-2-0-fast-260128` 间切换；`ai.controller` �?Seedance 2 权益校验也会同时识别 `2.0` �?`2.0-fast`�?
- `generate-video-provider` 在解析到模型管理线路后，会把该线路 `pricing.displayConfig.defaultSelections` 补进缺失的计费参数（如 Seedance 2.0 默认 `resolution=720P`、`duration=5`），确保对话框等非画布入口也能命中规格定价。
- 快乐马 `POST /api/ai/dashscope/generate-happyhorse-video` 默认仅允许已登录付费用户调用：成功支付过任意订单（充值或会员）可用；未支付过的会员用户需当前有效套餐 metadata 显式配置 `happyhorseAccess: "enabled"`；免费档默认不支持。该接口创建 DashScope 任务后立即返回 `taskId/apiUsageId`，前端通过 `/api/ai/dashscope/task/:taskId` 轮询并在成功/失败时回写积分状态。
- Seedance 2.0 直连方舟链路已支持媒体优先请求：�?prompt 但有图片/视频/音频参考时不再错误拼接 `undefined` 文本；并同步放宽到官�?`4-15s`、`480P/720P`�? 种宽高比以及多模态参考组合�?
- Seedance 2.0 模式选择会通过 `video_mode` 下发到方舟请求体，确�?`Seedance 2.0` 节点的模式化输入在上游生效�?
- Seedance 2.0 全能参考 (`reference_images`) 运行时要求所有图片使用 `reference_image` 角色；当 new-api `/v1/videos` 兼容层把图片误解释为首帧并返回 `first/last frame content cannot be mixed with reference media content` 时，后端会自动改走 managed V2/Ark `content` 直连兜底。
- Seedance 2.0 权益识别补齐 `seed-2.0-pro / seed-2.0-mini`（含别名），避免 2.0 家族模型在后端分支判断中被误判为 1.5。
- 异步视频计费为“先扣费 + 后确认”：创建任务后记录保�?`pending`，前端轮询成功调�?`video-task-success` 标记 `success`，失败调�?`video-task-refund` 标记失败并退款�?
- `edit-image` / `blend-images` 支持 `sourceImageUrl(s)`，后端会�?OSS 白名单拉取并转换�?dataURL�?
- Banana 文本链路（`text-chat` / `tool-selection`）支持独立于图像链路的供应商配置�?`banana_text_provider`：`auto`（Apimart�?47）、`legacy_auto`�?47→Apimart）、`apimart`、`legacy`�?
- Banana `tool-selection` 在 stable/尊享路线走腾讯文本通道时会带上前端上下文；本地兜底识别 `改文字` / `改成` / `替换文字` 等缓存图编辑意图，避免工具选择失败时落到纯文本聊天。
- Banana 文本�?Apimart 时使�?`https://api.apimart.ai/v1/chat/completions`（OpenAI Chat Completions 兼容格式），鉴权复用 `NANO2_API_KEY`�?
- Banana 文本链路按档位映射：`Fast (banana-2.5) -> gemini-2.5-flash`、`Pro (banana) -> gemini-3-pro-preview`、`Ultra (banana-3.1/nano2) -> gemini-3.1-pro-preview`；其�?Ultra �?147 �?Apimart 通道均统一使用 `gemini-3.1-pro-preview`�?
- `POST /api/ai/analyze-image` 默认优先使用 `gemini-3.1-pro`（语言模型）做多模态分析；`banana-2.5` 仍保�?`gemini-2.5-flash-image-preview`�?
- `POST /api/ai/analyze-image` 检测到 PDF（`data:application/pdf` / PDF URL / PDF base64 头）时按文档理解处理：后端会避开图片生成/分析模型，选择对应档位的文本模型，并在 new-api OpenAI 兼容请求中使用 `type=file` + `file_data`，由 new-api 转成 Gemini `application/pdf` inlineData。
- 图像分析链路遇到上游配额/限流�?29 / quota / resource exhausted）时，后端会在退款后透传 HTTP `429`，不再统一返回 `500`�?
- `minimax-music` 默认强制 `output_format=url`、`stream=false`，并在上游返�?`status=1`（合成中）或请求超时时返回友好错误提示�?

## 2026-05-05 lt-dev9 选择性迁移补充
- `POST /api/ai/text-chat` 在非 Gemini provider 路径会把 provider 返回的 `webSearchResult` 与 `metadata` 一并透传给前端，保持 AI Chat/Flow 文本节点元数据链路一致。
- `buildCreditRequestParams` 会保留调用方显式传入的 `channelHint`；仅当 Banana route 或 Banana/Nano provider 有更明确路线时才覆盖。
- `POST /api/ai/analyze-video` 计费对齐 `lt-dev9`：节点默认 `60` 积分，且按 Banana route/channel 与 Fast/Pro/Ultra 档位动态扣费（normal `60/90/120`，stable `80/120/160`）。
- `VideoProviderService` 的远程视频转存缓存改为 `{ url, touchedAt }`，缓存命中会刷新访问时间，并按 1 小时 TTL / 500 条上限清理，避免长时间运行的后端进程无限增长。

## 配置项（以代码与环境为准�?
- Gemini/第三方：`GOOGLE_GEMINI_API_KEY`、`RUNNINGHUB_API_KEY` �?
- 视频/供应商：`DASHSCOPE_API_KEY`、`SORA2_API_ENDPOINT`、`BANANA_API_KEY` �?
- Banana/Apimart 文本与图像：`BANANA_API_KEY`�?47）、`NANO2_API_KEY`（Apimart�?

## 2026-04-24 Update
- Nano2/GPT-Image-2 request passthrough supports `official_fallback` boolean; backend default fallback for `gpt-image-2` is now `false` when frontend does not specify it.
- Backend node default metadata for `gptImage2` now exposes `resolutions: [1K,2K,4K]` and enables `showResolutionSelector`.

## 2026-05-12 GPT-Image-2 Timeout & Async Notes
- Prefer async image task APIs for GPT-Image-2 high-quality/large-size runs: `POST /api/ai/generate-image-async` then poll `GET /api/ai/image-task/:taskId`.
- Backend polling budget is 15 minutes; task `failed` status enters refund-safe flow.
- For any remaining synchronous image path, external gateway/proxy should keep timeout >= 900s to reduce premature `HTTP 524`.

## 2026-05-12 Seedance Update
- Video provider keeps `seed-2.0-lite` as compatibility input alias, but runtime model routing no longer sends `doubao-seed-2-0-*` to the content-generation endpoint.
- Seed2 compatibility aliases now normalize to content-generation-capable Seedance model IDs:
  - `doubao-seed-2-0-pro(-260215)` -> `doubao-seedance-2-0-260128`
  - `doubao-seed-2-0-lite(-260428)` -> `doubao-seedance-2-0-fast-260128`
  - `doubao-seed-2-0-mini(-260428)` -> `doubao-seedance-2-0-fast-260128`
- For Seedance 2.0 create failures on the `-fast` model with model-invalid/not-support errors, backend retries once with `doubao-seedance-2-0-260128`.

## 2026-05-16 Seed2 Alias Hardening
- Managed Seedance 2.0 V2 create-task path now normalizes known legacy model aliases before upstream calls:
  - `doubao-seed-2-0-pro` -> `doubao-seedance-2-0-260128`
  - `doubao-seed-2-0-lite` -> `doubao-seedance-2-0-fast-260128`
  - `doubao-seed-2-0-mini` -> `doubao-seedance-2-0-fast-260128`
  - `doubao-seedance-2-0` -> `doubao-seedance-2-0-260128`
- This prevents `model ... does not support content generation` errors caused by outdated or custom requestProfile model values.
