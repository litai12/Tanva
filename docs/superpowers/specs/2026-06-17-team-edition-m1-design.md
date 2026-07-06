# M1 团队版 实现设计 (2026-06-17)

目标：AI 无限画布 + 工作流平台「团队版」。多人实时协作编辑 + 团队身份/积分语义/计费的产品化。
里程碑：6/25 B 端演示，6/30 交付。

已确认产品决策（来自用户）：
- 范围：全部 6 个子项目都做；A（协作补全）优先。
- 积分语义：团队模式顶部数字显示「个人配额」。成员配额为 null（不限）→ 主数字显示团队可用余额并标注「不限/团队额度」；配额有限 → 显示 `min(剩余配额, 团队可用余额)`。
- 协作范围：全量 = 节点移动 + Prompt 同步 + AI 进度/结果同步 + 对象锁 + 保存防覆盖。
- 团队积分独立充值（F）入口：仅 owner/admin。

---

## A. 协作补全（TODO #5）— 最高优先、最大风险

### 现状
后端协作传输层已完整：`backend/src/team-collab/`（SSE `GET /canvas/:id/stream` 重放、`POST /canvas/:id/patch` 分配 seq + 写事件日志 + 广播、lock/renew/unlock、cursor、toast、presence、event log Redis stream ~500 条、`task_status` 广播）。
前端传输层 `useCanvasCollab.ts` 已实现 subscribe/sendPatch/claimLock/sendCursor，**但是 inert**：
- `useCanvasCollab.ts:121` 故意不写 `connIdRef`，导致 `sendPatch`/`claimLock`/`sendToast` 全部因 `!connIdRef.current` 提前 return —— 实际什么都不发。
- `CollabRoot.tsx:20-22` 注释明确把 patch 采集/应用「留作 follow-up」。今天只有 cursor / presence / task toast 流转。

### 集成点（已勘探）
- ReactFlow 运行时状态：`frontend/src/components/flow/FlowOverlay.tsx`
  - `const [nodes,setNodes,onNodesChange]=useNodesState(...)` (4387), edges (4388)
  - `onNodesChangeWithHistory()` (5051) 处理 position/remove；`onEdgesChangeWithHistory()` (5755)；`onConnect()` (12449)
  - `flow:updateNodeData` 自定义事件监听 (~14138) 应用 prompt/节点 data patch
  - AI 结果：`waitForTask` → `applyTerminal(nodeId,taskId,r)` (~15124)
- Prompt 编辑：`nodes/TextPromptNode.tsx` `commitValue()` (896) dispatch `flow:updateNodeData`
- 进度 UI：`nodes/GenerationProgressBar.tsx`；node.data.status/progress
- Paper.js 图层：`canvas/DrawingController.tsx` / `PaperCanvasManager.tsx`（Paper 原生操作，item.data.id 标识）
- 挂载点：`pages/Canvas.tsx:149 <CollabRoot/>`；同页 `<FlowOverlay/>`(113) + Paper canvas(82)
- 保存：`backend/src/projects/projects.service.ts:233-330` 全量覆盖，`version` 入参被 `void version`(247) 忽略；`schema.prisma` Project.contentVersion。

### 方案
1. **激活传输**：`useCanvasCollab` 在收到 `connected` 时写入 `connIdRef`（从 ConnectedPayload.connId）。保留「抑制自己事件」逻辑（senderConnId 比对）。
2. **collab 上下文桥**：CollabRoot 通过 React Context 暴露 `collab` handle，FlowOverlay/Canvas 子树可访问 `sendPatch`/`subscribe`/`claimLock`，避免在 27k 行组件里重复建连。
3. **Flow 采集**：在 `onNodesChangeWithHistory` 应用本地变更后，提取 position/add/remove → `sendPatch({upsertNodes, removeNodeIds})`；edges 同理；`flow:updateNodeData`（含 Prompt）应用后 `sendPatch({upsertNodes:[{id,data}]})`。采集需带「来源标记」防止应用远端 patch 时回环再发。
4. **Flow 应用**：订阅 `node_patch`，应用 `upsertNodes/removeNodeIds/upsertEdges/removeEdgeIds` 到 `setNodes/setEdges`；应用时设 `applyingRemote` 标志，跳过本地采集。
5. **锁**：选中/拖动节点时 `claimLock(nodeId)`，定时 renew，结束/失焦 release；订阅 `node_lock` 渲染他人锁定边框 + 头像；本地若目标被他人锁定→忽略编辑并提示（toast）。沿用后端 10s TTL。
6. **Prompt 同步**：复用 node data patch 通道（Prompt 是 node.data.text/mentions）。
7. **AI 进度/结果同步**：`task_status` 已广播；在 collab 上下文里订阅，按 `nodeId` `setNodes` 更新 data.status/progress 与结果（resultPreview→imageUrl）。发起方在 `applyTerminal` 后也广播结果 patch 兜底。
8. **保存防覆盖**：
   - `PUT /projects/:id/content` 接收并校验 `baseVersion`；若 `baseVersion < 当前 contentVersion` → 返回 409 + 最新快照（或最新 version）。前端据此拉全量并重放。
   - 协作模式下：以 patch 持久化为主（patch 已落 Redis 事件日志；新增定期/防抖将 contentJson 落库的兜底全量保存，带 baseVersion）。
   - 非协作（个人）模式保持原逻辑。
9. **断线重连**：SSE 已支持 Last-Event-ID/after 重放；`snapshot_required` 时前端拉全量快照（已留 onSnapshotRequired 回调，补其实现：重新 hydrate）。
- Paper.js 图层同步：作为协作的次级目标（move/transform/delete/insert 经 InteractionController 拦截→patch；远端经 paper.project.getItem(id) 应用）。若 6/25 前时间紧，先确保 Flow + Prompt + 进度 + 锁 + 保存防覆盖，再补 Paper 图层。

## B. 刷新回个人模式 Bug（TODO #4）— 小、隔离、高价值
根因：`teamStore` 用 Zustand persist 持久化 `{activeTeamId, teams}`；但 `authStore.loadTeams()` 在网络返回后，若 persist 尚未 rehydrate 或 `loadTeams` 在 rehydrate 之前把 activeTeamId 回落到 personal（`authStore.ts:32-35`），刷新时存在竞态。
方案：
- `loadTeams` 回落到 personal 的逻辑改为：仅当持久化的 activeTeamId 在最新 teams 列表中确实不存在时才回落；rehydrate 完成前不要清空/改写 activeTeamId。
- 确保 persist `onRehydrateStorage` 完成后再触发依赖 activeTeamId 的加载（projectStore.load 已被刻意延后，保持）。
- 可加一个 `teamStoreHydrated` 标志，消费方等待 hydration。

## C. 团队模式积分=个人配额（TODO #2）— 中、隔离
- 后端：新增/确认接口返回「当前用户在 activeTeam 的配额与已用」：creditQuotaMonthly/creditQuotaTotal/creditUsedThisCycle/creditUsedTotal + 团队 availableCredits。（`team-core` / `team-credits` 控制器）
- 前端 `FloatingHeader.tsx:1015-1022` 团队模式显示逻辑改为：
  - 配额 null → 显示团队可用余额，标注「不限·团队额度」。
  - 配额有限 → 显示 `min(剩余配额, 团队可用余额)`。
  - tooltip 解释「当前使用团队额度，显示为你的个人可用配额」。

## D. 团队/个人视觉区分 + 积分 logo（TODO #1 + 设计建议 1-7）— 中、隔离
- 团队模式：team switcher pill 加明确「团队」标签 + 团队气质 icon/头像；积分 pill 换团队额度符号（非金色星星），与 switcher 同一套团队色，视觉联动。
- 个人模式：保持现有个人识别（金色星星 + 个人）。
- 积分 pill title/点击文案：团队模式改「团队额度/团队套餐」。
- 团队下拉补「成员管理 / 配额设置 / 套餐与账单」入口。
- 文件：`FloatingHeader.tsx`、`team/TeamSwitcher.tsx`、`team/TeamManagementModal.tsx`。
（与 C 共用 FloatingHeader/TeamSwitcher，C+D 同一工作流串行处理避免冲突。）

## E. UI 细节偏小（TODO #3）— 小到中、依赖设计稿
缺设计稿图片，先做保守的可读性/间距/字号微调；具体「待优化稿」需用户提供图后再精修。

## F. 团队积分独立充值 `team_credits`（TODO #6）— 中、隔离
现状：仅 `team_seat` 订单类型，耦合「加席位 + 发积分」（`payment.service.ts:773-828`）。`PaymentOrderType='recharge'|'membership'|'team_seat'`（`payment/dto/payment.dto.ts:16`）。
方案：
- DTO：新增 `'team_credits'` 订单类型；定义团队积分充值档位（沿用 100 积分/元，CREDITS_PER_YUAN）。
- `processPaymentSuccess` 新增 `team_credits` 分支：只给 `TeamCreditAccount` 加 balance/totalEarned + TeamCreditLot(source 'topup') + TeamCreditLedger，**不创建 TeamSeatPackage、不改 maxSeats**；广播 team_credits_changed。
- 控制器：team-credits 新增 POST 创建团队积分充值订单（owner/admin 校验，metadata.teamId）。
- 前端：TeamManagementModal 新增「积分充值」入口/页签（owner/admin 可见），复用 PaymentPanel 风格的二维码轮询。

---

## 工作流划分（按文件冲突隔离并行）
- WS1 = B（stores）
- WS2 = C + D（FloatingHeader/TeamSwitcher/TeamManagementModal + 后端配额接口）
- WS3 = F（payment + team-credits + TeamManagementModal/PaymentPanel）
- WS4 = A（FlowOverlay/CollabRoot/useCanvasCollab/Canvas/projects.service）— 由主代理亲自、分层可验证地实现
- E 视设计稿，折入 WS2 微调或待图。

验证：前端 `tsc -b`（project refs，勿用 tsc --noEmit -p）；后端按其构建。协作需双客户端联调（标注为需人工 QA）。
