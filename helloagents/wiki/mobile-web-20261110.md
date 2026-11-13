# 移动端网页 `/m`：对话 + 一键成片 / 一键复刻（2026-11-11 已部署 101，待真实对话 / 成片验收）

设计见 `helloagents/plan/202611101200_mobile_chat_web/proposal.md`。

## 2026-11-13 我的作品媒体网格（本地，未部署）

- `MobileWorks.tsx` 独立展示作品网格，手机每行 2 张，屏宽达到 768px 后每行 4 张。图片和视频统一使用 3:4 封面区域，长图封面从顶部显示，点击图片可全屏查看，视频保留原生播放控件。
- `services/mobileWorks.ts` 合并现有视频列表与会话中的助手生图、详情页消息，按创建时间倒序展示。详情页已有 `longImageUrl` 时展示整张长图，未拼接时按顺序展示各屏，兼容历史消息。
- 复用现有鉴权 API，读取会话时并发最多 4 个。部分来源失败时保留成功结果并提供重试；空结果提示创作图片或视频。图片任务沿用既有轮询，展示生成中和失败状态。
- 验证通过 TypeScript、生产构建、修改文件 ESLint，以及 Chrome 320/390/430/767/768/820/1024/1366px 两列和四列布局、横向溢出、图片放大和关闭、长图查看、视频播放、历史图片与详情页汇总、排序、请求并发、空数据和部分失败检查。接口使用模拟数据，视频使用浏览器生成的测试媒体，尚未真机与线上数据验收。

## 2026-11-13 对话框粘贴附件（本地，未部署）

- `MobileChat.tsx` 输入框接入粘贴事件，读取剪贴板文件，并兼容仅通过 `items` 提供图片的浏览器；优先读取 `files`，避免重复添加。
- 粘贴图片、截图与视频复用加号入口的附件预览、OSS 上传、移除和发送流程，沿用最多 9 个附件、图片 30MB、视频 200MB 的限制。其他文件类型显示现有提示。
- 普通文字及混合剪贴板中的文字使用输入框原生粘贴，保留选区替换行为。预览使用 objectURL，发送使用上传后的远程地址。
- 验证通过 TypeScript、Vite 生产构建和修改文件 ESLint。Chrome 浏览器验证真实系统剪贴板图片粘贴、多文件、视频、`items` 回退、混合文字事件、类型和图片大小限制、数量限制、移除、原生文字选区替换，以及附件远程地址发送。上传和对话使用模拟服务，真机与真实 OSS 尚未验收。
- 全量 ESLint 存在 2550 个错误和 197 个警告，修改文件检查通过。

## 2026-11-12 输入框视觉调整（本地，未部署）

- 首页问候语使用无衬线字体，与移动端界面文字统一。
- 首页欢迎区使用用户提供的纯白 SVG 品牌标，搭配 Bold 无衬线问候语和 Medium 提示文字；提示轮播时整句居中，欢迎提示以“今天想 …？”为句式，每 3 秒轮流显示涵盖视频、图像、文案和品牌视觉等场景的 12 条提示，切换使用淡入动效，遵循减少动态效果设置。
- 侧边栏在品牌栏下方显示全宽「新建会话」按钮，导航仅保留「我的作品」与最近对话；底部保留账号入口，搜索和会话管理不变。主页输入框上方的快捷入口仍可使用。
- 参考用户提供的视频：页面黑底，输入框为 `#1B1D1B` 炭灰胶囊与细灰边框，左侧白色加号，右侧白底上箭头圆按钮。
- 修改 `MobileChat.tsx` 与 `MobileApp.tsx`；输入框继续停靠移动端底部，保留附件、快捷入口、多行自适应、发送/上传状态、键盘视口与安全区逻辑。空内容发送按钮仍禁用。
- 输入框单行高 64px，操作触摸区 44px，文字 16px；窄屏输入可收缩，长文本最多 132px 后内部滚动。焦点具有边框和按钮描边反馈。
- 输入超过单行时，文本扩展到输入框上方的整行，添加与发送按钮移到下方两端；删除文字回到单行后恢复胶囊排列，窗口宽度变化时重新判断。
- 验证：全量 TypeScript 检查、Vite 生产构建与两个修改文件的 ESLint 通过；Chrome 移动端模拟 320/390/430/768px 无横向溢出，空内容禁用和长文本滚动正常，无页面运行错误。布局检查使用 mock 接口，未调用真实对话或媒体生成服务。
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

## 2026-11-11 复刻穿帮根因与修复、移动端生图

线上首个真实复刻（20 秒竖屏停车设备视频，用户附车图要求“用图中车替换”）成片有穿帮、车辆未替换。逐项核对任务数据后的根因（TapCanvas 的视频理解不是主因：规划正确复述了 GiAnD 标识、卷帘门、两台车等细节，且 TapCanvas 原生复刻与工作流共用同一份 `REFERENCE_VIDEO_ANALYSIS_PROMPT` 5fps 拆解）：

1. **用户附图丢失**：模型调用 `tanva_remake_video` 时漏传 `referenceImageUrls`，规划没拿到新车，照搬原片的 G 级 / 库里南。修复：本条消息的图片（及唯一视频）由宿主确定性并入工具参数，不依赖模型转述。
2. **视频模型被降级**：TapCanvas 规划按 Seedance 2.5（`suanli-sd2.5`）写的提示词与参考图，移动端却强制 `seedance-2.0`。修复：不再指定 `videoModel`，沿用规划模型（Seedance 2.5 刊例为 2.0 的 1.5 倍）。
3. **画幅错**：原片 720×1200 竖屏，未指定画幅时规划缺省 16:9，重新构图。修复：复刻未指定画幅时 ffprobe 原片（含旋转元数据）取最接近的画幅，写入规划要求与生成参数。
4. **单段镜头过密**：`remakeClipPlan` 原取“段数最少”，20 秒被拆 2×10 秒、每段 4–5 个镜头，且同一段绑定互斥的状态卡（卷帘门闭合/升起、托盘空/承车），Seedance 在一段内混淆状态。修复：在总长误差 ≤1 秒的方案里取段长最接近 6 秒的（20 秒 → 3×7，17 秒 → 3×6），段数上限 12，超出回落原策略；按秒计费，总价不变。**画布「爆款复刻」节点共用此函数，同步生效。**
5. 未改：规划仍用 `deepseek-v4.1-flash` + `reasoningEffort=none`（与画布节点缺省一致）；TapCanvas 原生的“尾帧续写”（上一段末帧作下一段首帧）只在其工作流内，资产规划出口不提供；101 上的 TapCanvas Pro 仍是 9 月版本（规划走 www.lluban.cn 渠道 55，对话走 101 渠道 43）。

**移动端生图**：新增宿主工具 `tanva_generate_image`（prompt、参考图、画幅 1:1/3:4/4:3/9:16/16:9/2:3/3:2、1–4 张）。后端 `VideoProductionService.submitUserImage` 以用户身份走画布同一套 `gpt-image-2.6-sunburst` 2K 生图（image-tasks 预扣、失败退款），每张一张 `kind=image` 消息卡，前端 `ImageCard` 轮询 `/api/ai/image-task/:id`，生成中按画幅占位 + 走秒，完成可全屏、下载。分镜卡在生成中显示每段已用时长和“视频生成最耗时”的说明。

## 2026-11-11 多屏详情页 / 长图

原「生成图片」的长图只是单张 9:16，`count` 只出同一描述的多个版本，做不了详情页。新增宿主工具 `tanva_detail_page`：`title`、`style`（整套统一风格）、`sections[2–10]`（每屏标题 + 画面描述，含文案）、`aspectRatio`（默认 3:4）、参考图（本条附件自动带入）。每屏用 `detailSectionPrompt` 拼“统一风格 + 本屏内容 + 第 i/N 屏”提交一个 gpt-image-2.6-sunburst 2K 任务（计费同单张，失败退款），合为一张 `kind=image_set` 消息（attachments 存各屏 taskId 与 `longImageUrl`）。前端 `ImageSetCard` 各屏上下无缝相接、逐屏实时出图；全部成功后「拼成一张长图」→ `POST /api/mobile-chat/messages/:id/stitch`：后端按顺序下载各屏，sharp 统一宽度（≤1242）纵向拼接为 JPEG（高 ≤60000），转存 OSS `mobile-chat/<userId>/<messageId>/detail-long.jpg`，幂等。长图全屏可上下滚动查看。快捷入口新增「详情页」。

- 2026-11-11 修复：首次线上详情页（“保温杯详情页，5 屏”）报“至少需要 2 屏”。根因是 `buildCapabilityManifestSummary` 用 3 层上限的 `safeValue` 处理 hostTools 参数，JSON Schema 第 4 层起被裁：`sections.items` 变成 `{}`、所有 `enum` 变成 `null`，模型看不到每屏字段名只能猜（画布宿主工具同样受影响）。参数改为放宽 6 层；`toDetailRequest` 兼容字符串数组、`content/description/name/heading` 等字段名与 JSON 字符串；被拒参数写日志。

- 输入框在单行与多行布局之间平滑展开或收起；减少动态效果时关闭过渡。

- “我的作品”页左上角与首页统一使用菜单按钮，可打开侧边栏切换页面。

- 登录页复用对话首页的创作提示轮播，登录前展示多种创作场景。

- 发送按钮在不可用时保持低强调，同时提高箭头图标对比度。

- 移动端横向列表隐藏滚动条，同时保留横向滑动。
