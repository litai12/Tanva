# 2026-09-08 小T宿主查询与续跑挂起

状态：**本地源码修复与回归验证，未部署。** 未修改生产项目、重投视频、切换模型或重启服务。

## 生产证据

- 项目：`827948ea-f496-4f64-bd42-4078a4d02ed7`。
- Tanva run：`305f7d66-3593-4f83-885e-8c87a873a109`。
- 上游根请求：`7e639df2-5d28-4af3-9044-520c47aabff2`。
- 续跑：`async-continuation:186aa411174c42396ff95ec36a2b6f3684ea1742`。
- 输入“生成5s视频”，模型 DeepSeek V4 Flash。
- 首次 Hono admission 为 `2026-09-07T23:59:48.665Z`，Agent 自建预算为 `2026-09-07T23:59:48.704Z`，相差 39ms。
- 08:00:06（UTC+8）起反复查询画布/能力，仅得到 emitted_to_host、applied=false；重复读又被通用幂等检查拒绝。
- 08:02:40 首个物理窗口仅发出 textPrompt addNode，返回“画布已更新”，没有视频供应商受理证据。
- 08:02:41.609 续跑已经 failed。数据库 lastFailure：agents_bridge_failed，upstreamStatus=400，logical_task_budget_changed_during_continuation。
- 08:07:40 Tanva 记录 transport terminated，并开始同一 accepted turn 的恢复读取。
- 独立只读检查中会话历史与 meta 可毫秒级读取，未见 PostgreSQL 活跃锁等待；没有依据归因为数据库卡死。

## 修复

1. 初次 OpenAI 宿主调用缺少 extras.publicTurnId 时，Hono 现在以 requestId 对应的持久 admission 发送预算，保证与续跑一致；没有放宽 Agent 的预算一致性校验。
2. 根失败传播不再按 public-chat-turn 前缀排除 UUID；执行、失败回传和状态等待通过 agents-host-identity 共用 owner + hostUserId，保留准确 turnId 并发保护。
3. 宿主查询返回 emitted_to_host/applied=false 时立即产生 host_execution_required 交接。Hono 允许已声明查询和同步命令的 runNodeCount=0 交接，仍验证命令与 ticket，不推导供应商受理或媒体完成。
4. async_artifact 的 addNode 不再被当完整交付，仍需继续组织 runNode；state_change 同样等待宿主真实执行。
5. Tanva 续接保留 capability/context，完整返回去重后的查询，不再丢弃第四条查询或直接拒绝第三轮；共享首次绝对截止时间，先释放旧流，最终只结算一次。读取过程发送真实 step 事件。
6. 网页声明并渲染 request_user_input 的问题、选项及自由输入，回答经现有聊天发送入口返回，不伪造视频成功。

## 源码归属

Tanva：backend/src/agent/xiaot-agent.service.ts、xiaot-agent-context-handoff.spec.ts；frontend/src/services/agentCanvasProtocol.ts、frontend/src/components/chat/XiaotCards.tsx。

TapCanvas 上游 `/Users/libiqiang/workspace/TapCanvas-pro`：
- apps/agents-cli/src/core/agent-loop.ts 与测试。
- apps/hono-api/src/modules/task/logical-task-budget.ts、task.agents-bridge.ts。
- agents-host-identity.ts、async-agent-continuation.ts、public-openai-logical-turn.ts、public-openai-compat.ts。
- public-chat-host-async-evidence.ts 与对应测试。
- 两侧 README 已同步。

上游仓库既有且仍在变化的其他未提交工作已保留，没有将整个上游 diff 打成补丁，没有提交或发布混合改动。

## 验证

- Hono 六个测试文件共 77 项通过：预算、交接、宿主隔离等待、逻辑终态、OpenAI 协议、continuation sweep。
- Agents Runtime 三项 AgentRunner 回归通过：runNode 交接；query_canvas 一次调用即交接；addNode 后继续 runNode。
- Tanva 新增上下文回归通过：三轮查询续接、每轮四条完整返回、每轮保留能力/画布、只结算一次。
- Tanva 原有 delivery、host-handoff、recovery、fixed-route 回归通过。
- Tanva 前端 TypeScript/Vite、后端构建及 Agents TypeScript 编译通过。
- Hono 构建通过，其 gate 放行 111 项存量类型错误；不能描述为零类型错误。
- 前端全量 lint 未通过：2762 项（2563 errors / 199 warnings）；新改组件定向检查通过，agentCanvasProtocol 原有正则仍有 15 项 no-useless-escape。
- git diff --check 通过。未调用付费模型或提交真实视频，不等同于生产视频端到端验收。

## 发布与限制

发布范围：Tanva 前端/后端、TapCanvas Agents Bridge、Hono API 及使用同一 API 镜像的 continuation/workflow workers。只发布 Tanva 无法修复 admission 与根终态。历史 failed 记录未重置，避免重放已有动作；生产状态尚未改变。

另有 knowledge_search embedding 401（key 未激活），本次未变更凭据，需配置方恢复有效检索凭据。

AI metadata 同步脚本 /Users/libiqiang/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs 缺失，知识库已手工同步。

已执行上游 `graphify update .`；扫描完成，但工具因新图节点数 69882 少于既有 70655 拒绝覆盖。未使用 force 覆盖共享图谱，图谱更新不算通过。
