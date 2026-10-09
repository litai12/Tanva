# 图片任务重跑、恢复与失败耗时（2026-10-09）

## 问题与原因

GPT-Image-2 节点点击 Run 后可能显示「已有生成请求，请查看原任务；本次未重复扣费或生成」。该文案来自图片 Worker 的重复预扣分支。

图片任务已经失败时，关联用量仍可能处于 pending 等待后续结算。原同节点防重仅检查用量状态，不检查 ImageTask 的真实状态，导致旧任务阻止新任务，甚至在旧账不自动结算时长期阻止重跑。此外，GPT 图片节点未传 projectId，同名节点可能共用 legacy-image 作用域。

用户另反馈消费记录耗时为 `-`、节点一直「处理中」。代码存在三个独立缺口：恢复任务首次查询失败后直接退出，但 taskId 已标记恢复，导致后续不再查询；部分 Worker 失败分支缺少终态广播、待核账分支漏记耗时；孤儿清理只批量改 status，未补 completedAt、耗时和协作广播。流水又仅展示计费状态，无法区分图片已经失败但计费尚待核账。

## 修复合同

- 图片同节点 pending 防重排除关联到同用户、明确处于 failed / cancelled / succeeded 终态的 ImageTask；继续检查其他候选，不能因最新记录已终态就漏过更早的在途任务。
- queued / processing、未知状态、找不到任务或缺少 taskId 的用量仍保留防重。该判断不按年龄放行，不修改原用量、积分或退款状态。
- 每次新任务仍使用独立 taskId；相同幂等键、Worker 原子抢占及前端连点锁继续防止重复生成和扣费。
- GPT 图片请求携带当前 projectId，按项目隔离节点防重并支持任务状态广播。旧版 `legacy-image` 作用域仍兼容识别，未知或在途旧任务不会因补传项目标识被绕过。
- 刷新恢复已知图片任务时，首查网络/服务端失败继续进入原 taskId 的只读轮询；只有真实终态或既有连续 404 规则结束恢复，不重新提交生成。
- Worker 的重复预扣、预扣失败及待核账失败分支均通知终态；待核账失败立即记录实际尝试耗时，附加账本信息写入失败不阻断节点收尾。
- 图片孤儿清理沿用既有阈值，按扫描时的 status + updatedAt 条件更新，避免覆盖并发完成的任务。补 completedAt、终态广播与缺失耗时，不在清理中退款或改用量状态。
- 流水接口附加同用户 ImageTask 的 generationStatus / generationError，保留 apiResponseStatus 表示原计费状态。历史终态有可信完成时间时只读补算耗时；缺失时间不伪造。管理员表格分别展示生成状态、待核账和耗时。
- 延迟结算优先保留已记录的生成耗时，避免把等待退款的时间当作生成耗时。原退款范围、截止点与幂等边界不变。

## 验证与发布边界

验证终态旧记录可重跑、更早的在途任务仍防重、跨用户与未知任务不误放行、相同幂等键不重复扣费，以及前端项目身份与连点锁。使用模拟计费和供应商，不发起真实付费生成。此次修复不自动重跑用户节点，不手动处理历史账目；前后端已按下述记录发布。

- 后端定向回归：`cd backend && npx ts-node --transpile-only src/credits/image-node-rerun.spec.ts`。
- 耗时与只读历史回归：`cd backend && npx ts-node --transpile-only src/credits/image-usage-duration.spec.ts`。
- 孤儿清理回归：`cd backend && npx ts-node --transpile-only src/ai/services/generation-task-reconciliation.spec.ts`。
- 终态计费回归：`cd backend && npx ts-node --transpile-only scripts/verify-image-terminal-billing.ts` 及 `scripts/verify-video-terminal-billing.ts`。
- 前端提交回归：`cd frontend && npm run test:flow-image-submission`。
- 前端状态展示回归：`cd frontend && node --test src/utils/creditGenerationStatus.test.ts`。与提交/恢复回归共 12 条通过。
- 后端上述回归、前后端完整构建通过。全量前端 lint 有既有错误；FlowOverlay 的 HEAD 与修改版均为 674 个错误、19 个警告，规则和消息签名一致，无新增；其余改动 UI/测试/格式化文件的定向 lint 通过。
- 仓库约定的 AI Metadata 同步脚本 `/Users/libiqiang/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs` 在本机不存在，无法执行该附加同步。

## 101 部署（用户授权）

- 2026-10-09 17:35（UTC+8），修复提交 `8ef3433f` 已推送 main；101 的 `/www/wwwroot/tanvas.cn` 执行 `git pull --ff-only origin main` 并确认该版本。
- 服务器前后端构建成功，重跑节点计费、耗时/历史与孤儿清理三组回归通过。构建先输出到独立目录，再切换产物；旧前端散列资源保留，index 最后原子替换。
- 备份及新产物目录：`/opt/tanva-backups/image-node-rerun-8ef3433f-20261009/`。重载前图片队列 active=0、paused=false；执行 `pm2 reload tanvas-api`、`pm2 save`，未暂停队列。重载后进程 online，队列 paused=false，并开始处理新的正常请求。
- 本机及公网 `/api/health` 返回 200 / ok，公网 `/app` 和新主脚本 `/assets/index-EFEQQoTP.js` 返回 200。公网 index 与脚本 SHA-256 均与服务器发布文件一致，编译产物包含本次前后端修复。
- 无数据库迁移、无 new-api 重建；未发起付费验收、未重跑用户节点。现有页面需刷新加载新前端。
