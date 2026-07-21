# 小T接入 P2 实施计划（富格式协议 / 模式切换与模型选择 / manifest 扩展）

> **For agentic workers:** 用 superpowers:subagent-driven-development 逐任务执行。前置调研已完成（2026-07-13，三份报告在会话内），本计划记录的是已定案的设计决策与任务拆分。

**分支**：TapCanvas-pro `feat/canvas-host-protocol`；Tanva `feature/agent`。

## 已定案的设计决策

### D1. chat 模型选择（协议）
- facade 接受 `body.model` 门面名并映射 `extras.modelAlias`（链路 bridge→agents-cli 已就绪，零改动）：
  - `xiaot-agent`（默认）→ 不下发 override（内核默认 claude-opus-4-8）
  - `xiaot-agent-claude-4-8` → `claude-opus-4-8`；`-4-7` → `claude-opus-4-7`；`-4-6` → `claude-opus-4-6`
  - 直传白名单内真实 id（claude-opus-4-8/4-7/4-6、claude-sonnet-4-6、claude-fable-5）也放行
  - 其余 → OpenAI 400（invalid_request_error, code=model_not_supported）
- 解析出的真实 id 同步作为 `beginChatBilling` 的 modelKey（命中定价快照，冻结额更准）。
- Tanva：前端小T模式下模型选择器 = [Claude 4.8(默认)/4.7/4.6]→dto.model 传门面名；后端透传（白名单校验）。
- new-api patch 002：渠道 438 的 models/abilities 追加三个门面名。

### D2. 富格式 UI 协议（协议 v1.1）
- manifest 可选字段 `ui: ("choices"|"suggestions"|"media"|"request_user_input")[]`。
- facade：
  1. **止血（无条件）**：content 流内剥离 choices 卡（```choices 围栏或裸 `{"question"`）与 ```tc-card 围栏，跨 chunk 缓冲（未闭合先扣留，闭合后决定丢弃或转卡；流结束 flush 残余为原文）。
  2. 声明过的 kind → `delta.tool_calls`，function name **`host_ui`**，arguments `{kind, payload}`：
     - choices: `{question, options:[{label, description?}]}`（来自 content 剥离）
     - suggestions: `{items: string[]}`（来自 suggestions 事件）
     - media: `{layout, items:[{kind:"image"|"video", url, thumbnailUrl?, title?}]}`（来自 block op:set media；result.assets 兜底去重）
     - request_user_input: `{requestId, questions:[...]}`（来自 block choice；宿主回填走下一条 user 消息文本，v1.1 非阻塞语义）
  3. 未声明的 kind：结构化事件不下发；宿主提示块（renderHostManifestPrompt）注明"未声明 choices 时问题用纯文本列点提问，禁用 JSON 卡；未声明 request_user_input 时不得调用该工具"。
- 接入文档新增"富格式 UI 协议（可选）"一节：每 kind 的 schema、渲染建议、不声明的降级行为。
- Tanva 声明 `["choices","suggestions","media"]` 并渲染：choices→选项按钮（点击原文回发）；suggestions→chips；media→消息内图/视频。request_user_input 暂不声明。
- 后端 xiaot-agent.service：`function.name==="host_ui"` → 新事件类型 `host_ui`（data={kind,payload}）转发前端。

### D3. manifest 扩展（分层暴露）
按调研分层：第一层全 spec（generatePro/generatePro4/seedream5/nano2/sora2Video/seedance20Video/kling26Video/wan27Video），第二层 stub（type+label+purpose 一句话：generate/generate4/generateRef/kling系/vidu系/doubao系/wan系/happyhorse/omniFlashExt/klingO1），第三层不进（midjourneyV7/niji7/audioStudio/seed3d 等）。
通用约定进 notes：①生图 modelProvider 三档 banana-2.5/banana/banana-3.1，参考图上限 3/11/14；②非 Pro 生图与全部视频节点须先建文本节点 connectEdge 到 `text` 输入再 runNode，generatePro/Pro4 用 data.prompts 自足；③视频输出统一 `video`、生图统一 `img`，seedream5 文本入口是 `prompt`；④修正现有 generate spec 的误导（presetPrompt+需文本边）。
体积目标 ≤7KB。

## 任务拆分

- **A（TapCanvas facade·小）**：D1 模型映射+白名单+billing modelKey；测试补映射用例。
- **B（new-api·配置）**：patch 2026-07-13/002 追加渠道 438 门面模型名；应用+重启。
- **C（Tanva 后端·小）**：dto.model 白名单透传（门面名）；host_ui tool_calls→host_ui 事件；AgentEventType 加 host_ui。
- **D（TapCanvas facade·大）**：D2 剥离器+host_ui 发射+manifest ui 字段(schema)+宿主提示更新+接入文档节；剥离器单测（跨 chunk 分片/围栏/裸 JSON/流尾残余）。
- **E（Tanva 前端·中）**：D3 manifest 重写 + ui 声明。
- **F（Tanva 前端·大）**：小T模式化输入栏（隐藏 Text/比例/分辨率等，模型选择器换 Claude 三档）；host_ui 三类卡渲染（choices 按钮/suggestions chips/media 图视频）。
- **G（联调）**：模型切换生效验证（不同 claude 回复画风/用 run 事件确认 modelAlias 下发）；choices 卡不再泄漏且渲染为按钮；media 卡显示小T出图；manifest 扩展后让小T自选视频模型建节点。

执行序：A/B/C/E 并行 → D/F 并行 → G。
