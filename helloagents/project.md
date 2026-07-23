# Tanva — 技术约定（SSOT）

## 目标
- 让新同学能在 30 分钟内跑起来前后端，并理解核心模块边界。
- 对代码现实进行记录：当知识库与代码冲突时，以代码为准并同步回知识库。

## 技术栈
- 前端：React 19 + TypeScript + Vite + Tailwind（含 Radix UI 组件）
- 后端：NestJS（Fastify adapter）+ Prisma + PostgreSQL
- AI/多媒体：`@google/genai` / `@google/generative-ai`、图片处理（background removal）、视频/帧等相关能力

## 仓库结构
- `frontend/`：前端应用（Vite）
- `backend/`：后端服务（NestJS）
- `frontend/docs/`：项目文档（大量中文文档）
- `ai-metadata/`：代码索引（imports/exports/依赖图/特征描述）
- `helloagents/`：本知识库（SSOT）

## 开发约定
### Node / 包管理
- Node.js：建议 `>= 18`
- 包管理：项目内主要使用 `npm`（`frontend/`、`backend/` 各自有 `package.json`）

### 常用命令
- 前端开发：`cd frontend && npm i && npm run dev`
- 前端检查：`cd frontend && npm run lint && npm run build`
- 后端开发：`cd backend && npm i && npm run dev`
- 后端构建：`cd backend && npm run build`

### 资源访问
- 直连 OSS/CDN：默认禁用 `/api/assets/proxy`，使用 `VITE_ASSET_PUBLIC_BASE_URL` 将 `projects/...` 等 key 拼成可访问 URL
- 如需重新启用代理：设置 `VITE_PROXY_ASSETS=true`
- 导演台内置模型、纹理与地形只发布到 TOS 的 `director-assets/v1/`，不再随 `frontend/public/` 打包；运行时优先通过 `VITE_ASSET_PUBLIC_BASE_URL` 直连，未配置时使用已部署的广州 TOS 公共基址，不允许回退到本地副本。重新发布时在仓库外准备保持 glTF 相对依赖结构的目录，再运行 `cd backend && DIRECTOR_ASSET_SOURCE_DIR=/absolute/staging/path npm run upload:director-assets`。

### API 前缀与文档
- 后端全局前缀：`/api`
- Swagger：`/api/docs`

### 设计 JSON（强约束）
- `Project.contentJson` / `PublicTemplate.templateData` 只允许保存远程 URL/路径引用；禁止 `data:`/`blob:`/base64 图片等内联内容进入 DB/OSS。
- UI 渲染（画板/图层/缩略图等）：避免直接用 `data:image/*`/裸 base64 做渲染；优先转为 `blob:`（objectURL）或走 `canvas`（参考 `frontend/src/components/ui/SmartImage.tsx`、`frontend/src/hooks/useNonBase64ImageSrc.ts`）。
- Canvas/Flow 正式图片资产必须先完成托管上传并取得远程 URL，再创建节点或图元；上传失败时阻止创建，不得以 `data:`、`blob:`、裸 base64 或未托管外链作为正式资产兜底。裁剪、蒙版、画笔等组件内部可短暂使用 Blob/object URL 预览，但保存、替换正式资产或提交 AI 生成前必须上传。
- AI 图片生成、编辑、融合的输入边界只接受远程 HTTP(S) URL：前端统一上传，后端 Controller 与 BullMQ 入队前再次校验，`NewApiProvider` 发送 `image_urls` 前最终校验。任何一层无法取得远程 URL 都必须失败关闭，禁止内联图片进入任务 `requestData`、Redis/BullMQ 或 new-api。

### Flow / AI 运行约定
- 非小T的 AI 文本能力统一经 new-api `POST /v1/chat/completions` 调用 GPT：普通文字对话、Flow Text Chat、提示词优化、工具选择与 PDF 文本分析使用 `gpt-5.4`；图像理解、HTML PPT、Paper.js、图像转矢量和普通 Agent 规划/研究使用 `gpt-5.6`。不得回退到 `gpt-5.4-mini`、`gemini-3.5-flash` 或旧 provider 档位。视频理解继续使用 Gemini 专用链路；小T使用 `xiaot-agent-gpt-5-4|5-5` facade，默认 GPT-5.4。
- Tanva 后端只通过 `NEW_API_BASE_URL` 与 `NEW_API_KEY` 访问 new-api；tc-api 的 base URL 与 `tc_sk` 只保存在 new-api 渠道配置中，Tanva 后端不得读取或要求 `TC_API_KEY` / `TAPCANVAS_API_KEY`。部署使用的 new-api 必须为 `default` 分组启用普通 `gpt-5.4` 与 `gpt-5.6` abilities（不能用小T专属的 `xiaot-agent-gpt-5-4|5-5` 代替）；缺少网关 ability 时应直接修复 new-api 渠道，不得让后端直连上游。积分记录与客户端模型外显统一标记为 new-api + 实际 GPT 模型。可运行 `cd backend && npm run verify:new-api-text-routing` 做无付费 mock 路由验证。
- AI Chat 项目内会话只从 `Project.content.aiChatSessions` / `aiChatActiveSessionId` 水合；全局 IndexedDB/localStorage 会话只用于无项目场景，避免切换/新建项目时把旧本地历史串入当前项目。
- 项目内容本地缓存使用 `frontend/src/services/projectCacheStore.ts` 的 IndexedDB（`tanva_project_cache`）：打开项目可先用账号隔离缓存水合，再后台校验远端 `contentVersion/updatedAt`；校验中自动/手动保存需暂停，保存成功写入与云端一致的 sanitized 内容，避免本地运行时字段或旧缓存覆盖远端。切换项目的体感性能还受 Paper `importJSON`、Raster 重建和 Flow hydrate 影响；下拉快速切换应先关闭菜单并延后一拍触发 `projectStore.open()`，Paper 项目切换路径在已提前清空时可跳过导入前的重复 `project.clear()`。
- 同项目 Undo/Redo 只恢复内容快照并标记为未保存修改，不得恢复历史快照携带的 `contentVersion`/`lastSavedAt`，也不得重置 `dirtyCounter`、保存锁、缓存校验或 stale 保护状态；`Project.contentVersion` 是云端乐观锁基线，在同一项目会话内只能随成功保存前进。
- AI Chat 普通文本请求默认只发送当前输入；命中“继续/调整/再试”等迭代意图，或“刚才/之前/上文/上一条/这个/那个/这两个/previous/last”等上下文指代时，才通过 `contextManager.buildContextPrompt` 拼接会话历史。迭代计数与上下文依赖检测是两条独立判定；Auto-mode Agent trace 在上下文依赖命中时也会接收同一份上下文并展示上下文读取步骤。Flow Text Chat 节点不继承这条 AI Chat 上下文注入策略。
- AI Chat Auto/Generate 图片输出数量：普通 AI Chat 中底部 `1/2/4/8` 倍数是默认值，用户明确描述输出数量时可覆盖；小T模式中 `autoModeMultiplier` 是唯一权威数量，通过结构化 `imageOutputCount` 传给 facade，不得从 prompt 文案覆盖。宿主还会按该数限制单输出图片生成节点、对应 prompt 和 `runNode`，防止聊天数量与画布实际任务不一致。`gptImage2` 在宿主 manifest 中显式声明 `text/img` 输入与单个 `img:image` 输出，供小T连线并让 facade 将成功 `runNode` 识别为异步图片提交证据。
- 小T新增节点会忽略 agent 的外部世界坐标，先放在当前视口附近并自动复用“一键整理”的按类别布局；整理以 `data.boxW/boxH` 为节点尺寸最高优先级，避免放大图片互相覆盖，动画完成后聚焦本轮首个生图节点。
- AI Chat 图片生成等待上限为前端任务轮询 15 分钟；消息错误态必须派发 `predictImagePlaceholder/remove`，画布侧 AI 预测占位框也必须带 `createdAt/expiresAt` 并由 `useQuickImageUpload` 定时扫描清理，避免 Paper.js 孤儿占位框长期停在 95%。
- 画布图片工具栏的通用 2D 转 3D 使用腾讯混元 3D 3.1，不经过 GPT/new-api。调用必须走 `POST /api/ai/convert-2d-to-3d-async` 后轮询 `GET /api/ai/convert-2d-to-3d/task/:taskId`，不得用同步长连接等待上游；同一次用户操作必须携带并保留稳定的 `clientRequestId`，网络中断、组件重建和轮询超时后继续原任务，只有明确成功/失败后才能生成新的请求身份。任务持久化到 `VideoTask`，查询必须校验所有者；积分记录统一外显 `provider=hunyuan-3d`、`model=3.1`。
- Flow HTML PPT 节点只持久化多页 HTML/CSS 片段与远程 URL/路径引用；预览必须运行在禁用脚本的 sandbox iframe 中，手写/AI 生成代码需拦截脚本、事件属性、`javascript:`、iframe/object/embed/base，以及 `data:`/`blob:`/base64 图片引用。AI 可按当前页或整套 deck 返回结构化 JSON patch/full replacement，并可读取上游 `text`/`img` 作为图文上下文；非远程图片应在运行时先上传为远程素材再交给模型排版。节点当前不自动规划或调用生图链路；需要主视觉/背景/插画等图片时，应通过上游图片节点、素材库或上传素材提供，Run 只负责准备远程图片并交给 PPT 排版模型使用。HTML PPT 风格 preset 以结构化数据维护，应用后写入 deck `themeCss` 与节点 `stylePresetKey`，并参与后续 AI prompt；`Bold 34` 模板一一映射 `zarazhangrui/beautiful-html-templates`，本地保存从上游 `template.html` 转换出的 Tanva-safe 静态 starter deck，并统一带 `author:zarazhangrui` 标签，应用后替换为 1920×1080 真实模板页并写入 `boldTemplateSlug`。AI/模板返回的完整 HTML 文档必须先抽取安全 slide body/style block 转成内部 deck/slide 片段，不能直接作为完整 HTML 持久化。导出的 HTML deck 需要以分页文档方式呈现，并使用固定设计画布整页缩放来保持预览/导出比例一致，保存前必须通过同一安全校验。
- Flow 生图节点参考图数量统一走 `frontend/src/utils/flowModelProvider.ts`：Fast=3、Pro=11、Ultra=14；节点预览、连接接纳与运行请求必须使用同一上限。
- Flow Prompt 节点的 `@` 图片引用保存为结构化 `data.mentions`：新建引用可从工作流、项目库与个人库选择；工作流引用只保存 `flow` 节点/句柄引用，项目库/个人库只保存远程 URL/路径。运行时可合并到生图参考图，但不得把 inline 图片写入设计 JSON。Prompt 的“工作流”来源仅在当前 Prompt 下游节点存在已连接的图片输入时显示，并展示这些下游图片输入对应的当前工作流图片；多 `@` 匹配必须按最长 token 优先，自动候选同步不得覆盖已保存的结构化 ref，也不得在同名 token 对应多个候选时盲绑；工作流多输出必须按 `nodeId + handle` 精确匹配，避免同节点不同图串联；已选引用在 Prompt 输入区以图片 chip 区分展示，删除时应按整个 token 同步清理 mention。
- Flow 视频节点运行时可从连接的 Prompt 节点读取仍存在于文本中的 image mentions 作为虚拟图片输入：物理图片连线优先，`@` 图片只补空位或追加到参考图列表，并在请求 prompt 中追加 token 到参考图序号的映射说明。
- Flow 视频任务只有在创建响应为非失败态且包含有效 `taskId` 后才能注册轮询。提交开始时必须清除旧任务身份；同步 4xx、`200 + failed` 或缺少 `taskId` 时，节点应原子进入 `failed`、展示后端具体错误并清空全部轮询字段，避免旧任务恢复逻辑覆盖失败态。
- Seedance 2.0 每次带普通参考图生成都由后端创建独立的一次性火山 Ark 素材组，对本次当前渲染图重新审核；前端不得预审核、复用或下发项目中残留的普通 `volcAssetId`。活体认证资产是唯一例外：它代表用户授权，只能显式标记为 `bio-auth` 后使用，失效时要求重新认证，不得静默替换成普通审核资产。创建成功后一次性组与真实 `taskId` 绑定，任务查询进入成功/失败终态时异步删除；同步提交失败立即删除，未轮询/服务重启遗留组由 `VolcTaskAssetGroup` 和每小时任务在默认 24 小时后兜底清理。若本次新建 `assetId` 在提交瞬间返回 not found，只允许内部删组、重审并重试一次，不能让用户手动重试或重复扣费。`CreateAsset` 的尺寸/审核错误仍需返回可操作的 HTTP 400 中文提示并保留 `upstreamCode/requestId`。
- Flow `omniFlashExtVideo` follows APIMart `omni-flash-ext`: `prompt` is required; image inputs are collected only from the `image` handle; single-image mode accepts 1 image, reference mode accepts 1-3 images, and 2+ images must send `generation_type=reference`; video input is collected from the `video` handle and is limited to 1 URL; when a reference video is present, force `videoMode/generation_type=reference` and omit `duration`; valid duration choices without video are 4/6/8/10 seconds. Backend managed routing includes a default `omni-flash-ext` -> `new_api` route so credit preview/deduction does not fall through to Kling 2.6 defaults.
- Flow 视频普通/尊享通道使用不同的已部署 new-api 入口：普通通道经 `/v1/videos` 使用后端 `NEW_API_KEY`；`vendorKey/platformKey=tencent_vod|tengxun` 的尊享通道经腾讯 VOD proxy 使用 `NEW_API_KEY_VIP`。真实令牌不得下发前端；当前 new-api distributor 未部署 type=67 的腾讯 VOD 视频 channel，尊享请求不可直接送入 `/v1/videos` 的 `vip` 分组。
- Vidu 统一节点的通道按钮必须真实写回 `vendorKey/platformKey`；普通为 `vidu_api`，尊享为 `tencent_vod`。Q2/Q3 切换必须同步 `managedModelKey=vidu-q2|vidu-q3`，后端也会按 `viduModelVariant/viduModel` 修正历史节点的矛盾托管 key，确保计费模型与 new-api 请求模型一致。
- 视频节点同时持久化并下发显式 `channelTier=default|vip`，后端必须优先以该字段选择入口和令牌；`vendorKey/platformKey` 只作旧节点兼容，防止历史 `tencent_vod` 残留把用户明确选择的 Default 再次覆盖为 VIP。
- Flow 新建视频节点的产品默认固定为非腾讯普通通道，即使后台托管模型的 `defaultVendor` 仍为 `tencent_vod`；腾讯 VOD 必须保留为用户显式选择的尊享项，不能作为 palette/defaultData 的隐式初始值。缺少 `channelTier` 的旧节点首次水合也按普通通道自愈。
- 视频节点用 `channelSelectionExplicit` 区分用户选择与历史自动默认：只有用户点击通道按钮才写 `true`；缺失/false 的旧节点即使残留 `channelTier=vip` 或 `vendorKey=tencent_vod`，运行时也强制迁回普通。后端 NodeConfigService 同样为视频 defaultData 输出非腾讯 vendor + `channelTier=default`。
- Flow 视频生成请求必须携带 `clientProjectId/clientNodeId/clientRunId`，幂等键按本次运行生成；后端在积分账户行锁事务内强制同一 `userId + clientProjectId + clientNodeId` 最多存在一个 30 分钟内的 `PENDING` 视频任务。重复请求不得再次扣费、预留团队积分或调用上游；原记录已有 `taskId` 时直接返回，尚未写回真实 taskId 时返回 `usage:${apiUsageId}` 可轮询别名，查询接口随后自动转接原任务，不能向前端返回冲突错误。视频节点收到创建响应后立即持久化 `taskId/apiUsageId/videoTaskProvider/videoTaskStartedAt`，刷新只恢复原任务轮询，不重新提交；查询暂时中断或前端轮询超时不得退款或清除任务身份。任务进入 `SUCCESS/FAILED` 后立即释放闸门，超过 30 分钟的遗留 `PENDING` 自动失效。仍在运行的旧前端可从 `vnode-${nodeId}-${timestamp}` 幂等键提取节点并进入兼容闸门；无节点身份的 AI Chat/其他旧客户端继续使用普通幂等逻辑。
- new-api stores the internal route key as `omni-flash-ext`, but APIMart upstream is case-sensitive and must receive `model=Omni-Flash-Ext`; production PostgreSQL data repair lives in `new-api/patches/2026-06-17/001-fix-omni-flash-ext-apimart-data.sql`, with a non-runner SQLite companion at `new-api/patches/2026-06-17/001-fix-omni-flash-ext-apimart-data.sqlite` for local `one-api.db`.
- ToAPIs 视频生成统一走 `POST /v1/videos/generations`，任务查询必须走 `GET /v1/videos/generations/{id}` 并兼容 flat `generation.task` 响应；不能沿用 APIMart 的 `/v1/tasks/{id}` 或强制要求 `code=200`。ToAPIs 生成模型目录见 `new-api/docs/toapis-video-models.md`，幂等数据补丁见 `new-api/patches/2026-07-18/001-add-toapis-video-models.sql`。
- ToAPIs Seedance 2 三个 SKU（`seedance-2`、`seedance-2-fast`、`seedance-2-mini`）统一按进价 `x1.5` 计费；当前成本倍率基数 `31.25` 对应 `ModelRatio=46.875`。计费秒数必须是显式输出 `duration` 加所有唯一参考视频的真实时长之和；参考视频统一规范为 `video_with_roles[].role=reference_video`，由 new-api 在预扣前安全下载 MP4 并探测时长，无法确认时拒绝提交，不能只按输出时长计费。为保证预扣准确，这三个 SKU 禁止 `duration=0/-1` 自动时长。默认值与生产补丁必须保持一致，补丁见 `new-api/patches/2026-07-21/001-raise-seedance2-markup-to-1-5.sql`，仅随正式部署执行。
- Flow 画布的 `doubao-video` Seedance 2.0、Fast、Mini 与网关使用同一商业口径：原 `x1.2` 画布单价整体乘 `1.5/1.2=1.25`，Mini 复用 Fast 的 480P/720P 按秒档。画布试算和个人/团队实际预扣都使用 `billingDurationSec = outputDurationSec + inputVideoDurationSec`；前端从连接节点汇总试算参数，但 Run 积分只展示后端 `/api/credits/preview` 返回值，不保留 Seedance 本地单价或静态兜底。后端在预扣前对唯一参考视频 URL 安全下载并用 `ffprobe` 重新确认，失败时不得扣分或提交上游。计费上下文的 `duration` 可替换为总计费秒数，但上游生成 DTO 的输出 `duration` 必须保持不变。
- Flow Midjourney 节点显示名为 `Midjourney`，节点内 `modelVersion` 在 `v7/v8` 间切换；运行时分别发送 `--v 7`/`--v 8.1` 与 `midjourney-v7`/`midjourney-v8`，Niji 仍使用独立 `niji7` 节点与 `midjourney-niji-7`。new-api 托管 Youchuan 生产数据需包含 `new-api/patches/2026-06-17/002-add-midjourney-v8-youchuan.sql`。
- Seedance 2.0 `reference_images`/全能参考模式必须把图片作为 `reference_image` 参考媒体处理，不得与 `first_frame`/`last_frame` 角色混用；若 new-api 兼容层返回首尾帧与参考媒体混用错误，后端会退回 Ark 官方 `content`/role 直连任务。
- Seedance 1.5 Pro Flow 节点分辨率只允许 `720P`/`1080P`；前端需过滤旧 VOD/节点配置里误带的 `4K` 等不支持选项，并把历史节点上的非法分辨率回落到支持选项。
- Flow 视频节点成功后可写入 Global History，但只记录已有远程视频 URL/缩略图引用，不把视频或缩略图内联进设计 JSON。
- Library 历史视频记录支持封面/播放/下载展示；发送或拖拽到画板时必须走 `canvas:insert-video` 视频资产链路，不走图片上传链路。历史图片仍可按远程 URL/可持久化资产引用发送到画板。
- Canvas/Flow 视口同步以性能为优先：触控板/手势缩放通过 RAF 批量提交 `setViewport`；Flow 覆盖层内的滚轮缩放/平移同样要合并到 RAF；项目内容中的 canvas `zoom/pan` 同步需要防抖和同值跳过，避免缩放/平移产生高频 React 内容状态更新。超过 80 节点时 MiniMap 仅在移动/缩放/节点拖拽等交互过程中临时隐藏，交互空闲后恢复；移动/缩放/节点拖拽进入软降级但保留节点内容、按钮、连线和 resize，仅隐藏连接句柄圆点；节点拖拽期间派生数据应跳过 position-only 重算。`GridRenderer` 的初始化兜底不能依赖随 `zoom` 重建的回调，避免绕过缩放重绘防抖。
- 后端 AI 积分请求参数应保留显式 `channelHint`，除非 Banana route/provider 已解析出更明确的供应商通道。
- 画布 AI 图片操作应以当前渲染资源为准；Shift 精确局部修改需要把选区 bounds/比例传入 Chat，并通过 `precise-edit`/`lockToBounds` 在原位显示占位框，高清放大结果应走 `triggerQuickImageUpload` 上画布而不是直接下载。

### 环境变量与敏感信息
- 后端使用 `.env`（见 `backend/src/app.module.ts` 的 `envFilePath` 配置：优先 `backend/.env`，其次 `../.env`）
- 不要提交密钥/凭据（`.gitignore` 已包含 `backend/.env` 等）

### 支付与补单
- 微信、支付宝和本地支付订单统一使用 30 分钟有效期；前端倒计时以接口返回的 `expiredAt` 为准，过期后不得继续展示旧二维码。
- 支付成功统一通过幂等的 `processPaymentSuccess` 入账；自动对账每 5 分钟核查最近 72 小时内的 `pending/expired/cancelled/failed` 订单，详细约定见 `helloagents/wiki/payment-reconciliation.md`。

## AI Metadata 同步
- 修改代码或文档后，在仓库根目录运行：
  - `node "${CODEX_HOME:-$HOME/.codex}/Skills/ai-metadata-sync/scripts/sync-repo.mjs"`
