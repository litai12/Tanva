# 小T断流后无主挂起：本地修复与验证

状态：**本地修复包已验证，未部署；由用户自行发布。**

## 101 日志证据

- 时间：2026-09-07 15:36:45（UTC+8）。
- Tanva run：`0fb1bc54-972b-4f74-8bec-8493c40f46ba`。
- 小T request：`6ba61775-08f2-4886-836d-cce1ad5e751b`。
- Agents Bridge 对 `gpt-5.6-luna` 的两次 Responses 请求均记录 `terminalState=missing / providerCode=provider_terminal_missing`。
- 随后上游报 `async_continuation_owner_missing`，details 为 `registrationStatus=not_required / reason=async_continuation_not_required`。
- 该请求在失败前未发生工具调用，没有已受理视频任务。模型断流是触发条件；把它归入外部证据等待且没有执行 owner，是此处系统错误的原因。

## 源码改动与归属

根因在 TapCanvas 上游，不在 Tanva 的报错展示层。`upstream.patch` 仅包含两个源码改动：

1. `apps/agents-cli/src/core/agent-loop.ts`：同模型连续断流的有界重试耗尽后，completion disposition 从 `waiting_for_evidence` 改为 `replan_required`，使任务进入已有 durable resume 路径。保留原始错误码、半截响应隔离与已受理工具动作不重放约束。
2. `apps/hono-api/src/modules/task/public-agents-chat.ts`：`readRootPhysicalContinuationSuspension` 优先读取有效的 `runtime.suspension`。检查点存在时，以实际 `physicalRunId/progressRevision` 通过恢复身份校验；不能先拿逻辑 ticketId 代替物理实例 ID。无有效 suspension 时保持原有合法 ticket 路径。

检查时，本机 `/Users/libiqiang/workspace/TapCanvas-pro` 已有上述两处源码修改；本次保留其已有工作，提取最小补丁并增加独立回归，没有复制该目录的其他未提交改动。若从该目录发布，应确认这些修改包含在构建中，不要重复应用补丁。若从匹配线上版本的旧源码发布，可先 dry-run `upstream.patch`，再纳入两处改动。

Tanva 仍将真实的 `async_continuation_owner_missing` 视为失败；没有通过忽略 error、伪造成功、切换模型或重新提交原始请求来掩盖问题。

## 本地验证

1. 将 101 当前 Agents Bridge 的编译产物复制到本地临时目录，替换 LLM client 为固定抛出 `provider_terminal_missing` 的 mock。
2. 旧产物的 Luna / DeepSeek 两个回归均失败，实际 disposition 为 `waiting_for_evidence`。
3. 仅应用对应运行时补丁后，两个回归均通过：恰好调用两次、归入 `replan_required`、保留两次断流诊断、不泄露半截正文。
4. 本地 `TapCanvas-pro` 已编译 Agents Runtime 同样通过这两个回归。
5. 直接对本地 Hono 源码中的真实 suspension reader 转译执行，6 个身份选择断言通过；对线上 API 编译产物的本地补丁副本，7 个断言通过。
6. 源码补丁在原源码快照上 dry-run 成功。
7. Tanva 的 `test:xiaot-agent-delivery`、`test:xiaot-agent-host-handoff`、`test:xiaot-agent-recovery` 全部通过，`git diff --check` 通过。

仓库约定的 AI metadata 同步脚本 `/Users/libiqiang/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs` 本机不存在，索引同步未执行成功；本次知识库与 CHANGELOG 已手工同步。

本地复跑（仓库根目录）：

```sh
AGENTS_RUNTIME_DIR=/Users/libiqiang/workspace/TapCanvas-pro/apps/agents-cli \
AGENTS_TEST_DISABLE_INPUT_GATE=true NODE_ENV=test \
node --test backend/patches/2026-09-07-xiaot-continuation/agent-regression.mjs

node backend/patches/2026-09-07-xiaot-continuation/source-regression.mjs \
  /Users/libiqiang/workspace/TapCanvas-pro

cd backend
npm run test:xiaot-agent-delivery
npm run test:xiaot-agent-host-handoff
npm run test:xiaot-agent-recovery
```

这些是断流与恢复身份的回归，不是视频生成端到端验收；没有调用付费模型或提交真实媒体任务。

## 发布范围与备用构建

正常源码发布需同步更新 **Agents Bridge、Hono API、agent-api-worker、workflow-runtime-worker**。只发布 Tanva 前后端不能改变上游执行状态；只更新其中一半会留下恢复身份问题。

本目录另含对特定线上镜像的最小派生构建文件，供发布人选择，不会自动执行部署：

- Agents 基线：`beqlee/tapcanvas-agents-bridge:src-f4d932fa65b6569b237ec52a`。
- Hono 基线：`beqlee/tapcanvas-api:src-90892740069ff9656ae23f35`。
- `patch-runtime.mjs`：只修改已识别的状态分支和恢复读取函数；匹配数量不对或重复应用时失败。源文件全部验证后才写输出。
- `Dockerfile.agent` / `Dockerfile.api`：由以上基线构建，不纳入本机其他功能改动；API 同时更新五个打包入口，并检查语法。
- `compose.hotfix.yml`：仅覆盖四个相关服务的镜像。发布时必须与原 production compose 及其正式环境参数一起使用，不能单独运行；发布前应检查合并配置，不能依赖未经验证的默认镜像或环境值。

用户要求仅本地修改前，101 已构建 `tanva-hotfix/agents-bridge:20260907-continuation` 与 `tanva-hotfix/api:20260907-continuation` 备用镜像，并在禁网、无生产环境与数据卷的临时容器中通过 2 个 Agent 回归及五个 Hono 入口各 7 个断言。**没有切换或重启任何线上服务，没有修改生产 compose 或环境文件。** 备用文件位于 `/opt/tapcanvas/hotfixes/2026-09-07-xiaot-continuation/`；用户明确要求后停止了上线操作，最终本地测试与说明以本仓库为准。
