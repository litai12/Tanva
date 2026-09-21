# 小 Tai 对话临时回退（2026-09-21）

用户要求退回接入 xiaotagent 之前的对话链路，暂时禁用该接入。

- 前端 `services/xiaotChatModels.ts` 的 `XIAOT_AGENT_ENABLED=false` 统一控制入口。纯文字、手动生成和 Auto 命中生图恢复已有工具选择、`executeProcessFlow`、文字及图片服务；旧版多图数量设置继续生效。
- Beta 按钮隐藏，setter 与持久化 merge 都强制关闭 xiaotMode，历史会话仍保留。
- `runXiaotAgent` 在创建网络请求前返回本地停用提示。聊天视频复用已有消息、结束等待状态，提示使用画布视频节点；不恢复旧聊天视频直调与计费路径。
- 后端 `AgentRuntimeService.createRun` 默认拒绝 canvasAgent（503），在分配 run 和调用上游之前结束。普通 research / intent 流程保留。分镜脚本转换等其他 canvasAgent 消费方也会收到停用提示。
- 后续恢复需同时修改前端开关，并设置后端 `XIAOT_AGENT_ENABLED=true` 后重启；当前改动需要前后端共同发布，未部署。

## 验证

- 后端 `npm run build` 与 `npm run test:agent-host-context` 通过（包含默认/显式关闭时拒绝请求，以及开启后原宿主上下文流程）。
- 前端 `node --test src/services/chatVideoCanvas.test.ts`：5 项通过，覆盖旧版文字/生图执行、视频引用与停用提示及占位消息收尾。
- `git diff --check` 通过。
- 首次前端构建失败的直接原因是本次新增 import 被放在既有 `// @ts-nocheck` 前，导致指令失效，暴露 12 处历史类型错误；此前归因为“与改动无关”不准确。后续修复恢复指令首行位置与原编译行为，并将视频下载 URL 移至 try/catch 共同可见的作用域，修复失败兜底中的真实引用错误。
- 前端 `npm run lint` 未通过：全仓 2562 errors / 200 warnings，包含临时文件解析及大量 any 等问题；日志位于 `/tmp/tanva-legacy-chat-lint.log`。未进行无关修复。

- 构建修复后重新运行前端 `npm run build` 成功（TypeScript + Vite），仅保留打包体积等警告；日志 `/tmp/tanva-chat-build-fix.log`。
