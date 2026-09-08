# 2026-09-08 小T宿主查询与续跑挂起

状态：**2026-09-08 13:49（UTC+8）101 已部署，真实网关与模型的查询返回/画布命令下发验收通过。** 验收使用隔离内存画布，未重投原项目视频或切换模型。

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

7. 真实 HTTP 工具回执是 `AgentsToolExecuteResponse { ok, content, data }`，Agent 解包 data 后判断 emitted_to_host/applied=false，避免只在裸 JSON 测试中生效。Hono 对 `waiting_external` 登记宿主 ownership；公开 schema 的 runNodeCount 接受 0，避免成功登记后投影丢掉交接身份又转回服务端等待。
8. Tanva 的 replay result 识别有效 external_handoff，即使没有 runNode 也交还查询结果；resync、terminal result 和 live [DONE] 不再等待连接 EOF。前端显示真实 step 事件并在 done 释放流。

## 源码归属

Tanva：backend/src/agent/xiaot-agent.service.ts、xiaot-agent-context-handoff.spec.ts；frontend/src/services/agentCanvasProtocol.ts、frontend/src/components/chat/XiaotCards.tsx。

TapCanvas 上游 `/Users/libiqiang/workspace/TapCanvas-pro`：
- apps/agents-cli/src/core/agent-loop.ts 与测试。
- apps/hono-api/src/modules/task/logical-task-budget.ts、task.agents-bridge.ts。
- agents-host-identity.ts、async-agent-continuation.ts、public-openai-logical-turn.ts、public-openai-compat.ts。
- public-chat-host-async-evidence.ts 与对应测试。
- 两侧 README 已同步。

上游仓库既有且仍在变化的其他未提交工作已保留，没有将整个上游 diff 打成补丁，没有提交或发布混合改动。

## 前次本地验证（发布前）

- Hono 六个测试文件共 77 项通过：预算、交接、宿主隔离等待、逻辑终态、OpenAI 协议、continuation sweep。
- Agents Runtime 三项 AgentRunner 回归通过：runNode 交接；query_canvas 一次调用即交接；addNode 后继续 runNode。
- Tanva 新增上下文回归通过：三轮查询续接、每轮四条完整返回、每轮保留能力/画布、只结算一次。
- Tanva 原有 delivery、host-handoff、recovery、fixed-route 回归通过。
- Tanva 前端 TypeScript/Vite、后端构建及 Agents TypeScript 编译通过。
- Hono 构建通过，其 gate 放行 111 项存量类型错误；不能描述为零类型错误。
- 前端全量 lint 未通过：2762 项（2563 errors / 199 warnings）；新改组件定向检查通过，agentCanvasProtocol 原有正则仍有 15 项 no-useless-escape。
- git diff --check 通过。未调用付费模型或提交真实视频，不等同于生产视频端到端验收。

## 发布与限制

发布范围：Tanva 前端/后端、TapCanvas Agents Bridge、Hono API 及使用同一 API 镜像的 continuation/workflow workers。只发布 Tanva 无法修复 admission 与根终态。历史 failed 记录未重置，避免重放已有动作；本次上述服务已完成定向发布。

另有 knowledge_search embedding 401（key 未激活），本次未变更凭据，需配置方恢复有效检索凭据。

AI metadata 同步脚本 /Users/libiqiang/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs 缺失，知识库已手工同步。

已执行上游 `graphify update .`；扫描完成，但工具因新图节点数 69882 少于既有 70655 拒绝覆盖。未使用 force 覆盖共享图谱，图谱更新不算通过。

## 101 定向发布与最终验证（本轮）

- 线上基础版本经镜像内容指纹核实为 TapCanvas `da212ae18`，未直接打包上游其他未提交工作。
- Hono/API 与三个关联 worker：`tapcanvas-local/api:host-handoff-20260908-v3`。
- 两个 Agent Bridge 副本：`tapcanvas-local/agents-bridge:host-handoff-20260908-v4`；LB 已重建以刷新地址解析。
- Tanva 前后端已更新并重启 tanvas-api；旧前端散列资源保留，index 最后切换。服务端产物 SHA-256 与本地一致。
- 发布目录及受限权限配置备份：`/opt/tapcanvas/releases/host-handoff-20260908`。重建、回退和定向源码补丁见 `backend/patches/2026-09-08-xiaot-host-handoff/README.md`。
- 本轮 Hono 六文件 78 项通过，包括“登记→公开 response 投影→OpenAI 是否继续等待”的真实函数路径。AgentRunner 四项通过，包含生产远程 envelope；Tanva replay-handoff、context-handoff、host-handoff、delivery、recovery 通过。
- 前后端构建通过；Hono gate 仍有 111 项基线类型错误。本轮没有声称全量 lint 已通过。
- 初次真实冒烟发现生产 envelope 与登记/公开 schema 三个测试遗漏，逐一修复后重跑；不能把前几轮失败当验收通过。诊断首轮残留任务已按精确 session/turn 中断，无用户画布变更。

- 在交接修复后的真实续接中再次定位 `intent_contract_review_structure_invalid` 重复意图审批循环。最终补入已提交 `7a577a9a3` 的七文件意图接入/持久状态/恢复修复；不包含该提交的知识、工作流等其他改动，不移除最终交付校验。最终定向 Bridge 55 项回归与 TypeScript 编译通过。

- 最终回答的 evidence catalog 现在携带原始调用输入（包括宿主查询结果），标记为 caller_input/source，解决作者已拿到真实值而 verifier 丢失来源后反复要求再读的问题。校验仍必须依据正文与真实执行/资产证据，输入 URL 不会自动升级为生成资产。相关 30 项回归通过；扩展 failed-receipts 文件有 1 项基线失败，已在 da212ae18 原文件复现。

### 通过的线上验收

均使用实际生产 Tanva NEW_API_BASE_URL/凭据、实际 DeepSeek V4 Flash 与全部修复后的 Hono/Bridge；只将 Tanva CreditsService 换成计数桩，画布为内存夹具，不修改真实用户项目。

| 场景 | Session | 实际结果 | 耗时 |
| --- | --- | --- | --- |
| 查询后回答 | handoff-smoke-1788846531520 | 首轮摘要不含随机正文；query_canvas 返回后自动续接，最终回答包含正确随机值，done 结束 | 48.293s |
| 查询后下发写入 | handoff-patch-smoke-1788846533099 | 查询后自动续接，下发一个 copy-note/textPrompt addNode，text 与查得的随机值完全相同，done 结束 | 21.255s |

两次均为 2 次请求（原始请求 + 查询结果续接），1 次上下文交接、1 次结算调用。首轮查询回执分别在 8.395s / 8.365s 返回。没有重复提交原始创作请求。上述结果证明真实网关/模型与 Tanva service 之间的交接和结束逻辑；不代表已在用户浏览器操作画布或视频供应商已产出视频。

成功日志：101 发布目录 smoke-query-v4.log、smoke-patch-v4.log。所有更新容器 healthy，tanvas-api online；tanvas.cn/app HTTP 200。旧失败任务未重置；新前端需刷新现有页面加载。
