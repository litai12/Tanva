# 后端模块：AI（backend-ai�?

## 作用
- 提供图像生成/编辑/融合/分析、文本对话、背景移除�?D�?D、图片扩展、视频生成、Paper.js/向量化等能力�?

## 2026-07-31 Seedance 2.5
- `generate-video-provider` 接受内部子型号 `seedance-2.5`（兼容 `seedance-2-5`、`2.5` 与 Ark ID 别名），统一规范化后由 `VideoProviderService` 精确发送上游模型 ID `doubao-seedance-2-5`。
- 2.5 继续复用 Seedance 2.x 的 4–15 秒节点规格、模式推导、一次性 Ark 图片/视频/音频素材组、任务轮询与参考视频真实时长探测；计费上下文仍使用“输出时长 + 所有唯一参考视频时长”，上游 DTO 只保留输出时长。
- 2.5 只允许 `480P`、`720P`。Flow 会在型号切换时回落非法值，`AiController` 在积分预扣和上游提交之前再次校验，历史节点携带 `1080P/4K` 时返回 HTTP 400。
- 2.5 仅走 `seedance_api/default` 普通通道；前端隐藏 Tencent VOD 尊享选项，后端会把历史节点残留的 VIP vendor/tier 强制归一为官方普通通道，避免静默执行成 2.0。Ark adapter model list 与 PostgreSQL ability 由 `new-api/patches/2026-07-31/001-add-doubao-seedance-2-5.sql` 注册；补丁只克隆已有 2.0 官渠，不创建或写入凭据。

## 图片生成输入边界
- `generate-image*`、`edit-image*`、`blend-images*` 的参考图/源图只接受远程 HTTP(S) URL。Controller 会先拒绝 `data:`、`blob:`、裸 base64，再执行现有 URL 白名单与 SSRF 校验。
- `ImageTaskService.createTask` 在写任务记录和 BullMQ 入队前重复校验 `imageUrls/sourceImage/sourceImages`，保证内联图片不会进入任务 `requestData` 或 Redis。
- `NewApiProvider` 在组装生成、编辑、融合的 `image_urls` 时做最终远程 URL 校验；校验失败直接终止，不允许包装或透传 base64。图像分析和 PDF 分析的独立内联输入能力不受这条生成任务规则影响。

## Seedance 一次性审核素材
- 带普通参考图、参考视频或参考音频的 Seedance 2.0 请求不再复用画布持久化的 `volcAssetId`。`VideoProviderService.generateVideo` 会先去掉所有旧图片句柄，再由 `VolcAssetService.createTaskAssetGroup` 为本次运行创建隔离组，将当前远程渲染资源按 `Image` / `Video` / `Audio` 上传并等待全部素材可用；提交 SD2 时三类输入分别替换为对应的 `asset://` URI。显式 `bio-auth` 图片句柄保留，因为它承载用户活体授权；若其 ID 丢失则要求重新认证，不能以普通素材替代。
- `generate-video-provider` 在积分预扣和 Ark 上传前会服务端校验 SD2 参考媒体：视频、音频各最多 3 条；单条参考视频需在 2–15 秒，单条参考音频需在 2–5 秒。超限时返回包含当前条目序号和实际秒数的 HTTP 400；Ark 仍返回的参数/审核错误统一称为“素材”，不再误导为仅图片尺寸问题。
- Hailuo H3 的参考图允许在运行时暂存为 `data:image/*;base64,...`，但 `VideoProviderService` 会在发送 `/v1/videos` 前上传到 OSS 并替换为 HTTPS URL；Tencent VOD 内部 endpoint 仍保留同样的最终兜底，禁止把内联 base64 放进 `FileInfos[].Url` 或 `LastFrameUrl`。
- 创建任务成功后以实际返回的、包含路由前缀的 `taskId` 绑定 `VolcTaskAssetGroup`；`queryTask` 观察到成功、失败、取消等终态后触发删组。同步创建失败立即删组，删除失败保留 `cleanup_failed`，每小时清理所有超过 `VOLC_TASK_ASSET_GROUP_TTL_HOURS`（默认 24）的遗留记录。
- 上游若对本次刚创建的句柄返回 `InvalidParameter` / `content[n].image_url.url` / `specified asset ... is not found`，后端删除该组并重新审核一次；重试仍失败才结束原请求。重审发生在同一次计费与幂等请求内。
- 前端不再在图片连线或点击 Run 前调用 `/api/volc-asset/upload`，也不显示“审核后可用于 sd2”的缓存状态；参考图继续先上传 Tanva OSS，确保裁剪/变换后的当前渲染资源才是审核与生成输入。

## 关键文件
- `backend/src/ai/ai.controller.ts`：`/ai/*` 路由集合（主要入口）
- `backend/src/ai/ai.service.ts`：AI 业务逻辑（Gemini 等）
- `backend/src/ai/tool-selection-json.util.ts`：工具选择响应提取/解析（支持前后缀文本/markdown code fence/非严�?JSON/从文本提取工具名�?
- `backend/src/ai/services/*`：不同能�?供应商的服务拆分
- `backend/src/ai/services/image-reuse-cache.service.ts`：纯文生图结果复用缓存；生成请求按完整参数签名查找未取用的 OSS 图片资产，默认使用全站共享池，缓存命中仍走正常积分扣费
- `backend/src/ai/providers/*`：供应商适配（以实现为准�?
- `backend/src/ai/dto/*`：请�?响应 DTO

## API（前缀 `/api/ai`，节选）
- `POST tool-selection`
- `POST generate-image`：返�?`imageUrl`（后端上�?OSS 后给前端），不再返回 base64 `imageData`
- `POST edit-image` / `blend-images`
- `POST analyze-image` / `text-chat`
- `POST remove-background`（含 public 变体�? `GET background-removal-info`
- `POST convert-2d-to-3d`（兼容同步接口）/ `POST convert-2d-to-3d-async` / `GET convert-2d-to-3d/task/:taskId` / `expand-image`
- `POST generate-video` / `generate-video-provider` / `GET video-task/:provider/:taskId`
- `POST video-task-success` / `POST video-task-refund`（异步视频任务前端轮询后的成�?失败回写�?
- `POST generate-paperjs` / `img2vector`
- `GET veo/models` / `POST veo/generate`
- `POST dashscope/generate-wan2-6-*`
- `POST analyze-video`
- `POST minimax-speech` / `POST minimax-music`
- `GET banana-route-success-rates`：按客户端时区统计当天 Banana `normal/stable` 路线成功率，返回成功/失败/处理中调用数，供工作区顶部路线切换展示

## 2026-07-22 Hunyuan 3D Async Conversion
- 通用 2D 转 3D 的真实上游是腾讯混元 3D 3.1，不经过 GPT/new-api，也不是 RunningHub。异步提交立即返回确定性 `taskId`，后台继续提交、轮询混元任务并把 GLB/GLTF 持久化到 OSS。
- 客户端为一次画布操作生成稳定的 `clientRequestId`；后端按 `userId + taskType + clientRequestId` 计算 `VideoTask.id`，数据库主键负责并发原子去重。只有首次创建成功的请求启动后台生成，同一请求重试只返回原任务。
- 状态查询先校验 `VideoTask.userId`，再合并内存状态与持久化结果；即使内存状态已过期或进程重启，已落库的成功/失败结果仍可查询。计费层使用同一个幂等键，记录 `provider=hunyuan-3d`、`model=3.1`。

## 2026-07-22 new-api GPT Text Routing
- 非小T文本请求统一经 `NewApiProvider` 发送到 new-api `/v1/chat/completions`：普通对话、提示词优化、工具选择和 PDF 分析默认 `gpt-5.4`；HTML PPT、Paper.js、图像转矢量与普通 Agent 研究默认 `gpt-5.6-luna`，不得发送裸 `gpt-5.6`。图片识别/分析是独立的 Gemini 三档链路，不随文本模型切换。
- Tanva 后端只持有 `NEW_API_BASE_URL` / `NEW_API_KEY`。tc-api 的地址、`tc_sk` 和上游模型映射由 new-api 渠道集中管理；后端不再读取 `TC_API_BASE_URL`、`TC_API_KEY`、`TAPCANVAS_API_BASE_URL` 或 `TAPCANVAS_API_KEY`。
- new-api 的 `default` 分组必须存在已启用的普通 `gpt-5.4`、`gpt-5.6-luna` abilities；小T专属 Fast/Pro/Ultra/DeepSeek facade 不能承载这些普通文本请求。网关缺 ability 时在 new-api 管理后台补渠道、上游 base URL 与 key，不在 Tanva 后端增加直连凭据或 fallback。
- `image_url`、`web_search_preview` 与 `thinking_level` 继续按 OpenAI-compatible Chat payload 交给 new-api，由网关负责上游适配。积分配置、API usage `channelHint` 与成功响应 metadata 都标记为 `new-api`。
- 视频分析由 `resolveVideoAnalysisModel` 校验节点显式模型；默认豆包 Seed 2.0 Lite，也支持豆包 Mini/Pro 与 Gemini 三档。小T走独立 facade，可选 Fast 小T-5.4、Pro 小T-5.5、Ultra 小T-5.6 Luna 和小T-DeepSeek V4 Flash。
- 无真实调用验证：`npm run verify:new-api-text-routing` mock `fetch`，覆盖 GPT-5.4 文本、联网工具与 thinking 字段、GPT-5.6 Luna 图像分析、统一 new-api URL/鉴权，以及只有 tc-api key 但缺少 `NEW_API_KEY` 时显式失败。

## 2026-07-31 Video Analysis Model Selection

- `POST /api/ai/analyze-video` 的默认模型为 `doubao-seed-2-0-lite-260428`。豆包 Mini/Lite/Pro 统一调用 `NewApiProvider.analyzeVideo`，以 new-api `/v1/responses` 的 `input_video.video_url` 传入经过白名单校验的远程视频 URL，`max_output_tokens=16384`，模型请求不转 base64 或抽帧。Lite 会另行把远程文件安全下载到临时目录并用 `ffprobe` 获取权威计费时长，探测完成后立即删除，不写入项目、数据库或 OSS。
- new-api 的 `default` 分组必须启用所选豆包 Seed 2.0 视频理解模型 ability，并配置可处理 Responses API 的火山渠道；Tanva 不保存或直连火山凭据。
- Gemini 2.5 Flash/3.5 Flash/3.1 Pro 继续走既有兼容路径：不超过 15MB 时最后一跳使用 Chat Completions `file.file_data` 完整视频，超限时抽帧、上传临时远程 URL、逐帧理解后总结；临时文件和帧在结束时清理。
- 视频分析模型白名单由 Controller 统一校验，旧 Gemini Preview 别名仍映射到当前模型。`npm run verify:new-api-video-analysis` 以 mock `fetch` 同时验证豆包 Responses 远程视频负载、Gemini inline file_data 负载及非法输入拦截。
- Lite 计费锚定标准付费 Seedance 2.0 480P 的 `1/3`。当前锚点为 `1.25 元/秒 = 125 积分/秒`，所以 Lite 精确单价为 `125/3 积分/秒`；定价器先用后端识别的完整视频时长计算精确总价，再向上取整一次。前端可用媒体 metadata 调用 `/api/credits/preview` 展示预估，但实扣不信任客户端时长。Mini/Pro 继续使用 Responses 返回的真实输入、缓存、音频与输出 token，并按火山官方三档价格 `×1.5`、`100 积分 = 1 元` 后扣。API usage 的 `pricingSnapshot` 保存各自定价依据，只供服务端与管理员审计；公开 `billing` 对 Lite 返回 `billingMode/creditsCharged/durationSec`，用户 usage 会剔除内部快照。
- 剧本转分镜的自定义 Skill 使用独立 `StoryboardSkill` 表，字段为 `userId/name/content/createdAt/updatedAt`，删除用户时级联删除；`GET/POST/DELETE /api/storyboard-skills` 全部经过 JWT 并在 Service 层再次绑定 `userId`，只允许当前账号列出、更新和删除自己的 Skill。部署需执行 `202607310001_add_storyboard_skills` migration。Skill 文本不写入项目设计 JSON。
- 旧 `2026-05-14/001` 只写 options、没有注册可路由能力。生产必须继续执行新幂等补丁 `new-api/patches/2026-07-31/002-enable-doubao-seed-2-0-video-analysis.sql`，它补齐三条 model catalog、`ark-doubao.models`、`default`/渠道分组 abilities，并将 `[0,32K]` 基础倍率从旧 `×1.2` 修正为 `×1.5`。`npm run verify:doubao-video-analysis-pricing` 覆盖分档边界、缓存/音频 token、100 积分兑 1 元和整数舍入。

## 2026-07-30 Wan / HappyHorse new-api Routing

- 旧客户端继续调用 `/api/ai/dashscope/*` 兼容 URL，但 Wan2.6 T2V/I2V/R2V、Wan2.7 I2V 与 HappyHorse 全部由后端提交到 new-api `/v1/videos`；新任务统一使用 `newapi:` 前缀并通过网关查询。
- Tanva 后端只持有 `NEW_API_BASE_URL` / `NEW_API_KEY`，不再读取或部署 `DASHSCOPE_API_KEY`。真实 DashScope 凭据只允许保存在 new-api 的 type `17` 阿里渠道中，渠道需为 `default` 分组启用对应模型 abilities。
- 为兼容现有前端，Wan2.6 T2V 与 R2V 仍在后端等待任务终态并返回同步 `videoUrl`；Wan2.6 I2V、Wan2.7 I2V 与 HappyHorse 继续异步返回任务 ID，积分保持 pending，最终由现有成功/退款回写接口结算。
- 无付费验证：`npm run verify:dashscope-new-api-routing` mock new-api，检查 HappyHorse `media[]`、Wan R2V `reference_video_urls`、原生参数透传、`newapi:` 任务前缀，并阻止 Controller 恢复 DashScope 直连地址或环境变量。

## 2026-06-17 Omni Flash Ext APIMart
- `managedModelKey=omni-flash-ext` resolves to the APIMart new-api video model via the default `model_provider_mapping_v2` `new_api` vendor and keeps credit routing on the same managed model instead of falling through to Kling 2.6 defaults.
- The new-api APIMart payload builder has an `omni-flash-ext` branch: prompt is required; `image_urls` are collected from standard image fields and metadata content; up to 3 images are accepted, and 2+ image requests require `generation_type=reference`; `video_urls` are collected from reference video fields/metadata, limited to one URL, and cause `duration` to be omitted.
- Omni reference-video requests now force `generation_type=reference` at both backend and new-api layers, so upstream no longer sees `frame` plus `video_urls`.
- APIMart accepts the upstream model string as `Omni-Flash-Ext`; the lowercase `omni-flash-ext` remains only the Tanva/new-api internal route key. If new-api admin/task data is missing on PostgreSQL, run `new-api/patches/2026-06-17/001-fix-omni-flash-ext-apimart-data.sql` through the patch runner and restart/reload new-api caches. Local SQLite-only runs can apply the companion `new-api/patches/2026-06-17/001-fix-omni-flash-ext-apimart-data.sqlite` manually; it intentionally has no `.sql` suffix so the PostgreSQL runner skips it.

## 2026-07-21 ToAPIs Seedance 2 Pricing
- `seedance-2`, `seedance-2-fast`, and `seedance-2-mini` use the same upstream cost ratio `31.25` and a retail multiplier of `1.5`, yielding `ModelRatio=46.875` for all three SKUs.
- Their per-second billing multiplier is the explicit output `duration` plus the real duration of every unique reference video. A 5-second input plus a 5-second output therefore bills 10 seconds.
- The APIMart/ToAPIs adaptor normalizes top-level `reference_videos`, top-level or metadata `video_with_roles`, metadata `video_url`/`video_urls`, and metadata `content` video entries into canonical `video_with_roles` inputs. It probes reachable MP4 URLs before pre-charge, rejects unreadable durations, and requires an explicit positive output duration so automatic output length cannot be undercharged.
- Fresh new-api deployments receive the same defaults from `setting/ratio_setting/model_ratio.go`; existing PostgreSQL deployments apply `new-api/patches/2026-07-21/001-raise-seedance2-markup-to-1-5.sql` only during an authorized production deployment.

## 2026-07-21 Canvas Seedance 2 Credits
- Flow canvas credit previews and `CreditChargeService` personal/team pre-deductions use the same Seedance 2.0, Fast, and Mini pricing policy. Existing canvas per-second prices are scaled by `1.5 / 1.2 = 1.25`; Mini uses the Fast 480P/720P rate because both use the Fast upstream lane.
- The billing context records `outputDurationSec`, `inputVideoDurationSec`, and `billingDurationSec`. Managed pricing evaluates the total duration while the upstream generation request keeps the requested output duration.
- The node preview sums durations from unique connected video sources for immediate feedback. Before actual deduction, `ReferenceVideoDurationService` independently downloads each unique public HTTP(S) reference, rejects local/private targets and oversized files, then runs `ffprobe` against a temporary file. Any unreadable reference aborts before credit deduction and provider submission.
- At 720P, a 5-second input plus a 5-second output currently previews/deducts 1500 credits for Seedance 2.0 and 1208 credits for Fast or Mini. Requests without video input continue to bill only the output duration. Seedance 1.5 and non-Seedance video models are unchanged.
- `calculateSeedance20BillingDuration` is the backend SSOT for combining the explicit output duration with all probed reference-video durations. `generate-video-provider` calls it after `ReferenceVideoDurationService` probing and before `CreditChargeService.begin`, so insufficient balance is rejected before any upstream task is created. Run `npm run verify:seedance-billing` to guard the formula and millisecond precision.

## Agent Runtime
- `backend/src/agent/*` provides the first-stage Agent Runtime skeleton outside `/api/ai`: `POST /api/agent/runs` creates an authenticated in-memory run, and `GET /api/agent/runs/:runId/events` streams run/step/plan/tool events over SSE.
- 小T大脑使用专属门面模型：Fast=`xiaot-agent-gpt-5-4`、Pro=`xiaot-agent-gpt-5-5`、Ultra=`xiaot-agent-gpt-5-6-luna`、DeepSeek=`xiaot-agent-deepseek-v4-flash`，默认与非法值回退为 Fast。用户侧将 GPT 系门面统一外显为 `小T-5.4|5.5|5.6 Luna`，DeepSeek 外显为 `小T-DeepSeek V4 Flash`。Tanva new-api 的 `xiaot-agent` 渠道通过 `model_mapping` 翻译成 TapCanvas facade 真实模型；不能直接请求裸模型名，否则会绕过小T facade。生产 new-api 需执行幂等补丁 `new-api/patches/2026-08-02/001-add-xiaot-deepseek-v4-flash.sql`。
- 小T 对话计费为“成功回合固定 `2` 积分”，所有可选大脑同价。facade 终帧的 `usage.total_tokens` 仍写入 `requestParams.usageUnits` 供审计，但不再换算 Tanva 积分。`flow_patch/runNode`、`legacy_image_only`、`analyze_image` 等生成/分析任务继续由宿主 API 单独计费，不包含在这 `2` 积分中。可运行 `cd backend && npm run verify:xiaot-chat-pricing` 做无付费 mock 验证。
- Current Agent runs are planning/trace-only and intentionally hand off actual generation/edit/text execution to the existing AI Chat tool paths, preserving current billing, async task, OSS, and refund semantics.
- The initial workflow detector recognizes research/case lookup, image generation/edit/blend/analyze, video, vector, and text chat intents, emitting visible plan steps and a suggested existing tool.
- `research_cases` emits a text-first `research_text` event before `research_result`: the first stage uses the same NewAPI Text provider path as `/api/ai/text-chat`, including the UI-selected `model`, `providerOptions` route payload, `thinkingLevel`, and `enableWebSearch=true`, while user-facing progress copy describes this generically as a web-connected text answer. It returns that text/web-search metadata, then extracts project keywords from the text. Keyword extraction is configurable with `AGENT_RESEARCH_KEYWORD_EXTRACT_MODE=hybrid|ai|rule` (default `hybrid`): AI reads both the original user prompt and the Text answer, then the backend merges title-rule extraction as fallback; `AGENT_RESEARCH_KEYWORD_EXTRACT_TIMEOUT_MS` bounds the extra AI extraction call. `VolcResearchSearchService` (`VOLC_SEARCH_*`) uses only those extracted keywords for project-level Volcengine web/image search; it no longer injects local static case libraries or hard-coded architect fallback seeds. `research_result.data` keeps the compatibility `result` payload and also returns explicit `text` and `volc` branches so clients can display the text-stage answer and the Volcengine structured cases/sources/images together. Research steps are emitted as real progress instead of pre-completed placeholders, and Volcengine web/image/model calls are bounded by timeout config (`VOLC_SEARCH_TIMEOUT_MS`, `VOLC_SEARCH_WEB_TIMEOUT_MS`, `VOLC_SEARCH_IMAGE_TIMEOUT_MS`, `VOLC_SEARCH_MODEL_TIMEOUT_MS`, plus Agent-level `AGENT_RESEARCH_TEXT_TIMEOUT_MS` defaulting to 60s and `AGENT_RESEARCH_SEARCH_TIMEOUT_MS`) so slow upstreams fall back to an explicit result instead of leaving SSE open indefinitely. If the text stage still fails, the backend derives non-static search queries from the user prompt (for example sports architecture/stadium terms) so Volcengine does not receive an empty keyword list. When search is disabled, fails, or returns no matching cases/results, the backend keeps the text-stage reply and returns an explicit no-result summary instead of unrelated static case cards.

## 注意事项
- `NewApiProvider` image generate/edit/blend only sends the upstream `size` field when callers provide an explicit `aspectRatio`; omitted/Auto aspect ratio stays omitted instead of falling back to `1:1`.
- `NewApiProvider` normalizes Gemini image `aspectRatio` before calling new-api: Gemini 2.5/Pro use the base supported set (`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`), while Gemini 3.1 Flash additionally allows `1:4`, `4:1`, `1:8`, and `8:1`; unsupported values such as `2:1`, `1:2`, or `9:21` snap to the nearest supported ratio instead of failing upstream.
- `NewApiProvider` text chat retries once without `web_search_preview` when an enabled web-search tools request fails with an upstream tools/5xx-style error, including `HTTP 520: openai_error`. Successful fallback responses carry `metadata.webSearchFallback = true`, and `POST /api/ai/text-chat` returns readable `503` provider failures instead of a generic Nest 500.
- `generate-image` 在上游仅返回外链 `imageUrl`（如 Seedream/Nano2）时，会统一下载并转�?OSS 后返回稳�?URL；管理员/白名单只跳过水印，不再直返第三方临时链接�?
- `generate-image` / `generate-image-async` 第一版支持纯文生图复用缓存：仅无参考图、无联网搜索、单张输出的请求会构造 `imageReuseCacheSignature`；默认 `IMAGE_REUSE_CACHE_SCOPE=global`，同签名且当前用户尚未取用的全站 active 资产池达到 `IMAGE_REUSE_CACHE_MIN_POOL_SIZE`（默认 3）后，才会命中 `GenerationImageAsset` 并直接返回缓存 OSS URL；如需退回单用户隔离，可设置 `IMAGE_REUSE_CACHE_SCOPE=user`。已被当前用户取用的资产不会继续计入该用户的命中门槛，避免缓存用完后出现“新生成一张、下一次立刻复用一张”的循环；缓存命中仍通过原 `withCredits` / `preDeductCredits` 计费，并在返回前等待 `IMAGE_REUSE_CACHE_HIT_DELAY_MS`（默认 8000ms，0 可关闭）让 Flow 进度条保持自然运行。真实生成成功后会写入 `GenerationImageAsset`，资产仍保留原生成者 `userId`，`GenerationImageReuse.userId` 记录领取者。
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
- 文本与多模态分析默认统一使用 APIMart 可用的 `gemini-3.1-pro-preview`；历史 `gemini-3.1-pro` 仅作为 new-api 兼容门面，并由 APIMart 渠道映射到 `gemini-3.1-pro-preview`，不得再把无 `-preview` 的名称原样发送上游。`banana-2.5` 仍保留 `gemini-2.5-flash-image-preview`。
- `POST /api/ai/analyze-image` 检测到 PDF（`data:application/pdf` / PDF URL / PDF base64 头）时按文档理解处理：后端会避开图片生成/分析模型，选择对应档位的文本模型，并在 new-api OpenAI 兼容请求中使用 `type=file` + `file_data`，由 new-api 转成 Gemini `application/pdf` inlineData。
- 图像分析链路遇到上游配额/限流�?29 / quota / resource exhausted）时，后端会在退款后透传 HTTP `429`，不再统一返回 `500`�?
- `minimax-music` 默认强制 `output_format=url`、`stream=false`，并在上游返�?`status=1`（合成中）或请求超时时返回友好错误提示�?

## 2026-05-05 lt-dev9 选择性迁移补充
- `POST /api/ai/text-chat` 在非 Gemini provider 路径会把 provider 返回的 `webSearchResult` 与 `metadata` 一并透传给前端，保持 AI Chat/Flow 文本节点元数据链路一致。
- `buildCreditRequestParams` 会保留调用方显式传入的 `channelHint`；仅当 Banana route 或 Banana/Nano provider 有更明确路线时才覆盖。
- `POST /api/ai/analyze-video` 的 Gemini 兼容路径仍保留既有固定档位；豆包 Lite 按真实视频时长与 Seedance 2.0 480P 的 `1/3` 计费，Mini/Pro 按官方 token 分档价 `×1.5` 后扣。旧 normal `60/90/120`、stable `80/120/160` 不得再用于豆包报价或扣费。
- `POST /api/ai/analyze-video` 对不超过 15MB 的受支持视频优先使用完整视频理解：远程视频下载到临时文件后，仅在调用 new-api 的最后一跳编码成 `file.file_data=data:video/*;base64,...`，因此 Gemini 能读取连续动作、字幕和音频；该 base64 不进入设计 JSON、DB、Redis、OSS 或任务持久化字段。超过 15MB 或 provider 不支持完整视频时，才回退到抽帧链路：JPEG Buffer 上传短生命周期 OSS URL 后逐帧识别，并在结束时删除临时帧和本地视频。旧 `gemini-3-flash-preview` / `gemini-3.1-pro-preview` 分别兼容映射到 `gemini-3.5-flash` / `gemini-3.1-pro`。
- `VideoProviderService` 的远程视频转存缓存改为 `{ url, touchedAt }`，缓存命中会刷新访问时间，并按 1 小时 TTL / 500 条上限清理，避免长时间运行的后端进程无限增长。

## 配置项（以代码与环境为准�?
- Gemini/第三方：`GOOGLE_GEMINI_API_KEY`、`RUNNINGHUB_API_KEY` �?
- 视频/供应商：`NEW_API_BASE_URL`、`NEW_API_KEY`、`SORA2_API_ENDPOINT`、`BANANA_API_KEY` �?
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
## 2026-07-24 Image Chat Gemini / ToAPIs

- `/api/ai/analyze-image` 的 Image Chat 三档使用 ToAPIs 模型广场真实基础 ID：Fast `gemini-2.5-flash`、Pro `gemini-3.5-flash`、Ultra `gemini-3.1-pro`，均走 OpenAI-compatible `/v1/chat/completions` 并显式发送 `max_tokens=4096`。接口只接受并直接传递远程 `image_url`，不下载或转换 base64；即使小T大脑是 `gpt-5.6-luna`，图片识别也必须通过 `analyze_image` 宿主工具切到上述 Gemini 模型。
- ToAPIs 数据补丁 `new-api/patches/2026-07-24/001-add-toapis-gemini-image-chat.sql` 为 type=59 ToAPIs 渠道追加模型与 abilities，并按 Tanva 后端 Image Chat 统一 `10 credits = RMB 0.10/次` 写入固定 `ModelPrice`。ToAPIs 2026-07-24 页面参考 token 价分别为 12/100、60/360、80/480 credits/1M input/output；产品对用户仍采用后端固定价。
- 小T capability manifest 暴露宿主工具 `analyze_image`。识图、图片描述、图片比较、提示词反推等任务必须调用该工具；宿主复用同一个 analyze endpoint、三档模型与积分逻辑，并从工具参数或当前消息附件收集图片。
