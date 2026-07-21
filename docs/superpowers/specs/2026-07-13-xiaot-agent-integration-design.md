# 小T 智能体接入 Tanva 设计（画布宿主开放协议）

日期：2026-07-13
状态：已与用户对齐方向，待实施
相关仓库：本仓库（Tanva）+ `/Users/libiqiang/workspace/TapCanvas-pro`（小T，允许改造）

## 1. 目标

1. Tanva 用户在画布上获得小T的全部智能体能力（对话、读画布上下文、增删改节点/连线、驱动生成），第一期先核心后扩展。
2. 小T从"TapCanvas 内置智能体"升级为**开放的画布 Agent 服务**：定义一套与宿主无关的接入协议，后续任何第三方画布平台只需对接接口即可接入，不改小T代码。
3. Tanva 侧接入方式：**小T作为 new-api 的一个新增渠道**（沿用 kapon/seed-audio 的接入范式），计费走 new-api token 计量。
4. 改造完成后，更新 TapCanvas-pro 的对外接入文档（面向三方画布平台）。

## 2. 已验证的环境事实（2026-07-13 实测）

- 小T全栈在本地 Docker（colima）运行：`hono-api-api-1` :8788、`agents-bridge`×2（agents-cli）、TapCanvas new-api :4455、Tanva new-api :4458（`tanva-new-api` 容器）、postgres :5432、redis。
- 用户提供的 `tc_sk_EPYQZg...` key 为**本地环境**签发（`api_keys` 表，label="当前画布"，enabled）；线上 `t-api.neospark.cn` 对它返回 `api_key_invalid`。**联调基准环境 = 本地 Docker 栈**，key 值不落文档/代码，通过 env 注入。
- `POST /public/agents/chat`（x-api-key 鉴权）已实测走通：SSE 事件 `initial → session → thinking → agent_role → content(delta) → block(start/delta/end) → item.completed → result(含 trace/completion)`。会话由 `sessionKey` 持久化，历史跨轮记忆。
- 结论：小T对外入口已具备鉴权、会话、结构化流。**OpenAI facade 包在 hono 层而非 agents-cli 层**，只做格式转换，最薄。

## 3. 总体架构

```
Tanva前端(AIChatDialog) ──POST /agent/runs──> Tanva后端 agent 模块
        ▲  SSE /agent/runs/:id/events              │ chat/completions (stream)
        │                                          ▼
        │                                  Tanva new-api（新增渠道，纯配置）
        │                                          │ OpenAI 协议
        │                                          ▼
        │                    小T hono-api /public/v1/chat/completions（新增 facade）
        │                                          │ 既有内部协议
        │                                          ▼
        │                              agents-bridge / agents-cli（内核，不改）
        │
        └── agentPatchApplier ──> window 事件桥 ──> FlowOverlay/画布
```

原则：**小T对宿主画布零先验知识**。宿主每次请求携带"能力清单"，模型直接用宿主词汇输出画布指令。接入新平台无需改小T。

## 4. 接入协议（三方平台对接面，v1）

### 4.1 上行：标准 chat/completions + 结构化 system 段

```jsonc
POST {BASE}/public/v1/chat/completions   // Authorization: Bearer tc_sk_* 或 x-api-key
{
  "model": "xiaot-agent",
  "stream": true,
  "user": "<宿主侧会话键，映射 sessionKey，跨轮记忆>",
  "messages": [
    { "role": "system", "content": "<capability_manifest>{...JSON...}</capability_manifest>" },
    { "role": "system", "content": "<canvas_context>{...JSON...}</canvas_context>" },
    { "role": "user", "content": "用户消息" }
  ]
}
```

- `capability_manifest`：宿主声明 `protocol_version`、节点类型清单（type、参数 schema、输入/输出 handle、约束）、支持的 patch 操作子集。小T据此动态构建系统提示（替代写死的 `canvasNodeSpecs`）。
- `canvas_context`：当前画布轻量快照 `{nodes:[{id,type,label,素材URL,...}], edges:[...]}`。
- 用 system 消息段而非私有 body 字段：**全程标准 OpenAI 协议**，任何 relay（new-api/OneAPI/宿主网关）无损转发；无 manifest 的请求回落小T原有行为，TapCanvas 自身不受影响。
- 多轮历史：宿主可只发增量 user 消息 + `user` 字段（服务端 sessionKey 记忆），或自带完整 messages，两者都支持。

### 4.2 下行：标准 SSE chunk

- 文本 → `delta.content`（由内部 `content`/`block` 事件映射）。
- 画布操作 → `delta.tool_calls`，function name 固定 `flow_patch`，arguments 为单个操作 JSON：
  `addNode / updateNodeData / connectEdge / focusNode / placeImage / runNode`（宿主 manifest 声明支持子集；节点 id 由小T侧生成 ULID，宿主乐观应用，fire-and-forget）。
- 思考/角色等富事件 → 舍弃或折叠为注释性 chunk（v1 不进协议，宿主要富 UI 二期再谈）。
- 终帧 → `finish_reason:"stop"` + `usage`（内核多轮 LLM 调用 token 汇总，供宿主计费）。
- 中断：客户端断开连接即止损（patch 只随流下发，断流无后续副作用）；hono 侧沿用既有 interrupt 机制在断连时终止 run。

### 4.3 协议治理

- patch 操作与 manifest 的 JSON Schema（zod 定义导出）随接入文档发布，宿主照此校验。
- `protocol_version` 进 manifest，小T向后兼容。

## 5. TapCanvas-pro 侧改造（三个点 + 文档）

1. **OpenAI facade**（新文件，hono `/public/v1/chat/completions`）：messages↔prompt+sessionKey 映射、内部 SSE 事件↔OpenAI chunk 映射、usage 汇总；复用既有 apiKey 鉴权/会话/计费钩子。
2. **manifest 驱动提示组装**：`agents.service` 构建系统提示处解析 `capability_manifest` 段 → 动态生成节点能力提示；无 manifest 回落 `canvasNodeSpecs` 原行为。
3. **flow_patch 流内下发**：manifest 模式下，画布写工具不回打 TapCanvas tool-bridge，改为写 tool_call 帧 + 本地返回 ok。
4. **接入文档**：新增/改写面向三方画布平台的《画布平台接入指南》（协议说明、两个 JSON Schema、SSE 说明、鉴权、计费字段、curl 示例、最小接入 checklist），与既有 `integration-doc-content.ts`（A2A/MCP 文档）并列。

## 6. Tanva 侧接入（首个参照实现）

- **new-api**：加 OpenAI 类型渠道 → `http://hono-api-api-1:8788/public`（容器网络）/ 生产填对应地址，密钥 = tc_sk key，模型 `xiaot-agent`，按 token 定价。**纯配置，零代码。**
- **后端**（扩展 `backend/src/agent/`）：新 run 分支——收前端消息+画布快照 → 拼 system 段 → 经 new-api 调 `xiaot-agent`（stream）→ 复用 `/agent/runs/:id/events` SSE 转发（文本 delta、flow_patch 帧、done/error）。计费：按终帧 usage 映射积分挂 `withCredits`（现有 AgentController 欠计费，一并补）；断流未收到 usage 按已收帧估算。鉴权沿用 `ApiKeyOrJwtGuard`。
- **前端**：
  - UI 复用 `AIChatDialog` + `aiChatStore` 现有 run→SSE→trace 链路，新增"画布操作卡片"渲染。
  - 读画布：发起对话时 `rf.getNodes()` 快照随请求上传；能力清单为前端常量文件（与 zod schema 同源）。
  - 写画布：新增 `agentPatchApplier`（独立文件），tool_call → window 桥：`updateNodeData→flow:updateNodeData`、`focusNode→flow:focus-node`、`placeImage→triggerQuickImageUpload`（均现成）；`addNode / connectEdge / runNode` 需在 FlowOverlay 新增三个事件处理器（仿 `flow:updateNodeData`，最小挂载点，逻辑放独立文件）。
  - 校验失败：toast + 记入下一轮 canvas_context。

## 7. 生成能力与分期

- **一期（本设计范围）**：对话 + 读画布 + `addNode/updateNodeData/connectEdge/focusNode/placeImage/runNode`。生成由 agent `addNode`(生成节点带 prompt/参数)+`runNode` 触发 **Tanva 现有生成管线与扣费**，agent 不等待结果。skill/记忆/子agent 随内核天然可用。
- **二期（按需）**：同步 remote tools（生成结果 URL 回给 agent 链式推理）、读图/读视频分析、素材库检索、子agent 团队富 UI、视频编排 pipeline。

## 8. 测试与验收

- 契约单测：manifest→提示组装（TapCanvas 侧）；patch zod 校验、applier 映射（Tanva 侧）。
- 联调（本地 Docker 栈）：
  1. curl 直打 facade（tc_sk key）验证 OpenAI 格式流 + flow_patch tool_call 帧；
  2. Tanva new-api(:4458) 渠道打通后同 curl 过网关验证透传与计费记录；
  3. Tanva 前端端到端：对话让小T"加一个文本节点并连到某图"，画布实时落节点、协作端同步、积分扣减正确。
- 回归：TapCanvas 自身画布对话（无 manifest 路径）行为不变。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 内部 SSE 事件与 OpenAI chunk 语义映射有损（block/thinking/agent_role） | v1 只保文本+flow_patch+usage，富事件二期扩展协议 |
| 两边节点参数 schema 表达力不齐（Tanva 节点参数复杂） | manifest 的参数 schema 用 JSON Schema 子集，一期只暴露常用参数 |
| FlowOverlay(28k 行)/aiChatStore(9.6k 行) 巨文件 | 新逻辑一律独立文件，巨文件内只加最小挂载点 |
| usage 汇总口径（agents-cli 多轮内部调用） | facade 聚合 run trace 内 token 统计；实测 `result` 事件已带 trace，实施时确认字段 |
| tc_sk key 泄露面 | key 只进 new-api 渠道配置与本地 env，不落代码/文档 |
