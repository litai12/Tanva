# 爆款复刻 & 一键成片节点（TapCanvas 资产规划）

## 能力

画布节点 `tapcanvasPlan`（面板「爆款复刻 & 一键成片」，视频分类）：

- **一键成片**：连接或填写故事/章节原文，可连多张参考图（角色/场景或画风）。
- **爆款复刻**：必须连接 1 个参考视频；原视频只交给 TapCanvas 理解，提示词明确禁止作为生成输入。复刻要求缺省为「保留原片的叙事节奏、镜头切点、景别和运镜，人物、场景与台词重新原创设计」。
- TapCanvas `POST /public/v1/asset-plans` 只做规划；成功后节点自动在右侧展开一个分组：每张参考图 = `textPrompt` + 生图节点（按规划 modelKey：gpt-image → `gptImage2`，nano-banana-2 → `nano2`，其余 `generatePro`），每段 Clip = 脚本 `textNote` + 视频提示词 `textPrompt` + `seedance20Video`（时长夹到 4–15 秒，首帧依赖切 `first_frame`，否则 `reference_images` 按 referenceBindings 顺序连参考图）。身份依赖（状态卡 ← 基础卡）连为图片参考边；`input:N` 连回提交时的画布源节点。**只建节点不运行**，生成依赖全部连好，在分组上「运行组」即按拓扑顺序先出参考图再出视频，走各节点原有报价与扣费。
- 展开细则（2026-10-25 修订）：
  - TapCanvas 规划的视频模型在 Tanva 无对应节点时（如账户 `full_video` 目标为 `minimax-h3`），统一回落 `seedance20Video`/`seedance-2.0` 并在节点提示中写明数量，保证分组可一键成片；参考图按 referenceBindings → reference_image 依赖顺序去重连线，超过 Seedance 上限（2.0 为 9 张、2.5 为 30 张）的省略并提示。规划分辨率不在 Seedance 选项内（如 `768p`）时落 720P。
  - 视频提示词按 `referenceBindings[].mention` 写入 Flow 图片提及（`@<mention>` → 对应生图节点），运行时改写为 `@图N` 并附映射脚注，模型才能把每张参考图对上角色/场景/道具；只绑定实际连上且正文出现的 token。首帧取 `firstFrameAssetKey` 或依赖 `role=first_frame`；图片参照取 `upstreamDependencies` 与 `referenceAssetKeys` 并集（对照 TapCanvas `scripts/examples/README.md` §5.3）。
  - 生图节点沿用规划 `size`（1K/2K/4K → `resolution`）与 `quality`（gptImage2 的 low/medium/high）。
  - 镜头文本 `textNote` 与对应 Clip 同行仅作对照，不连入视频提示词（`textPrompt` 接入上游文本会覆盖规划提示词）；配音卡为 `textNote`（音频节点尚不支持分组运行）。
  - 布局为槽位网格：左区参考图每行 3 组「提示词 + 生图」，按角色 → 场景 → 道具 → 色板 → 特效分区、状态卡紧跟基础卡；右区每 Clip 一行「镜头文本 → 视频提示词 → Seedance」。节点 data 写入 `tapcanvasLayout`（planId/origin/slot），展开后 `flow:tapcanvas-plan-relayout` 按实测尺寸与估算高度取大重排，列宽/行高取最大节点，杜绝叠压。
- 节点内可停止、失败续跑（TapCanvas 子任务 + 新订单）、再展开一份；刷新后按节点 `taskId` 恢复轮询。

当前「爆款复刻」是“参考视频作为资产规划输入素材”的方案；TapCanvas 自身复刻链路的逐秒拆解（`video-remakes`）尚未提供 plan-only 出口，后续可替换为该出口而节点与结算不变。

## 计费链路（收口 new-api）

```
前端节点 → POST /api/tapcanvas-plans（预扣 + ApiUsageRecord + consumption-orders.register）
        → new-api POST /v1/tanva/asset-plans（签名订单，渠道 = TapCanvas /public 根）
        → TapCanvas /public/v1/asset-plans（jobId）→ 订单停靠 tapcanvas_pending
new-api 对账器 → GET /public/v1/asset-plans/{jobId}/receipt（total_status=settled 时的 total_amount_cny）
        → 签名消费回执 → Tanva consumption-orders → settleDesktopChatUsage 多退少补
```

- 口径：TapCanvas 1 元 = 10 积分；Tanva 1 元 = 100 积分且加价 50%。回执人民币 × 1.5 × 100，即 **TapCanvas 实扣积分 × 15**（例：37 → ¥3.7 → 555 积分）。
- new-api 渠道 `price_ratio` 必须为 1.0，加价只在 Tanva `consumptionCredits` 做一次。
- 个人钱包提交时真实预扣 `TAPCANVAS_PLAN_RESERVE_CREDITS`（默认 500）；团队钱包与桌面网关订单一致为零预留，仅校验可用余额 ≥ 预扣额（避开团队预留 20 分钟 TTL）。实扣超出余额时订单进入 `reconciliation_required` 持续重试，不丢账。
- 成功 / 失败 / 取消都按已发生的模型用量结算；上游明确拒绝（400/401/402/403/404/409/422）零费用退款；网络不确定不退款，下次查询按原订单 + 原 Idempotency-Key 重发。

## 改动位置

- TapCanvas-pro：`apps/hono-api/src/modules/apiKey/public-asset-plan.receipt.ts`（新回执接口），README §5.7 与 openapi.json。
- new-api：`controller/tanva_asset_plan.go`、`service/tanva_asset_plan.go`、`model/tanva_consumption.go`（`TapCanvasJobID` 列）、对账器按回执类型取路径。
- Tanva 后端：`backend/src/tapcanvas-plans/`（任务复用 `VideoTask`，`taskType='tapcanvas-plan'`，无迁移）。
- Tanva 前端：`nodes/TapcanvasPlanNode.tsx`、`tapcanvasPlanExpansion.ts`、`services/tapcanvasPlanApi.ts`；`flow:instantiateTemplate` 支持 `detail.position` 显式落点。

## 上线配置

1. TapCanvas 部署回执接口。
2. new-api：新增 TapCanvas 渠道（Base URL `https://www.lluban.cn/public`，密钥为 TapCanvas `tc_sk_` Key，`price_ratio=1.0`，模型含 `tapcanvas-asset-plan`）；为 `tapcanvas-asset-plan` 配置固定 ModelPrice（仅作 new-api 侧预占额度，不决定最终费用）。
3. Tanva 后端：`TANVA_CONSUMPTION_SECRET` 已开启且 `TANVA_CONSUMPTION_SCOPE` 不是 `desktop`；可选 `TAPCANVAS_PLAN_RESERVE_CREDITS`、`TAPCANVAS_PLAN_AUTHOR_MODELS`。
4. TapCanvas 接入账户的 `full_video` Workflow 视频目标应为 Seedance 2.x，否则展开后视频节点会被保留为提示词。

## 验证

- `cd backend && npm run test:tapcanvas-plans && npm run build`
- `cd frontend && npm run test:tapcanvas-plan-expansion && npm run build`
- new-api：`go test ./service -run 'TanvaAssetPlan|TapCanvas'`
- TapCanvas：`cd apps/hono-api && npx vitest run src/modules/apiKey/public-asset-plan.receipt.test.ts`
