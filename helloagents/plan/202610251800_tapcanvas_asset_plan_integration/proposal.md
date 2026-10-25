# TapCanvas 资产规划 / 一键复刻接入 Tanva

## 背景

TapCanvas-pro（线上 `https://www.lluban.cn`，开放接口 `/public/v1`）提供两项能力：

- **资产规划** `POST /public/v1/asset-plans`：章节原文 + 可选参考图/视频 → `tapcanvas.asset-plan/v5` 节点数组（参考图 / Clip 脚本 / 视频节点 + `upstreamDependencies` DAG）。只规划，不生成媒体、不写 TapCanvas 画布。接口文档：TapCanvas-pro `scripts/examples/README.md` 第 5 节。
- **爆款复刻** `POST /public/v1/video-remakes`：需要 TapCanvas 自己的 `projectId/canvasFlowId`，结果写入 TapCanvas 画布，查询接口只返回 `status/phase/executionId`，**外部宿主拿不到节点图**。

目标：TapCanvas 只做规划；生成、画布、计费留在 Tanva。计费按用量结算，**收口在 new-api**，复用 Tanva 现有 `consumption-orders` 扣费链路。

## 范围

- P1：资产规划全链路（本提案主体）。
- P2：一键复刻。前置条件是 TapCanvas 为 `video-remakes` 增加“只出规划”的模式（分析参考视频后提交一个资产规划任务并返回其 jobId），Tanva 复用 P1 的订单、轮询与节点映射，仅新增“上传视频/粘贴链接”入口。

## 架构

```
Tanva 前端 ──► Tanva 后端 /api/tapcanvas-plans
                 │  ApiUsageRecord(pending, provider=new-api) + 预扣积分 + register()
                 │  gatewayHeaders() 签名
                 ▼
             Tanva new-api /v1/tanva/asset-plans   (Tanva 订单，渠道 = TapCanvas lluban)
                 │  渠道密钥转发；订单记 tapcanvas_pending + TapCanvasRequestID=jobId
                 ▼
             TapCanvas /public/v1/asset-plans → 10–25 分钟后 succeeded/failed/canceled
                 │
   new-api 对账器 ◄── GET /public/v1/asset-plans/{jobId}/receipt  (total_status=settled, total_amount_cny)
                 │  ReceiveTanvaConsumption(..., "tapcanvas_receipt") → 签名消费回执
                 ▼
             Tanva consumption-orders：receiveEnvelope / 每分钟 reconcile → settleDesktopChatUsage（多退少补）
```

小T门面已走同一条“`tapcanvas_pending` → 上游回执 → `tapcanvas_receipt`”链路（`new-api/service/tanva_consumption.go` 的 `ReconcileTapCanvasReceipts`）；本方案只把它从 chat/completions 扩展到异步规划任务。

## 改动清单

### TapCanvas-pro（hono-api）

- **T1 资产规划人民币回执**：`GET /public/v1/asset-plans/{jobId}/receipt`，返回与现有 `/v1/billing/receipts/:requestId` 相同的 `{ total_status, total_amount_cny }`。现有回执只认 `team_credit_ledger.task_id = openai:${requestId}` 的聊天回合；资产规划在 worker 中以 `reservationTaskId = jobId` 预扣（`public-asset-plan.worker.ts`），终态后 `requestBillingOrderClose` 关单。回执应在账本 deduct/release 完成后才给 `settled`，金额 = 实扣积分 / `creditsPerCny`。
- **T2（P2）**：`video-remakes` 增加 plan-only 交付模式，见“范围”。

### Tanva new-api

- **N1 订单入口**：`middleware/tanva_consumption.go` 目前只允许 `POST /v1/chat/completions` 与 `/v1/responses`。新增 `POST /v1/tanva/asset-plans` 与 `POST /v1/tanva/asset-plans/:jobId/retry`（重试 = 新 jobId + 新订单）：
  - 模型 ID 固定 `tapcanvas-asset-plan`，预扣额度由该模型价格配置给出；
  - 透传 `Idempotency-Key`，用渠道密钥转发到 TapCanvas，原样返回信封；
  - 受理后订单进入 `tapcanvas_pending`，`TapCanvasRequestID = jobId`，并记录回执类型，使对账器请求 T1 路径而非聊天回执路径；
  - 上游明确拒绝（4xx 未受理）直接 `rejected` 释放。
- **N2 只读/停止透传**：`GET /v1/tanva/asset-plans/:jobId`、`GET …/result`、`POST …/cancel`，不建订单；只接受已绑定到某个 Tanva 订单的 jobId。
- 渠道 `price_ratio` 设为 1.0，加价只在 Tanva 侧做一次，避免叠加。
- TapCanvas API Key 只配置为该渠道密钥，不进 Tanva 后端环境变量、仓库或设计 JSON。

### Tanva 后端（NestJS）

新模块 `tapcanvas-plans`：

- Prisma 表 `TapcanvasPlanJob`：`id, userId, teamId?, projectId, apiUsageId, tapJobId, sourceJobId?, status, request(摘要), nodes(Json?, 仅成功节点数组，不存 artifacts), error, createdAt, updatedAt`。
- 接口（`/api/tapcanvas-plans`）：创建、查询、结果、停止、重试、作者模型目录（代理 `/public/v1/models`）。
- 创建流程：校验余额 → 事务内创建 `ApiUsageRecord`（`provider='new-api'`、`model='tapcanvas-asset-plan'`、`requestParams.gatewayConsumption.orderHash`）+ 预扣 + `GatewayConsumptionOrdersService.register()` → 签名调用 N1 → 写入 `tapJobId`。网络不确定时以原 `Idempotency-Key` 重发，不换键。
- 结算完全复用 `consumption-orders`：`markup` 走默认 1.5，`settleDesktopChatUsage` 多退少补，无需新结算代码。
- 参考图只接受已托管的 Tanva OSS 公网 URL（TapCanvas 服务端需可读取）；`data:`/`blob:` 一律拒绝。

### Tanva 前端

- 入口：Flow 工具栏“资产规划”弹窗。填写章节原文；选择作者模型、`reasoningEffort`、`clipPreference`、`knowledgeTier`；可从当前选中图片节点带入参考图（画风/普通）。
- 点击提交立即进入忙碌态并防重复提交；进度卡显示 `progress.nodeSummary` 与中文阶段名，支持停止与失败重试；刷新后从任务表恢复。
- 成功后映射为 Tanva 节点并通过 `instantiateTemplateAt` 一次性落到画布，整章用 `NodeGroup` 包裹，参考图 / 脚本 / 视频分三列。**只建节点，不自动运行**；用户点击生成时走现有报价与扣费。

## 节点映射

| asset-plan 节点 | Tanva 节点 | 说明 |
| --- | --- | --- |
| `image` | 按 `parameters.modelKey` 映射到现有生图节点（`generatePro` / `nano2` / `gptImage2` 等） | 填 `prompt`、比例、尺寸；`role=identity` 的依赖连为参考图边（状态卡以基础角色卡为身份参照） |
| `input:N` | 已有图片/视频节点或新建 `image` 节点（远程 URL） | 用户提交时带入的参考素材 |
| `text` | `textNote` | `parameters.content` 为 Clip 脚本 |
| `video` | 按 `parameters.modelKey` 映射（Seedance 2.0 → `seedance20Video`） | 填编译后提示词、`durationSeconds`、分辨率；`first_frame`/`reference_image` 依赖连到对应输入；`referenceBindings[].mention` 对接 `flow:wirePromptMention` |
| 无法映射的 modelKey | 不静默替换 | 明确提示“该模型在 Tanva 暂无节点”，保留提示词文本节点 |

## 计费口径

- 提交前余额不足：在调用 TapCanvas 之前返回 402。
- 成功 / 失败 / 取消：都按 TapCanvas 回执的实际模型用量结算（取消前已发生的调用照常计费）。
- 重试：新的 TapCanvas 子任务与新订单；从检查点续跑的部分不重复计费。
- 用户可见费用 = `total_amount_cny × 1.5 × 100` 积分（向上取整到现有精度）。

## 风险与待核实

- **视频/图片模型由 TapCanvas 账户冻结**：取决于该 API Key 所属账户已装配的 `full_video` Workflow 与媒体偏好，请求体无法指定。需把该账户的视频目标配置为 Tanva 有对应节点的模型（如 Seedance 2.0），并在上线前只读核对。
- **回执延迟**：T1 依赖 TapCanvas 关单与账本结算；空闲关单最长 24 小时。期间 Tanva 订单保持 pending（预扣占用），需确认终态后关单是即时触发。
- **超额补扣**：实扣高于预扣且用户余额不足时，`settleDesktopChatUsage` 的 `delta > 0` 分支行为需核实（是否允许负余额或进入 reconciliation）。
- **上游余额**：TapCanvas 侧扣的是该账户的团队积分，需运营保障余额，余额不足时上游 402 应映射为 Tanva 明确报错。
- **Key 安全**：该 Key 已在对话中出现，建议上线前轮换后再配置到 new-api 渠道。

## 验证

- TapCanvas：T1 单测覆盖 succeeded / failed / canceled / 未关单四种回执；线上用一个真实小章节核对 `total_amount_cny` 与账本一致。
- new-api：订单签名、`tapcanvas_pending → tapcanvas_receipt` 对账、重试新订单、拒绝路径单测。
- Tanva 后端：创建幂等、预扣/结算/退款与 `consumption-orders` 联调；`npm run build`。
- Tanva 前端：映射纯函数测试（以 README 中《第八章》48 节点真实结果为夹具）；冷加载/慢响应下首次反馈；`npm run lint && npm run build`。
- 端到端：一章真实规划 → 画布节点数、连线、时长与结果一致 → 积分扣减等于回执金额 × 1.5 × 100。
