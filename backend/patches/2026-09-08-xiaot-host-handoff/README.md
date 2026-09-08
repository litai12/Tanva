# 101 小T宿主交接定向修复（2026-09-08）

基于已部署的 TapCanvas `da212ae18`；不是打包当前上游工作树。

- API 基础镜像：`beqlee/tapcanvas-api:src-e4fb787a47c64e33e82bd74e`。
- Bridge 基础镜像：`beqlee/tapcanvas-agents-bridge:src-0cb06627afaa763d2ed7273c`。
- API 修复镜像：`tapcanvas-local/api:host-handoff-20260908-v3`。
- Bridge 修复镜像：`tapcanvas-local/agents-bridge:host-handoff-20260908-v4`。
- 101 发布包、原文件备份、Dockerfile 与构建产物：`/opt/tapcanvas/releases/host-handoff-20260908`。

## 重建

1. 从上游 `da212ae18` 导出干净快照，应用 `hono-scoped.patch`。该补丁来自已提交 `5c3dff5d6` 的七个原有修复文件，只含预算、宿主身份和交接改动，不含同提交的其他工作流改动；另修复 public-agents-chat.ts 的 waiting_external 交接登记条件及 apiKey.schemas.ts 对零 runNode 交接的公开返回校验。
2. 使用该快照对应依赖运行 Hono `node scripts/build.mjs`，在原 API 镜像上 `COPY dist/ /app/dist/`，不改依赖和数据库结构。
3. 宿主交接首层复现：从原 Bridge 镜像提取 `/opt/agents-cli/dist/core/agent-loop.js`，应用 `agent-loop-runtime.patch`，在同一基础镜像中覆盖该文件并运行 `node --check`。源码修复对应 `5c3dff5d6` 的 host callback yield / addNode 不冒充完成逻辑，另补充真实远程回执 `AgentsToolExecuteResponse.data` 的解包。
4. 最终 Bridge 版本从同一 da212ae18 源码快照先应用 `agent-loop-source.patch`，再应用 `intent-authoring.patch` 与 `caller-context-evidence.patch`。后者只选取已提交 `7a577a9a3` 的七个意图接入/持久化/恢复文件，移除重复模型意图审批，不改最终交付验证。执行 TypeScript 编译，原 Bridge 镜像只覆盖 `core/agent-loop.js`、`core/tools/user-intent.js`、`core/durable-session-state.js`、`core/memory/pg-session.js`、`server/http-server.js`、`core/tool-surface.js`、`core/root-persona.js`、`core/delivery/candidate-review.js`。最后一项把已经提供给作者的调用方输入纳入只读 source，避免宿主查询结果不进入最终校验目录；不增加任何写入或真实资产完成权限。最终 Dockerfile 与产物在 101 发布目录 `bridge-v4/`；前述单文件 runtime patch 仅保留排障审计用途。
5. Tanva 使用当前仓库构建，前端先上传散列资源、最后切换 index；后端覆盖 agent service/recovery 编译产物。

API 构建 gate 放行了 111 项基线类型错误；这不是零类型错误构建。两份定向镜像已通过 Node 语法检查。

## 发布与回退

使用生产 compose 仅更新 `api`、`agent-api-worker`、`workflow-runtime-worker`、`credit-finalizer-worker` 和两个 `agents-bridge` 副本；Bridge 重建后同步刷新 LB 的地址解析。使用 `--no-deps --pull never`，不跑 migration/init，不重置历史失败任务。

`.env` 中仅持久化上述两个镜像选择，原 `.env` 以 600 权限备份在发布目录 `compose.env.before`。回退时只把两个镜像变量改回原镜像，按同样服务范围重建；Tanva 原文件在 `backup/tanva-before.tar.gz`。不要将可能包含后续配置更新的整份 `.env` 直接覆盖。

## 验证

`smoke-query.cjs` 只在 101 发布目录手动运行。它使用生产 Tanva Gateway 和模型、隔离宿主会话及内存画布；随机节点正文不进入首轮摘要，必须经过真实 query_canvas 和 host_tool_results 续接才能答对。结算接口是计数桩，不改变 Tanva 用户余额；上游模型调用仍是真实调用。此测试不等同于浏览器交互或视频供应商出片验收。

详细验证记录见 `helloagents/wiki/xiaot-host-handoff-20260908.md`。

最终定向 Bridge 快照 TypeScript 编译通过；意图接入、持久状态及 PG 恢复 47 项、宿主交接/HTTP 终态/新回合隔离 8 项回归通过。`smoke-patch.cjs` 在隔离内存画布中验证“查询隐含节点正文→下发包含该值的 addNode”，不真正写用户项目。

最终校验证据相关定向测试 30 项通过。扩展跑原有 failed-receipts 文件时有 1 项既有 succeeded-receipt 断言失败；已用 da212ae18 原文件独立复现同一失败，未将其计为通过。
