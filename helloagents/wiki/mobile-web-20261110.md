# 移动端网页 `/m`：对话 + 一键成片 / 一键复刻（2026-11-11 已部署 101，待真实对话 / 成片验收）

设计见 `helloagents/plan/202611101200_mobile_chat_web/proposal.md`。

## 链路

- **对话**：`MobileChatService` 复用 `XiaotAgentService.run()`（new-api → TapCanvas `/public/v1/chat/completions`，按轮走网关签名订单，与小T同一计费）。manifest `host=tanva-mobile`，用 v1.3 `hostTools` 声明 `tanva_make_video` / `tanva_remake_video`；`generationMode` 默认 host，TapCanvas 不生成媒体。`buildCapabilityManifestSummary` 对 `tanva-mobile` 只保留自带 notes，不注入画布查询说明。
- **成片**：模型回传 `host_tool` 后，后端以当前用户调用 `VideoProductionService.create`（film / remake，Seedance 2.0、720P、成片默认 9:16，复刻跟随原片），个人钱包；报价、预扣、结算、退款都在 video-productions 内闭环。
- **安全**：工具参数中的 URL 必须是本会话用户附件或正文里出现过的地址；附件只收 http(s) 远程地址，拒绝 `data:` / `blob:`。每人同时最多 2 个运行中的成片任务；同一会话一次只跑一个回合。
- **持久化**：`MobileConversation` / `MobileMessage`（迁移 `202611100001_mobile_chat`，仅新增表）。消息 `kind=text|job|error`，job 消息带 `jobId`。上游会话 key `mobile:<conversationId>`；每轮在 prompt 里附上本会话任务的真实状态。
- **SSE**：`POST /api/mobile-chat/conversations/:id/messages` 返回 `accepted / status / message / final / done`。客户端断开后服务端照常跑完并落库；前端发现 `streaming` 消息时每 3 秒同步一次。启动时把遗留的 `streaming` 消息标为中断（单实例 fork 部署）。
- **限制**：小T上游只在回合结束时给出完整文本，没有逐字流式，前端显示「思考中…」。抖音、小红书分享链接暂不支持，需要上传视频文件或给出直链。

## 前端

`frontend/src/pages/mobile/`（`MobileApp` 路由与鉴权、`MobileLogin` 短信登录、`MobileDrawer`、`MobileChat`、`JobCard`、`TanvasMark`），`services/mobileChatApi.ts`。`/m/*` 懒加载，不打包画布；`/m` 下不触发项目列表加载。品牌使用统一的 `Logo.svg`（标）和 `tanvas_ai.png`（深色文字标）。

## 验证

- `cd backend && npm run test:mobile-chat && npm run build`；小T `xiaot-host-context` / `agent-host-context` / context-handoff / host-handoff 回归通过。
- `cd frontend && npm run build`：`/m` 独立分包 30.7KB（gzip 10.3KB）；新增文件 tsc 与 eslint 均无报错（`main.tsx` 的 react-refresh 告警原本就有）。
- bsk iPhone 14 仿真加本地 mock 接口（只测 UI，不连库、不调模型）：登录、主页、抽屉、会话与已完成卡片都已检查；发送流程的自测被用户中止，尚未补测。**真实 TapCanvas 对话与真实成片尚未端到端验收。**

## 2026-11-11 补充：流式、并发、过程视图

- **流式**：`XiaotAgentService.run()` 新增可选 `textStream`（delta / reset），画布不传则行为不变；断线续接 / 挂起回放时 reset。`TextPump` 每 60ms 合并下发 SSE `delta`（不能接续时发整段 `text`），每 2 秒把阶段正文落库；续接占位语“任务仍在处理中…”及其逐字前缀不下发。前端打字机按帧追赶（积压越多越快），流式结束后打完再收光标；无正文时显示“思考中”状态行 + 走秒 + 轮换提示。
- **并发与限流**（单实例 fork，进程内计数）：全站同时回合 `MOBILE_CHAT_MAX_CONCURRENT`=40、单用户同时 `MOBILE_CHAT_USER_CONCURRENCY`=2、单用户每分钟 `MOBILE_CHAT_RATE_PER_MIN`=20，超出返回 429；同会话一次一个回合；单用户在跑成片 2 个、全站 `MOBILE_MAX_ACTIVE_PRODUCTIONS`=30。任务卡轮询 5s → 10s（3 分钟后）→ 20s（15 分钟后），后台标签再 ×3。
- **计费**：回合开始前余额须 ≥ `MOBILE_CHAT_MIN_CREDITS`（10），否则 402 且不进上游。101 的 `TANVA_CONSUMPTION_SCOPE=desktop`，网页小T不走网关实扣，按完成回合固定 2 积分（与网页小T一致）；成片 / 复刻沿用 video-productions 原报价、预扣、结算。
- **过程视图**：`GET /api/video-productions/:id` 规划阶段附 `planProgress`（本地已落库的 TapCanvas 节点进度），`storyboard[]` / `images[]` 增加 `key`（向后兼容）。任务卡展示 规划 → 参考图（缩略图，点开大图）→ 分镜视频（提示词、单段预览、失败段“重试此段”）→ 合成，进行中默认展开。

## 101 发布记录（2026-11-11 13:22–13:25 CST）

- 发布目录 `/opt/tanva-releases/mobile-web-20261111/`，备份 `/opt/tanva-backups/mobile-web-20261111/`（5 个被替换的后端文件、旧 schema、前端 dist）。每步前暂停图片队列并等 active=0、近 30 分钟未结网关请求=0，结束后恢复。
- 第一次运行：迁移 `202611100001_mobile_chat` 成功；`prisma generate` 写入的是 pnpm 实际路径 `node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client`（脚本误以为是 `node_modules/.prisma/client`，后者是 8 月的旧副本、未被使用），校验失败后按脚本停止，后端/前端未动，进程无影响。新客户端是旧模型的超集。随后修正了生成文件属主与权限（root/600 → www/644，与原来一致）。
- 续跑 `deploy-resume.py`：10 个后端文件（5 改 5 新）替换后 `pm2 reload tanvas-api`，`/api/health` 200、`/api/mobile-chat/conversations` 未登录 401；前端 49 文件，入口最后切换，`version.json` commitSha `f3db845b+mob`，`/m` 200。启动日志 `MobileChatModule` 6 条路由已映射。
- 服务器 checkout 新增了未提交的 `backend/prisma/migrations/202611100001_mobile_chat/` 与改过的 `schema.prisma`；本地改动提交推送后再同步，即可恢复干净。
