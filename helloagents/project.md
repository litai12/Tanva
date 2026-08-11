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
- AI 图片生成、编辑、融合及同步图像识别的输入边界只接受远程 HTTP(S) URL：前端统一上传，后端 Controller 与 BullMQ 入队前再次校验，`NewApiProvider` 发送 `image_urls` / `image_url` 前最终校验。图像识别统一使用 Gemini/ToAPIs，包含小T大脑选择 `gpt-5.6-luna` 的场景；任何图片识别链路均不得下载图片或转换、透传 base64。视频理解是独立例外：设计数据仍只保存远程视频 URL；豆包 Seed 2.0 视频分析通过 new-api Responses `input_video.video_url` 直接传远程 URL，不下载或转码；Gemini 路径可在后端最后一跳将不超过 15MB 的视频临时编码为 `file.file_data=data:video/*;base64,...`，且不得写入 DB、OSS、Redis 或任务持久化字段，更大视频保留抽帧远程 URL 兜底。

### Flow / AI 运行约定
- Flow 动态画布根节点及其挂到 `document.body` 的交互浮层必须同时标记 `translate="no"` 与 `notranslate`。浏览器网页翻译会包裹/替换 React 管理的文本节点，随后编辑 Prompt 可能触发 `removeChild` / `insertBefore` DOM 不一致；应用内中英文切换继续通过 i18n 完成。自定义 Flow 节点必须经过节点级错误边界注册，单节点渲染失败不得卸载整张工作流。
- 异步视频查询成功后，第三方临时视频必须由后端按逐跳域名白名单下载并转存到 Tanva OSS，再把自有远程 URL 返回前端；不得把需要第三方 CORS 的原始 URL 交给浏览器下载。前端识别到已托管资产时直接复用，不重复下载上传。
- 画布运行价以认证后的 `POST /api/credits/preview` 为唯一报价入口，并与实际预扣复用 `CreditsService.resolveEffectiveCreditsQuote`；前端静态值只允许作为报价返回前的短暂兜底，模型/线路/质量/分辨率/时长等参数必须与真实执行请求一致。Banana 的 `normal/apimart`、`stable/tencent`、`ultra/beqlee` 路线别名必须在报价与所有图片执行封装中做相同归一化，不得把极速路线静默降为普通路线。GPT Image 2 的 `quality` 与 `resolution` 是独立维度：腾讯尊享路线 `auto` 归一为 `low`，只由 `quality` 选择 `image2_low/medium/high`，`resolution` 只写入输出配置，不得提升质量档；尊享模式还需在基础质量/分辨率价格上按实际参考图数量追加 `10 积分/张（0.1 元/张）`，preview、同步预扣和异步预扣必须使用同一参考图数量。同步与异步生图入口都必须完整透传 `quality/background/moderation/outputFormat/outputCompression/maskUrl/officialFallback`。
- Flow 节点挂载时的 `POST /api/credits/preview` 必须经过前端共享请求池：请求体完全相同的报价共用同一 in-flight Promise，并短时复用成功结果；不同报价执行全局并发上限，失败结果不得缓存。该优化只合并网络请求，不能改变后端作为唯一报价源或省略任何模型/线路/规格参数。
- AI Chat 固定使用小T单轨入口，不再提供小T开关；preferences v5 会忽略历史关闭偏好并固定开启。旧能力必须作为小T宿主工具接入，不能以关闭小T回到旧链路。
- 小T是 AI Chat 的单一入口；原生“只出图”和“案例搜索”作为 `host_tool` 宿主能力暴露给小T，由小T判断并调用。Tanva 在当前小T消息内执行旧链路并展示图片或案例卡片，不得在进入小T之前做前端分流，也不得要求用户切换回旧聊天模式。
- 小T单轨仍保留图片比例、图片尺寸、视频比例、视频时长和附件上传入口；四项生成规格作为结构化偏好随每轮 capability manifest 交给小T，用户当轮明确指定的规格优先于已保存偏好。
- 小T的大脑档位、图片/视频模型、图片/视频规格、输出数量与风格锚定统一收口到输入区的“设置”弹窗；不再分别展示模型下拉和画幅/尺寸小按钮，底层偏好字段与持久化行为保持不变。
- 小T请求的内容安全与敏感话题判断由小T facade 渠道自身负责；可选大脑为 Fast=`xiaot-agent-gpt-5-4`、Pro=`xiaot-agent-gpt-5-5`、Ultra=`xiaot-agent-gpt-5-6-luna` 和 `xiaot-agent-deepseek-v4-flash`。前三者用户外显使用“小T”前缀：`小T-5.4`、`小T-5.5`、`小T-5.6 Luna`，DeepSeek 外显为 `小T-DeepSeek V4 Flash`；内部门面 ID 不变。Tanvas 只负责原样转发用户输入、能力清单和画布上下文，不维护本地关键词规则或额外安全 Guard。
- 小T 自身的每个完整成功对话回合固定扣 `2` 积分，所有可选大脑同价；上游 `usage.total_tokens` 只作运营审计，不参与 Tanva 对话扣费。小T 触发的生图、视频、识图及其他宿主任务仍走各自现有计费链路，与这 `2` 积分分开记账。
- 普通 AI Chat 的纯生图对话统一经小T执行：手动“生成”模式直接进入 `runXiaotAgent`；Auto 模式可沿用工具选择识别生图意图，但命中 `generateImage` 后必须停止旧的前端直调生图流程，把既有用户消息/AI 占位消息交给小T复用。小T使用当前所选 `xiaotModel` 大脑整理提示词，并依图片优选/用户点名选择 GPT Image、Banana 或其他图片节点，完成 `textPrompt → image node → runNode`。
- 非小T的 AI 文本能力统一经 new-api `POST /v1/chat/completions` 调用 GPT：普通文字对话、Flow Text Chat、提示词优化、工具选择与 PDF 文本分析使用内部模型 `gpt-5.4`；HTML PPT、Paper.js、图像转矢量和普通 Agent 规划/研究使用内部模型 `gpt-5.6-luna`。所有面向用户的对应型号标签仍统一使用“小T”品牌前缀（例如 `小T-5.4`、`小T-5.6 Luna`），不得外显 `GPT-*`，内部请求 ID 不变。Image Chat/图片理解恢复 Gemini 多模态三档：Fast=`gemini-2.5-flash`、Pro=`gemini-3.5-flash`、Ultra=`gemini-3.1-pro`，统一由 `/api/ai/analyze-image` 执行。Flow 视频分析使用节点内独立模型选择，不继承全局图片模型：默认 `doubao-seed-2-0-lite-260428`，并提供豆包 Mini/Lite/Pro 与 Gemini 2.5 Flash/3.5 Flash/3.1 Pro；豆包模型请求经 new-api `/v1/responses` 的远程 `input_video` 分析，Gemini 保留完整小视频与抽帧兜底。豆包 Seed 2.0 Pro/Lite/Mini 的产品计费均锚定标准付费 Seedance 2.0 480P 单价，当前分别为 `1/3`、`1/10`、`1/20`：以 `1.25 元/秒` 为锚点，即 Pro=`125/3`、Lite=`12.5`、Mini=`6.25` 积分/秒，按后端安全下载并用 `ffprobe` 识别的完整视频时长计算总价后向上取整；浏览器媒体时长只用于运行前预估。Responses token usage 仍保留在内部审计快照，用于核对上游调用，不参与这三个模型的用户侧视频分析扣费。禁止任何豆包模型回退到 `60/90/120` 固定扣费。公开 API 可返回最终积分及按时长模型的计费时长，但不得返回官方成本、倍率、分档单价或 `pricingSnapshot`；完整快照仅保存在服务端供管理员审计。视频分析结果生成标准 Prompt 的分镜表变体，表格/原文双向编辑，允许增删/复制行、新增/重命名/删除动态列和切换镜头/时序列作用域；内部镜头分组不得依赖用户可删除的“镜号”列。表格态必须支持单元格内 `@` 工作流/项目库/个人库资产、已引用资产定位、常驻横向浏览控件与 `Shift + 滚轮` 横移，并支持 `.xlsx` 导入/导出；工作簿使用“分镜表/镜头总览/列设置”三个 Sheet 保留动态列和作用域。小T大脑默认 Fast，另可选 Pro、Ultra 和 DeepSeek V4 Flash；图片分析必须调用宿主 `analyze_image` 工具复用 Image Chat，不由小T大脑直接猜图。
- 分镜表也必须作为“文字类节点”的独立添加入口，创建后仍落为 `textPrompt + data.variant="storyboard-table"`，不得分叉下游 Prompt 协议。“剧本转分镜”读取当前表格的动态列生成结构约束，Skill 与剧本均支持 `.txt/.md/.markdown/.docx` 本地文本提取；调用必须走小T `canvasAgent` 并直接使用当前 `xiaotModel`，不维护第二套模型选择。内置 Skill 默认使用自然主义快节奏双模式：普通剧本只增加拍法、不增加剧情，已有镜号/时间码的分镜锁定镜数/顺序/时长后精修；默认表包含镜号、时长、景别、运镜、画面、台词、音效、备注和精细表演/连续性字段。单镜描述必须覆盖起始几何状态、动作动力链、路径/速度、机位、焦点、光影/遮挡、结束状态/声音，可见动作超过 1 秒至少拆成 3 个真实变化的时序段；手部、面部和关键道具特写还必须锁定主体数量、身份、关节/轮廓、纹理与遮挡连续性。自定义分镜 Skill 持久化到按 `userId` 隔离的 `StoryboardSkill`，通过 `/api/storyboard-skills` 创建/更新/查询/删除，跨同账号项目可用，不进入 `Project.contentJson`。
- Tanva 后端只通过 `NEW_API_BASE_URL` 与 `NEW_API_KEY` 访问 new-api；tc-api 的 base URL 与 `tc_sk` 只保存在 new-api 渠道配置中。部署使用的 new-api 必须为 `default` 分组启用普通 `gpt-5.4`、`gpt-5.6-luna` 以及视频分析所需的 `doubao-seed-2-0-mini-260428`、`doubao-seed-2-0-lite-260428`、`doubao-seed-2-0-pro-260215` abilities；豆包三模型的生产目录、`ark-doubao.models`、abilities 和基础倍率修复由幂等补丁 `new-api/patches/2026-07-31/002-enable-doubao-seed-2-0-video-analysis.sql` 提供。缺少网关 ability 时应修复渠道，不得让后端直连上游。积分记录与客户端模型外显统一标记为 new-api + 实际模型。可运行 `cd backend && npm run verify:new-api-text-routing`、`npm run verify:new-api-video-analysis` 与 `npm run verify:doubao-video-analysis-pricing` 做无付费 mock/定价验证。
- Wan2.6、Wan2.7 I2V 与 HappyHorse 的 `/api/ai/dashscope/*` 仅是客户端兼容 URL，实际统一提交到 new-api `/v1/videos`；Tanva 后端不得读取 `DASHSCOPE_API_KEY`，真实凭据只保存在 new-api type `17` 阿里渠道。新任务使用 `newapi:` 前缀；可运行 `cd backend && npm run verify:dashscope-new-api-routing` 做无付费 mock 路由验证。
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
- 当前画布启用且腾讯 VOD 已覆盖的 `kling-v2-6`、`kling-v3`、`kling-v3-omni`、`vidu-q2`、`vidu-q3`、`hailuo-h3` 必须经 new-api `/v1/videos` 的 type=67 Tencent VOD task channel；后端创建与轮询均使用 `NEW_API_KEY_VIP`，任务 ID 使用 `newapivod:` 前缀。前端只展示/保存 Tencent VOD 单一路由，new-api 对这些业务模型 ID 禁用其他 channel ability，任何一层都不得静默回退。type=67 必须同时注册 `default`、`auto`、`vip` 三组 ability，避免 VIP token 在 distributor 阶段返回 `No available channel`。这些 VOD 模型统一使用正常模式，前端不展示错峰开关，历史 `offPeak=true` 在预估、提交及腾讯 `OutputConfig` 三层都必须归一为关闭。Kling 3.0/3.0-Omni 4K 无参考视频时，无声与有声均按腾讯 VOD 当前刊例价 `3 元/秒 = 300 积分/秒`；3 秒任务应预扣 900 积分。Seedance 继续走 Ark，Wan/HappyHorse 继续走既有 new-api 阿里线路，真实令牌不得下发前端。
- VOD 输入语义必须显式传递：Kling 2.6/3.0/Omni 的首帧和首尾帧使用 `FirstFrame`/`LastFrame`，只有 Omni 参考图模式使用 `Reference`；参考视频只允许 Omni，时长 3–10 秒且不能选择 4K。Kling 2.6 首尾帧实际按无声提交并以无声参数计费。Vidu 画布提供文生、首帧、首尾帧、参考四种模式，Q3 的非参考模式解析为 `q3-pro`，参考模式解析为 `q3`，参考模式最多 7 张图。Hailuo H3 的图片/视频/音频数量与混合上限必须由前端、Tanva 后端、new-api 同级校验，原生音频生成默认开启且可关闭。
- MiniMax Hailuo H3 使用业务模型 ID `hailuo-h3`，统一经 new-api `/v1/videos` 的 type=67 Tencent VOD task channel 提交，上游固定 `ModelName=Hailuo`、`ModelVersion=H3`。Flow 只注册一个 `hailuoVideo` 模型族节点；模型、模式、动态端口、时长、画幅、分辨率和价格均由 Tanva 后端代理 new-api `/api/models/params` 后渲染，前端与后台节点配置不得维护第二份 H3 规格/单价。H3 只允许 2K/4K 与 4–15 秒；new-api 是唯一计价源：2K 按 120 积分/处理秒、4K 按 150 积分/处理秒，处理秒数包含输出时长与所有唯一参考视频的真实时长；唯一输入图片前 5 张免费，超出后每张 30 积分，音频免费。new-api 必须在提交前探测参考视频真实时长并校验素材数量，失败时禁止提交，再通过 `X-NewApi-Consumed-Credits` 回传权威积分供 Tanva 精确后扣。运行时参考图即使暂存为 data URL，也必须在新-api/Tencent VOD 提交前上传为 HTTPS OSS URL，并保留正确的图片 MIME；历史 OSS/TOS 对象即使响应头是 `application/octet-stream` 也要按文件内容识别并重新托管为图片。腾讯查询时嵌套 H3 `ErrCode`/失败消息优先于外层 `FINISH`，只有存在真实视频 URL 才能报告成功；type=67 H3 借用旧 Tencent 签名代理时不得生成第二条 legacy 任务或重复记账；生产注册补丁为 `new-api/patches/2026-08-03/001-add-hailuo-h3-tencent-vod.sql`。
- Hailuo H3 的 Tencent VOD 内部提交直接使用第一方 TOS/OSS HTTPS URL，以 `FileInfos[].Type=Url` / `FileInfos[].Url` 传递图片、视频、音频，以 `LastFrameUrl` 传递尾帧；不再调用 `PullUpload` 或等待输入 `FileId`。
- Hailuo H3 是异步计费：new-api 返回任务后必须按 `X-NewApi-Consumed-Credits` 创建 `PENDING` 用量记录，返回并持久化 `apiUsageId/taskId`；成功/失败终态由查询接口按当前用户与持久化 taskId 幂等自动确认或退款，前端仍可回写作为快速路径，视频 pending 超时自动退款名单必须包含 `hailuo-video`。团队项目先冻结团队积分，终态成功才确认扣除，失败只释放预留。Tencent VOD 返回的 `vod-qcloud.com` 临时视频地址必须由后端转存 Tanva OSS，不能让 HTTPS 页面直连 HTTP CDN。
- Vidu 统一节点的通道按钮必须真实写回 `vendorKey/platformKey`；普通为 `vidu_api`，尊享为 `tencent_vod`。Q2/Q3 切换必须同步 `managedModelKey=vidu-q2|vidu-q3`，后端也会按 `viduModelVariant/viduModel` 修正历史节点的矛盾托管 key，确保计费模型与 new-api 请求模型一致。
- 视频节点同时持久化并下发显式 `channelTier=default|vip`，后端必须优先以该字段选择入口和令牌；`vendorKey/platformKey` 只作旧节点兼容，防止历史 `tencent_vod` 残留把用户明确选择的 Default 再次覆盖为 VIP。
- Flow 新建上述 VOD 覆盖模型时，palette/defaultData 必须初始化为 `vendorKey/platformKey=tencent_vod`、`channelTier=vip`、`channelSelectionExplicit=true`；托管路由视图只保留 Tencent vendor，因此不显示无意义的线路切换器。没有 Tencent vendor 的视频模型保持自己的既有默认线路。
- 历史画布节点不依赖旧 `channelSelectionExplicit`：运行前按当前节点配置重新收敛路由，只要该模型存在 Tencent VOD 托管路线，就强制写回并发送 VOD vendor/tier。`channelSelectionExplicit` 仅保留为兼容字段，不能用它把 VOD-only 模型迁回普通通道。
- Flow 视频生成请求必须携带 `clientProjectId/clientNodeId/clientRunId`，幂等键按本次运行生成；后端在积分账户行锁事务内强制同一 `userId + clientProjectId + clientNodeId` 最多存在一个 30 分钟内的 `PENDING` 视频任务。重复请求不得再次扣费、预留团队积分或调用上游；原记录已有 `taskId` 时直接返回，尚未写回真实 taskId 时返回 `usage:${apiUsageId}` 可轮询别名，查询接口随后自动转接原任务，不能向前端返回冲突错误。视频节点收到创建响应后立即持久化 `taskId/apiUsageId/videoTaskProvider/videoTaskStartedAt`，刷新只恢复原任务轮询，不重新提交；查询暂时中断或前端轮询超时不得退款或清除任务身份。任务进入 `SUCCESS/FAILED` 后立即释放闸门，超过 30 分钟的遗留 `PENDING` 自动失效。仍在运行的旧前端可从 `vnode-${nodeId}-${timestamp}` 幂等键提取节点并进入兼容闸门；无节点身份的 AI Chat/其他旧客户端继续使用普通幂等逻辑。
- new-api stores the internal route key as `omni-flash-ext`, but APIMart upstream is case-sensitive and must receive `model=Omni-Flash-Ext`; production PostgreSQL data repair lives in `new-api/patches/2026-06-17/001-fix-omni-flash-ext-apimart-data.sql`, with a non-runner SQLite companion at `new-api/patches/2026-06-17/001-fix-omni-flash-ext-apimart-data.sqlite` for local `one-api.db`.
- ToAPIs 视频生成统一走 `POST /v1/videos/generations`，任务查询必须走 `GET /v1/videos/generations/{id}` 并兼容 flat `generation.task` 响应；不能沿用 APIMart 的 `/v1/tasks/{id}` 或强制要求 `code=200`。ToAPIs 生成模型目录见 `new-api/docs/toapis-video-models.md`，幂等数据补丁见 `new-api/patches/2026-07-18/001-add-toapis-video-models.sql`。
- ToAPIs Seedance 2 三个 SKU（`seedance-2`、`seedance-2-fast`、`seedance-2-mini`）统一按进价 `x1.5` 计费；当前成本倍率基数 `31.25` 对应 `ModelRatio=46.875`。计费秒数必须是显式输出 `duration` 加所有唯一参考视频的真实时长之和；参考视频统一规范为 `video_with_roles[].role=reference_video`，由 new-api 在预扣前安全下载 MP4 并探测时长，无法确认时拒绝提交，不能只按输出时长计费。为保证预扣准确，这三个 SKU 禁止 `duration=0/-1` 自动时长。默认值与生产补丁必须保持一致，补丁见 `new-api/patches/2026-07-21/001-raise-seedance2-markup-to-1-5.sql`，仅随正式部署执行。
- Flow 画布的 `doubao-video` Seedance 2.0、Fast、Mini 与网关使用同一商业口径：原 `x1.2` 画布单价整体乘 `1.5/1.2=1.25`，Mini 复用 Fast 的 480P/720P 按秒档。画布试算和个人/团队实际预扣都使用 `billingDurationSec = outputDurationSec + inputVideoDurationSec`；前端从连接节点汇总试算参数，但 Run 积分只展示后端 `/api/credits/preview` 返回值，不保留 Seedance 本地单价或静态兜底。后端在预扣前对唯一参考视频 URL 安全下载并用 `ffprobe` 重新确认，失败时不得扣分或提交上游。计费上下文的 `duration` 可替换为总计费秒数，但上游生成 DTO 的输出 `duration` 必须保持不变。
- Seedance 2.5 在同一 `seedance-2.0` 托管模型下以子型号 `seedanceModel=seedance-2.5` 接入，上游必须精确发送 `doubao-seedance-2-5-260628`。`seedance-2.0` 仅是内部托管/计费键；在请求渲染阶段会强制使用子型号解析出的 Ark ID，不能被旧模板静默覆写回 2.0。前端正式开放该选项；它仅走 Ark 官方普通通道 `seedance_api/default`，前端不展示不适用的 Tencent VOD 尊享选项，后端还会清除历史节点残留的 VIP 路由，禁止静默执行成其他版本。2.5 输出时长支持 4–30 秒；多模态参考模式支持最多 30 张图片、10 条视频和 10 条音频，视频/音频单条及总时长均为 2–30 秒，并支持仅音频输入；2.0 系列继续使用原有 4–15 秒输出、9/3/3 与 2–15 秒限制。2.5 仅允许 `480P/720P`；前端切换型号时清理非法分辨率，后端提交前再次拒绝 `1080P/4K`。对应档位的每秒价格固定为当前标准 2.0 的 `1.5x`：480P=`1.875 元/秒`、720P=`2.25 元/秒`，不参与仅面向 2.0/Fast/Mini 的 `SEEDANCE20_FREE` 活动。new-api 生产注册与 ability 克隆使用幂等补丁 `new-api/patches/2026-07-31/001-add-doubao-seedance-2-5.sql` 及 `new-api/patches/2026-08-07/001-upgrade-seedance-2-5-260628.sql`。
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
