# 小T本地端到端验证 · 2026-09-08

本次按用户“本地先验证跑通，可从 101 同步 new-api 缺失数据”的要求进行，新增修复未部署到 101。

## 环境

- 页面 http://localhost:5173；Nest 后端 http://localhost:4000；本机 Colima new-api http://localhost:4458。
- 本地 new-api PostgreSQL 在 5433。新增独立应用库 `tanva_local_ai_20260908`，与网关库分开，按当前 Prisma schema 初始化，创建隔离测试账号与项目。
- 原 backend/.env 指向 101 的旧 `tanvas_test`，缺少新版字段。改接独立本地库；未对共享测试库应用迁移。旧配置和网关路由备份保存在受限目录 `/tmp/tanva-local-ai-20260908/`。密钥不进入文档或版本库。
- 本地小T渠道仍使用 101 已部署的 TapCanvas Pro（`https://tc.tanvas.cn/public`）；本次不是全套 Pro 离线部署。媒体使用现有 OSS，测试资源采用隔离账号/项目路径。
- 本地测试项目：`c2953145-b03b-4170-b96f-58d481aae6b3`。

## 数据同步与修复

- 101 `ark-deepseek` 36 → 本地同名 32；101 `xiaot-agent` 43 → 本地新增 39；同步对应 abilities 与模型计价项，保留本地用户、令牌、余额及历史。
- 普通模型稳定别名在 101 原渠道中同样不存在，新增本地幂等 SQL `new-api/patches/2026-09-08/001-add-deepseek-v4-flash-alias.sql`，复用 ARK 已配置能力和计价，未改为小T facade。
- 页面复现连续查询空结果：首轮前端过滤了未选中节点，后端按这份片段回答所有后续 query_canvas。改为浏览器显式按范围回传，保留首次最小披露；进一步修复实际查询误读侧栏 80 字预览。
- 新增 POST 回传的所有权、queryId、大小、过期和消费校验。旧 API 调用方未声明浏览器查询时仍使用其提交的上下文；不隐式读取其他项目。
- 修复最终执行状态与进度占位文字；补齐 Wan3.0 能力登记和媒体节点校验。
- 真实视频首次成功受理，但聊天原先 5 秒后误判失败。宿主现在等待异步节点真实终态，不重投正在运行的节点、不接受其历史 URL。

## 已验证证据

| 场景 | 结果 |
| --- | --- |
| 普通文字网关 | `deepseek-v4-flash` HTTP 200，返回 `LOCAL_TEXT_OK` |
| Service 真实查询续接 | `handoff-smoke-1788847130828`，60.138 秒，2 次请求，随机 CANARY 正确，1 次结算 |
| Service 真实查询后写入 | `handoff-patch-smoke-1788847170558`，25.237 秒，正确 addNode，1 次结算 |
| 页面新建节点 | 真实出现 `LOCAL_CANVAS_0908`，自动保存 |
| 页面查询→复制 | run `38ac2cad-6643-4f1f-9bae-97b79eb1abd9`，summary→ids 两次浏览器回传，出现 `LOCAL_CANVAS_0908_COPY`，执行过程完成；06:09:37Z→06:10:49Z |
| 首个真实视频 | `task_ZNqX02jIca9REsPwHPE8FvugauTSFHu8`，网关 SUCCESS/100%，浏览器 video readyState=4、5.038005 秒、832×480；提示词→Wan3.0 节点→供应商→OSS 链路通过。该次聊天在等待修复前曾误报失败，不能作为新等待逻辑的验收 |
| 最终完整视频验收 | run `7286b509-c964-48af-9313-8bbb9ebe2782`；视频 `task_nmw2JyKiVjfbrzc4A2Yj3jct0adZR4g1`，SUCCESS/100%。生成期间已有旧 videoUrl，但聊天持续等待；新结果回填后显示“已生成1 个视频并添加到画布。”，执行过程已完成、发送按钮恢复。浏览器新 video readyState=4、5.038005 秒、832×480，历史记录增至 2 条。该验收只提交 1 次生成，未重复投递 |

日志和敏感环境备份分开于同一受限临时目录，勿将其中凭据文件提交。最终视频已在本地页面验收完成。

最终视频：https://tanvas-ai.tos-cn-guangzhou.volces.com/ai/videos/doubao/new-api-task_nmw2JyKiVjfbrzc4A2Yj3jct0adZR4g1-1788848584635.mp4

前后端保持运行；本地页面使用隔离账号登录。首个提交为 14:15:21，最终验收提交为 14:20:47，两段测试合计仅两次视频生成；最终结果在 14:23 左右回填。每轮成功小T对话结算 2 积分，视频各 225 积分，均在独立测试账号。

## 回归

- 后端构建通过；前端构建通过（常规大包提示）。新增宿主回传归属/限长/单次消费测试通过。
- 原 context-handoff、replay-handoff、host-handoff 通过。
- 前端最小披露/未选节点按需查询/超过侧栏预览长度/范围限制/Wan3 能力/终态文字共 8 项通过。
- 节点交付测试共 5 项通过，包含异步超过 5 秒仍等待、排除运行中旧资产、真实失败、期限超时。
- 最终合并运行四个前端文件（含聊天视频委托回归）共 16 项通过；最终前端构建成功，git diff --check 通过。
- 未声称全库 lint 清零；既有基线问题见此前修复记录。
