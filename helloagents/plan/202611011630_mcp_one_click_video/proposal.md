# MCP 一键成片 & 爆款复刻（给 WorkBuddy 用）— 设计

## 结论：不需要画布展开，需要的是“生产图”

WorkBuddy 用户在对话框里提需求，期望拿到**成片**，不会去 Tanva 画布里点「运行组」。画布展开里有两部分，要分开看：

| 画布展开里的部分 | WorkBuddy 要不要 |
|---|---|
| 节点、连线、分组、槽位布局、重排（`layoutPlanSlots`、`PLAN_RELAYOUT_EVENT` 等） | **不要** |
| 规划 → 生产图的规则：每张参考图用哪个模型、什么提示词（含「避免」），哪些图被视频实际用到（孤立图不生成，避免白扣费），身份依赖（状态卡参考基础卡），每段 Clip 的首帧或参考图绑定顺序、`@提及`改写、参考图数量上限，时长夹到 4–15 秒，分辨率和模型回落 | **要，这是核心** |

所以做法是：把第二部分做成服务端的生产图，由后端任务按依赖顺序执行，最后用 ffmpeg 拼成一条成片。画布展开保持不变，第一期不碰前端。

## 用户体验（WorkBuddy 对话）：一次调用到底

规划结果是结构化数据，直接驱动后续生成，不需要可视化，也不需要人去点「运行组」。

1. 用户：「把这个故事做成 30 秒竖屏短片」，或「复刻这个视频 <URL>」。
2. Agent 调一次 `tanva_make_video`。服务端依次完成规划 → 生参考图 → 生视频 → 合成，**不需要中途确认**。
3. Agent 每 20 秒调一次 `tanva_video_job`：规划完成后能拿到分镜（用文字展示给用户），之后汇报进度（参考图 3/5，视频 1/3……）。
4. 完成后返回**成片 URL**和每段 Clip 的 URL。失败的 Clip 可以单独重试，不用整片重来。

**不设积分上限**，一路跑完。规划完成后会先按分镜预估一次：余额不够就在开始生成前直接报错，并告诉用户还差多少积分，免得生成到一半才停下。

## 模型列表与指定模型

用户可以先查看自己能用的模型，再指定用哪个：

- `tanva_list_models`（可选 `category`：plan / image / video）。按当前账号返回：
  - `modelKey` 和显示名称；
  - 能用于哪些场景：一键成片 / 爆款复刻 / 单独生图 / 单独生视频；
  - **当前账号能不能用**，不能用时说明原因（例如 Seedance 2.0 白名单、会员权益）；
  - 价格说明（取自现有的模型定价目录 `/api/credits/pricing/models`，规划按 TapCanvas 回执计价）；
  - 可选参数：分辨率、比例、时长范围、参考图上限。
- 数据来源：后端新增 `GET /api/video-productions/models`，把现有几处来源合到一起：规划模型（`tapcanvas-plans/options` 里的 authorModels）、生图和生视频模型及价格（定价目录）、账号权限（`seedance2/access` 等）。**列表里的模型就是流水线实际支持的**，不手写第二份清单。
- `tanva_make_video` 增加三个参数：`planModel`、`imageModel`、`videoModel`。指定后覆盖规划里每张图、每段 Clip 的 modelKey；不指定就用规划给的模型，没有对应模型时回落默认。传入无效或当前账号无权使用的模型时，提交时直接报错，并附上可用的模型列表。
- 一键成片和爆款复刻**第一期的视频模型只支持 Seedance 系列**（2.0 / 2.0-fast / 2.5）：首帧、参考图绑定和 `@提及`规则都按 Seedance 设计。其它视频模型（可灵、万相、Vidu、海螺、Veo 等）通过单独生视频的 `tanva_generate_video` 开放，`tanva_list_models` 会标明哪些场景可用。

WorkBuddy 要求单次工具调用 30 秒内返回，所以全部做成「提交 → 轮询」，每次工具调用最多等 20 秒。

## MCP 工具

| 工具 | 输入 | 输出 |
|---|---|---|
| `tanva_list_models` | 可选 `category`：plan / image / video | 当前账号可用的模型、适用场景、价格说明、可选参数 |
| `tanva_make_video` | `mode`：story / remake；`story`（一键成片的故事文本）；`referenceVideoUrl`（爆款复刻，公网 URL）；`referenceImageUrls`（可选，角色/场景/画风）；`planModel` / `imageModel` / `videoModel`（可选，取自 `tanva_list_models`）；`aspectRatio`、`resolution`、`targetSeconds`、`requirements` | `jobId`，最多等 20 秒；一路自动跑到成片 |
| `tanva_video_job` | `jobId`，`waitSeconds` ≤ 20 | `stage`（planning / planned / producing / composing / succeeded / failed / cancelled），分镜，预估和已扣积分，每张图、每段 Clip 的状态和 URL，`finalVideoUrl` |
| `tanva_video_produce` | `jobId`，可选 `clipEdits`（改某段提示词或时长、删掉某段） | 余额不足停在 `planned` 时，用户充值后用它继续 |
| `tanva_video_retry` | `jobId`，可选 `clipIds` | 只重跑失败的步骤 |
| `tanva_video_cancel` | `jobId` | 停止尚未开始的步骤；已提交的上游任务照常结算 |
| `tanva_generate_video` | 单段文生视频或图生视频，`model` 取自 `tanva_list_models`（Seedance、可灵、万相、Vidu、海螺、Veo 等），用于不需要规划的场景 | 异步，和生图工具同一种轮询方式 |

参考素材只收**公网 URL**，后端会先转存到 OSS，只存远程引用，符合设计 JSON 规范。MCP 不传本地文件。

## 后端：`video-production` 任务

```
POST /api/video-productions            → 建任务，调现有 tapcanvas-plans（规划计费链路不变）
GET  /api/video-productions/:id        → 状态、分镜、预估、结果
POST /api/video-productions/:id/produce|retry|cancel
```

- **存储**：沿用 `VideoTask`（`taskType='video-production'`），步骤状态存在 JSON 里（每步的上游 taskId、状态、URL、扣费），不新增表。
- **执行**：放进 BullMQ 队列 `video-productions`，和 `image-tasks` 同一套机制。每一步都**幂等、可续跑**：步骤的上游 taskId 先落库再轮询，`tanvas-api` 重启（pm2 reload）后按落库状态接着跑，不会重复提交、重复扣费。
- **顺序**：
  1. 基础参考图并行生成：走现有生图任务服务和原报价，参考图用户给的 URL。
  2. 状态卡类参考图：等它依赖的基础卡出图后，再把基础卡作为参考生成。
  3. 各段 Clip：首帧和参考图就绪后，并行提交 Seedance 生成（走现有视频接口和原报价、原退款逻辑）。
  4. 合成：服务器已有 `ffmpeg 6.1.1`。各段参数一致时用 concat 直接拼接、不重新编码；不一致时统一编码到规划的分辨率。输出上传 OSS。全局同时只跑 1 个合成任务，限制内存和 CPU。
- **计费**：每一步沿用原节点的报价和扣费，不新造价格。`produce` 前按分镜算出预估：图片按模型和分辨率，视频按 `calculateSeedance20BillingDuration`。余额不够直接拒绝，不跑到一半才停。
- **生产图模块** `backend/src/video-production/plan-graph.ts`：从前端 `tapcanvasPlanExpansion.ts` 移植纯规则部分（`resolveImageNode`、`resolveVideoNode`、`clampSeedanceDuration`、`consumedImageKeys`、`videoRefs`、参考图上限、`@提及`改写），不带布局。为防止前后端规则跑偏：把前端 `tapcanvasPlanExpansion.test.ts` 的规划样例做成两边共用的 JSON 固件，前后端测试都必须对同一批样例得出同一套「用哪些图、每段怎么绑定」的结果。第二期可以让前端直接用后端返回的生产图。

## 风险与前提

- **线上链路**：依赖 TapCanvas 资产规划、回执结算和 new-api 渠道。开工前用 `GET /api/tapcanvas-plans/options` 和一次最便宜的真实规划确认链路通。
- **时长**：Seedance 一段要几分钟，一条片总共约 5–15 分钟。WorkBuddy 侧靠 Agent 轮询，SKILL.md 写明轮询节奏，并且不要重复提交。
- **费用**：不设上限，按用户选的模型照常扣费；余额不足在生成开始前就拒绝。SKILL.md 要求 Agent 规划完成后在对话里告知预估积分（只告知，不等确认）。
- **服务器负载**：合成限并发为 1。视频下载沿用 `VIDEO_DOWNLOAD_MAX_BYTES`（512MB）。

## 分期

1. 后端生产图模块和共用固件测试；模型列表接口 `GET /api/video-productions/models`；`tanva_list_models` 和单段生视频工具 `tanva_generate_video`。
2. 后端 `video-production` 任务：规划、预估、确认、生产、合成，加上续跑和重试。
3. MCP 工具（`tanva_list_models` / `tanva_make_video` / `tanva_video_job` / `tanva_video_produce` / `tanva_video_retry` / `tanva_video_cancel`），WorkBuddy SKILL.md 补上成片流程和示例。
4. 线上用最便宜的配置真实跑一条「一键成片」和一条「爆款复刻」，会扣少量积分，确认后部署。
5. （可选）完成后「保存为 Tanva 项目」：把结果按画布展开写成一个已经出图出片的分组，用户可以到画布上接着改。

## 待定

- 第五期要不要做。
- 默认参数：建议 Seedance 2.0、720P、9:16、无目标时长时按规划；复刻按原片时长。
