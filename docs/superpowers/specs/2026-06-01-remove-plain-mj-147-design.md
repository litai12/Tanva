# 删除走 147 的「普通 Midjourney」(midjourney-fast/relax) — 设计

日期：2026-06-01
分支：`feat/remove-plain-mj-147`（从 `main` 切出）→ 完成后合并 `main`

## 背景与动机

普通 MJ 节点经 new-api 类型65(mjproxy) 渠道对接 147AI 上游出图（`midjourney-fast`/`midjourney-relax`）。
实测确认：147AI 账号(`api1.147ai.com`)的所有令牌分组(auto/sora2逆)均**未挂 Midjourney 渠道**，
`mj_imagine` 一律 `No available channel`；其余 147 实例(`147ai.com`/`api.147ai.cn`)也不认现有 key。
即货源缺失，普通 MJ 不可用，决定下线。

走悠船(youchuan, 类型64) 的 **MJ V7 / Niji 7 是好的，全部保留**。

## 范围（已与用户确认）

- 只删走 147 的普通 MJ（`midjourney` 节点 / `midjourney-fast` / `midjourney-relax`）。
- 保留 V7/Niji（`midjourneyV7` / `niji7` 节点，模型 `midjourney-v7` / `midjourney-niji-7`，走悠船）。
- 彻底删代码（backend + frontend 两层）。
- **聊天里那套 MJ 也一起删**：AIChatDialog 的 MJ 生图 + U1-U4 变体/action 按钮、`executeMidjourneyAction`、
  `POST midjourney/action`、`POST midjourney/modal` 端点、`MidjourneyActionDto`/`MidjourneyModalDto`。
- **new-api 一律不动**（应用户要求）：类型65 适配器/渠道/常量/seed patch 全部原样保留；
  那条闲置渠道留着无害。不新增清理 patch、不删 006 seed。

## 共享边界（务必不误删）

普通 MJ 与 V7/Niji **共用** `aiProvider: "midjourney"` 标识、`MidjourneyProvider` 类、
`MidjourneyNode.tsx` 组件、`MidjourneyProviderOptions` 类型、以及文本/分析的 `midjourney → gemini-*` 兜底。
这些**全部保留**，只切除普通 MJ 专属分支。

## 改动清单

### backend
- `src/ai/providers/midjourney.provider.ts`
  - 删 legacy 直连 147 路径：`MIDJOURNEY_API_KEY` / `MIDJOURNEY_API_BASE_URL` / `apiKey` / `apiBaseUrl` /
    `authMode === 'legacy'` 分支 / 直连 `/mj/submit/*` 调用与对应 generate/edit/blend/describe legacy 实现。
  - `supportedModels` 去掉 `midjourney-fast` / `midjourney-relax`（改为 V7/Niji 模型）。
  - 保留 youchuan + `MIDJOURNEY_VIA_NEW_API` 受管路径（V7/Niji 用）、`MidjourneyProvider` 类与 factory 注册。
- `src/ai/ai.controller.ts`
  - 删 `@Post('midjourney/action')`、`@Post('midjourney/modal')` 两个端点（仅普通 MJ 变体用，V7/Niji 不用）。
  - 删/改 行143 `midjourney: 'midjourney-fast'`（图像默认模型映射，普通 MJ 专属）。
  - 保留文本/分析的 `midjourney: 'gemini-3.1-pro'` 等共享映射。
- `src/ai/dto/*`：删 `MidjourneyActionDto`、`MidjourneyModalDto`（若仅这两个端点引用）。
- cost-calculator / node-config：删 `midjourney-fast`/`midjourney-relax` 专属计费项（若有），共享项保留。
- `.env` / `.env.local` / `.env.example`：删普通 MJ(147) 相关注释与 `MIDJOURNEY_API_KEY`/`MIDJOURNEY_API_BASE_URL` 模板项。

### frontend
- `src/components/flow/FlowOverlay.tsx`：删所有 plain `midjourney:` 映射项
  （nodeTypes 992、price 1601、category 1771、size 1858、handles 2178/2229、mjMode 默认等），保留 `midjourneyV7`/`niji7`。
- `src/components/flow/nodes/MidjourneyNode.tsx`：切除非-`isAdvanced`（普通 MJ）渲染与逻辑分支，
  只保留 `isAdvanced`(V7/Niji)；`MidjourneyMode = 'FAST'|'RELAX'` 等普通 MJ 专属类型一并清。
- `src/components/flow/hooks/useImageNodeCreditsPreview.ts`：`ImageNodeType` union 去 `"midjourney"`；
  对应分支条件改为只 `midjourneyV7`/`niji7`。
- `src/services/nodeConfigService.ts`：删 `{ nodeKey: "midjourney", ... }` 节点项。
- `src/services/aiBackendAPI.ts`：删 `MIDJOURNEY_IMAGE_MODEL = "midjourney-fast"` 及 provider→model 普通 MJ 映射。
- `src/stores/aiChatStore.ts`：删 `MIDJOURNEY_IMAGE_MODEL`、`executeMidjourneyAction` 及聊天 MJ 生图/变体相关；
  保留 `provider === "midjourney"` 等共享判断与文本兜底。
- `src/stores/imageHistoryStore.ts`：nodeType union 去 `'midjourney'`。
- `src/components/chat/AIChatDialog.tsx`：删 `MidjourneyActionButtons`、`executeMidjourneyAction` 调用与相关 UI。
- `src/types/ai.ts`：删 `MidjourneyActionRequest`/`MidjourneyModalRequest`（若仅聊天 action 用）；
  保留 `aiProvider: 'midjourney'`、`MidjourneyProviderOptions`。
- i18n `zh-CN.ts`/`en-US.ts`：删普通 MJ 节点文案；`midjourneyImagine`/`midjourneyVariation` 计费名按是否仅普通 MJ 使用决定删/留。

### new-api
- 不改动。

## 验证

- backend：`tsc`（或 `bun run build`）无类型错误，nest 启动无路由/DI 报错。
- frontend：`bun run build` / `tsc` 通过，画布无 `midjourney` 节点、`midjourneyV7`/`niji7` 正常，聊天无 MJ 按钮。
- 全局搜残留：`midjourney-fast`、`midjourney-relax`、`MIDJOURNEY_IMAGE_MODEL`、`executeMidjourneyAction`、
  `midjourney/action`、`midjourney/modal` 在 backend+frontend 应为 0（new-api 除外）。
- codex：设计稿 + 最终 diff 各审一次（用户标准流程）。

## codex 评审补充（2026-06-01，必须并入）

**Explore 漏掉、必须补删的点：**
- `backend/src/admin/services/node-config.service.ts`：两处默认节点 seed `{ nodeKey:'midjourney', serviceType:'midjourney-imagine' }` → 删，否则普通 MJ 节点会被回填。
- `frontend/src/pages/Admin.tsx`：普通 MJ 模型管理入口——模板选项、`shouldReuseTemplateNodeKey`、默认 `modelKey:"midjourney"`、`MANAGED_MODEL_SUPPORTED_MODELS_MAP["midjourney"]=["midjourney-fast"]`、`SERVICE_TYPE_MAP["midjourney"]`、能力矩阵 → 删。
- `frontend/src/components/flow/FlowOverlay.tsx`：除已列 mapping 外，还要删 `FLOW_GROUP_RUNNABLE_TYPES` 的 `"midjourney"`、quick connect 正/反向预设、`IMAGE_DYNAMIC_CREDIT_NODE_TYPES`、run 分支两处 `model:"midjourney-fast"`、history `nodeType:"midjourney"`、`flow:midjourneyAction` 监听、`midjourneyActionViaAPI` import。
- `frontend/src/components/flow/nodes/MidjourneyNode.tsx`：不止删非-advanced UI，还要删 `renderActionButtons`、`flow:midjourneyAction` dispatch、`buttons/taskId/mjApiState` 相关 UI 行为（否则 V7/Niji 可能显示来自 metadata 的旧 action 按钮、点了打到已删端点）。
- `frontend/test/demo-midjourney-tester.html`：坏测试页，删/标废弃。
- `midjourney.provider.ts` 的 `generateImage/editImage/blendImages` 里 `request.model ?? 'midjourney-fast'`：**缺 model 直接拒绝或只允许显式 v7/niji，绝不缺省成 V7**（避免旧调用被静默路由）。

**codex 纠正的保留点（覆盖原 spec 中的"按需删"）：**
- **保留 `midjourney-imagine` 计费 serviceType**：V7/Niji 仍在 `useImageNodeCreditsPreview` 里用它。只有 `midjourney-variation`(变体)是普通 MJ 专属，可随 action 端点一起删。
- 保留 `MidjourneyMetadata` / `metadata.midjourney`（V7/Niji 结果走这个容器）。
- 保留 `providerDefaultTextModels.midjourney` / `providerDefaultAnalyzeModels.midjourney` 的 Gemini 兜底。

**实施顺序（codex 建议）：**
1. 后端端点+DTO：删 `midjourney/action`、`midjourney/modal` + Action/Modal DTO + provider 的 triggerAction/executeModal 及类型。
2. 收紧 `MidjourneyProvider`：只允许 V7/Niji 模型，去 legacy 147 分支与 `midjourney-fast/relax` 缺省。
3. 前端 API 层删 action/modal 方法+类型 → 删 Chat 的 `executeMidjourneyAction`/`MidjourneyActionButtons`。
4. 清 Flow 普通 `midjourney` 节点注册/palette/run 分支/quick connect/history nodeType，保留 V7/Niji。
5. 清 Admin 页 + node-config 默认 seed 的普通 MJ。
6. 全局搜归零（backend/src + frontend/src）：`midjourney-fast`、`midjourney-relax`、`midjourney/action`、`midjourney/modal`、`executeMidjourneyAction`、`flow:midjourneyAction`；`midjourney` 本身不要求为 0。

## 风险

- `MidjourneyNode.tsx` 与 `aiChatStore.ts` 是普通 MJ / V7/Niji / 共享逻辑混编，切除需逐处分辨，
  误删会连带破坏 V7/Niji 或聊天其它 provider。实施时对每处共享判断保守保留，仅删确定的普通 MJ 专属代码。
- 数据库里已 seed 的 `147ai-mj`(type65) 渠道保留不动（用户要求），属已知可接受的闲置项。
