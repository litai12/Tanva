# MCP 一键成片 / 爆款复刻 / 单段生视频（服务端流水线）— 2026-11-01

设计见 `helloagents/plan/202611011630_mcp_one_click_video/proposal.md`。外部 Agent（WorkBuddy 等）不需要画布展开，规划结果在服务端直接驱动生成。

## 组成

| 部分 | 位置 |
|---|---|
| 规划 → 生产图（纯规则，不含布局） | `backend/src/video-production/plan-graph.ts`，与画布 `tapcanvasPlanExpansion.ts` 共用同一份规划样例做对照测试 |
| 请求构造（生图 / Seedance / `@图N` 改写） | `backend/src/video-production/requests.ts`，字段与画布节点运行时一致 |
| 任务服务 | `backend/src/video-production/video-production.service.ts`：`VideoTask`（taskType=`video-production`）+ BullMQ 队列 `video-productions` |
| 接口 | `GET /api/video-productions/models`、`POST /api/video-productions`（mode=film/remake/single）、`GET /api/video-productions[/:id]`、`POST /:id/produce|retry|cancel` |
| MCP 工具 | `tanva_list_models`、`tanva_make_video`、`tanva_generate_video`、`tanva_video_job`、`tanva_list_video_jobs`、`tanva_video_produce`、`tanva_video_retry`、`tanva_video_cancel` |

## 关键设计

- **执行器**：`AiController` 构造时向任务服务注册执行器，以用户身份直接调用画布节点用的同一批方法（`generateImageAsync` / `editImageAsync` / `blendImagesAsync` / `getImageTaskStatus` / `generateVideoProvider` / `queryVideoTask`）。报价、预扣、结算、退款都在这些方法内由后端闭环：生图由 worker 扣费与回滚；生视频由查询接口按上游终态结算，另有每分钟对账兜底，所以流水线只轮询、不调 success/refund。
- **推进**：每个任务以 5 秒间隔的队列 tick 推进，Redis 锁保证同一时刻只有一个推进者；每步的上游 taskId 先落库，`tanvas-api` reload 后启动时自动补 tick，从断点继续。生视频带幂等键 `vprod-<jobId>-c<序号>-a<尝试>`，重复提交时后端返回原任务、不重复扣费。
- **顺序**：参考图按依赖分层（状态卡等基础卡出图后再以其为参考）；Clip 等首帧 / 参考图就绪后提交。失败自动重试 1 次，仍失败则任务失败，`retry` 只重跑失败部分。
- **模型**：`imageModel` 覆盖规划的生图模型（nano-banana-pro / 2 / 2.1、gpt-image-2 / 2.5 系列）；`videoModel` 目前只支持 Seedance 2.0 / 2.0-fast / 2.5（首帧、参考图绑定、`@提及` 规则按 Seedance 设计），其它视频模型在模型列表中注明暂未接入。Seedance 2.x 需要 VIP / 白名单，提交前即检查，避免规划费白扣。
- **费用**：不设上限。规划完成后按分镜调用与实扣同一报价函数（`quoteImageTaskCredits` / `quoteVideoProviderCredits` → `CreditsService.previewCredits`）预估；个人钱包余额不足时停在 `waiting_credits`（status=`paused`），`produce` 继续，可同时修改未开始的 Clip。
- **合成**：多段时用服务器 ffmpeg 合成，全局串行；ffprobe 比对各段编码参数，一致才 `-c copy` 直接拼接，否则按 Clip 画幅统一编码（libx264 veryfast、2 线程）。每段与成片都转存 OSS：`video-productions/<userId>/<jobId>/`。
- **与画布的差异**：画布 Pro 生图节点读 `data.imageSize`，而展开只写了 `resolution`，规划的分辨率在画布上被忽略；服务端直接传 `imageSize`。

## 测试

- `cd backend && npm run test:video-production`：生产图与画布展开对照；全流程（假执行器 + 真 ffmpeg）：规划 → 参考图依赖顺序 → Seedance（提及改写、首帧、时长截断、失败重试换幂等键）→ 合成 → OSS；余额不足暂停后改分镜继续；单段；取消；越权；尺寸不一致时重编码。
- `cd tanva-mcp && npm test`：新工具的提交、轮询、错误转述。
- 全量依赖注入：不调用 init 实例化真实 AppModule（不连库、不起队列），确认执行器注册成功。
