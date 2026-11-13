# 移动端网页 `/m`：对话 + 一键成片 / 一键复刻（2026-11-11 已部署 101，待真实对话 / 成片验收）

设计见 `helloagents/plan/202611101200_mobile_chat_web/proposal.md`。

## 2026-11-13 我的作品与我的素材

- `/m/works` 仅展示已拼接的“详情页长图”和完成的“视频成片”（一键成片 / 复刻视频），排除未完成任务卡片。
- 新增 `/m/materials`，侧边栏“我的素材”使用与现有 Lucide 图标一致的线性文件夹图标。两页复用网格、图片缩放查看和视频大图播放，列表卡片仅展示预览、标题、分类与日期。
- 素材分别标注“详情图分页”“视频素材图片”“视频分镜”。拼接完成后仍保留分页入口，读取视频任务的角色 / 道具 / 场景图片和分镜视频，包含进行中及失败任务已产出的资源。独立生图归入素材并标为“图片”。
- 历史会话中的视频任务引用补充任务列表，按任务 ID 去重；读取并发限制为 4。局部失败保留成功结果并支持重试，两页有独立空状态。
- TypeScript、修改文件 ESLint、Vite 生产构建及 Chrome 模拟接口回归通过。覆盖分类与互斥展示、历史任务补读、拼接后的分页、失败任务素材、侧边栏切换、图片 / 视频 / 保存预览、部分失败重试、空状态及 320/390/768/1194px 网格。尚未真实账号数据与手机真机验收，未部署。

## 2026-11-13 视频保存预览

- 视频保存面板增加当前视频预览与原生播放控件，可在保存前确认内容，默认暂停。预览高度随屏幕限制，面板内容可滚动。

## 2026-11-13 成片卡片布局

- 保存成片与预估积分合并为同一行，按钮保持右对齐。制作过程的展开箭头缩小并紧邻标题，保留展开与收起交互。

## 2026-11-13 媒体查看与按钮位置（本地，未部署）

- `ImageViewer.tsx` 移除半透明黑色遮罩，使用深色纯底。普通图片与长图统一按可用宽高完整缩略显示，复用已有 `react-zoom-pan-pinch` 支持双指放大 / 缩小、放大后拖动与双击缩放切换。屏幕尺寸变化时恢复适配后的完整视图，关闭后恢复页面滚动与焦点。
- `JobCard.tsx` 成片保存按钮移至卡片操作行右侧。
- `MobileWorks.tsx` 视频网格使用静音、无控件的封面预览，点击后打开 `VideoViewer.tsx` 全屏查看层，在大视图中播放。查看层保留原生视频控件、右侧保存入口与关闭按钮，关闭时暂停播放，支持 Escape，保存面板关闭后回到视频查看层。
- 验证通过 TypeScript、Vite 生产构建及四个修改 / 新增组件的 ESLint。Chrome 使用模拟接口和 Canvas / MediaRecorder 测试素材，验证长图完整适配、CDP 双指缩放往返、双击切换、拖动、保存面板、320px / 平板 / 横屏适配、视频封面点击、实际大视图播放、缩略视频保持暂停、关闭暂停、切换作品、Escape、右对齐按钮与无新标签页。尚未 iPhone / Android 真机验收，未部署。

## 2026-11-13 图片与视频保存（本地，未部署）

- 保存面板按钮文案为“系统分享”和“保存为文件”。说明简化为“保存到相册，或分享给他人”“长按图片保存”，视频文件提示为“下载后在‘文件’中查看”。此次仅调整文案。

- 新增 `MediaSaveButton.tsx`，单图、详情长图、成片、全屏看图及作品页视频统一使用页内保存面板，下载入口移除新标签页链接。
- 打开面板后读取当前媒体文件，准备好 `File` 后由用户点击调用 Web Share 文件分享，保留用户激活。面板说明在系统菜单中选择“存储图像 / 存储视频”或相册选项，可用目标取决于系统和浏览器。移动网页无法直接写入相册。
- 不支持文件分享时，图片支持页内长按保存，视频提供 Blob 文件下载及从文件管理保存到相册的说明。下载使用文件名与实际 MIME，兼容对象存储的通用 MIME，拒绝 HTML / JSON 等错误响应。取消分享不提示失败，读取失败可重试，关闭时中断请求并释放临时 objectURL。
- 修正 `assetProxy.ts` 的视频 `forceProxy` 分支，显式要求代理时已知媒体域名也通过资源代理读取，避免跨域读取失败。
- 已通过 TypeScript、生产构建与六个移动端组件 ESLint。修改的 `assetProxy.ts` 存在三处既有未使用变量 / 函数 ESLint 错误（`viteEnv`、`shouldForceProxyUrl`、`tryUnwrapAssetProxyUrl`），本次仅调整强制代理条件。Chrome 模拟验证图片 / 视频文件分享调用、用户激活、取消、分享错误、文件名与 MIME、文件下载、不支持分享、读取失败重试、320/390/768px 布局和保持当前页。分享 API 使用模拟实现，尚未 iPhone / Android 真机与真实相册验收，未部署。

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

## 2026-11-13 积分页返回入口

- `/my-credits` 页头新增左箭头与「返回 / Back」按钮，点击区域高 44px，加载与请求失败时仍可返回。
- 移动端顶部积分、账号菜单、对话余额不足与任务卡充值入口携带 `returnTo`，保存当前路径和查询参数，返回原对话或作品页。返回时替换积分页历史记录。
- 返回地址仅接受 `/m` 及其子路径。无有效地址时优先使用应用路由历史，无路由历史则回到 `/m`。
- 验证通过全量 TypeScript 检查、Vite 生产构建及五个修改页面的 ESLint。Chrome 本地 mock 验证首页、对话、作品页往返，直接打开积分页的兜底返回、加载中与接口失败返回、中英文页头，以及 320/390/768/1194px 页头无横向溢出。未部署线上。


## 2026-11-13 图片失败定向重试

- 单图和详情页失败分屏显示「重新生成这张图」，请求期间禁用重复点击，提交失败保留错误与重试入口。`POST /api/mobile-chat/messages/:id/retry-image` 接受原 `taskId` 与可选 `sectionIndex`，校验用户、会话和任务失败状态，在消息行事务锁内去重并更新对应引用。
- 复用原任务完整提示词、参考图和画幅。新任务保存完整生成参数，未提交成功的分屏也可以重试。历史任务从 ImageTask 恢复参数；历史无任务且未保存提示词的记录会提示用户重新描述图片。
- 明确的自然语言补图请求在宿主定位最近图片卡片。「生成未能生成成功的这张图」「补上没生成成功的图」补齐该卡片失败项，「重做第八屏」与「重新生成售后与保障这张图」限定分屏。仅失败项进入重试，运行中的任务保持跟踪。按标题可定位历史卡片，未指定卡片时使用最近一张。SSE 按消息 ID 更新原卡片。
- 新任务 ID 与启动时间持久化，刷新后继续轮询，重试时清除旧失败态与旧长图地址，其余成功图片保留。全部成功后恢复长图拼接。
- 验证通过后端移动端回归（所有权、输入、并发去重、历史参数、失败再次重试、自然语言定位、多失败补齐、宿主拦截与原消息更新）、后端构建、前端类型检查、六个修改文件 ESLint 与生产构建。Chrome mock 验证按钮、网络失败、请求中防重、成功分屏保留、刷新恢复、原卡片接收新任务、长图拼接及 320/390/768/1194px 布局。未调用生产付费生图，未部署生产。

## 2026-11-13 账号菜单与会员页返回

- 账号菜单「积分与充值」改为「积分详情」，「会员」改为「会员与充值」。会员链接以 `returnTo` 保存当前移动端路径及查询参数。
- `/membership` 页新增独立的「返回 / Back」按钮（44px 高），在会员数据加载和失败时均可用。合法 `/m` 来源优先，其余使用应用路由历史或 `/m` 兜底。支付成功进入积分详情页时透传合法来源，继续支持回到产品。
- 验证通过 TypeScript、两个修改文件 ESLint、生产构建和 Chrome mock，覆盖首页、对话与作品页往返，直接访问/无效来源兜底、会员接口失败返回、320/390/768/1194px 返回栏。未执行真实支付，未部署生产。

## 2026-11-13 附件直传 TOS（上传失败根治）

- 现象：iPhone 微信内选图后缩略图一直转圈，最终上传失败。线上 `tanvas.cn.log` 中 `POST /api/uploads/image` 均为 499，且都在选图返回后正好 3 分钟中止；nginx/Nest 均无错误。
- 根因 1（架构）：图片/视频全部经 101 中转（nginx 缓冲整份 body → Nest `toBuffer` → `putStream` 到 TOS → 才响应），速度被 101 带宽和处理卡住。浏览器直传路径本应分流，但 TOS POST 策略未声明 `bucket`，TOS 返回 `Invalid according to Policy: Extra input fields: bucket`，前端静默回退中转。桶 CORS 实测已放行 `https://tanvas.cn` 的 POST/PUT 与任意请求头，旧注释“直传无 CORS”已过时。
- 根因 2（超时）：`fetchWithTimeout` 未把 `timeoutMs` 传给 `fetchWithAuth`，后者 3 分钟默认超时先触发，`LARGE_UPLOAD_TIMEOUT_MS`（10 分钟）从未生效。
- 后端：`buildTosPresignPost` 条件加 `{ bucket }`、`starts-with $Content-Type`、`starts-with $Cache-Control`；声明后这两个字段为必填（缺失返回 Policy Condition failed），前端直传始终携带。`/api/uploads/presign` 的 `maxSize` 钳到 200MB。Admin/OSSDemo 的旧 OSS 字段直传此前即不可用，不受影响。
- 前端：`OssUploadOptions.direct`——图片/视频跳过中转、直传 TOS，失败回退中转；直传表单在 file 前写入 `Content-Type`、`Cache-Control: public, max-age=31536000, immutable`。上传超时 = max(10 分钟, 文件大小 ÷ 100KB/s)，上限 60 分钟（200MB ≈ 34 分钟）。移动端附件 `direct: true`，最多 2 个并发排队，失败在输入框上方提示原因（超时单独提示）。原图上传，不做压缩/转码。桌面端暂沿用中转默认值，可按需改用 `direct`。
- 验证：101 上用新编译的签名代码对生产桶实测（测试对象已删除）：带字段直传 204，`Access-Control-Allow-Origin: https://tanvas.cn`，对象 `Content-Type`/`Cache-Control` 正确；策略 5 秒过期、限速上传 21 秒仍 204（有效期只在请求开始时校验）。
- 视频上限：移动端前端 200MB、签名 200MB、nginx `/api/` 200m、`/api/uploads/video` 500MB、复刻下载 512MB。
- 部署（2026-11-13 20:50 前后，UTC+8）：`0665f6dd` 推送 main，101 `/www/wwwroot/tanvas.cn` 已在该版本。后端：本地对线上版本构建的两个 dist 文件与生产 SHA-256 一致后，单文件替换 `dist/oss/oss.service.js`（`736b8a56…`）与 `dist/oss/uploads.controller.js`（`cd1aa13d…`），旧文件备份 `/opt/tanva-backups/mobile-upload-direct-20261113-0665f6dd/backend-dist-oss/`；image-tasks / video-productions / video-analysis-tasks 均空闲时 `pm2 reload tanvas-api`，内外网 `/api/health` 200。前端：在 `/opt/tanva-releases/mobile-upload-direct-20261113-0665f6dd/dist` 隔离构建（`GITHUB_SHA` 写入 commitSha），旧 dist 全量备份到同目录 `frontend-dist/`，rsync 增量发布并保留旧 hash 资源，最后原子替换 `index.html`、`version.json`；公网 `version.json` commitSha `0665f6dd633f`。真机（iPhone 微信）上传尚未验收。
- 回退：后端把备份的两个 JS 拷回 `backend/dist/oss/` 后 `pm2 reload tanvas-api`（前端直传失败会自动回退中转，后端可单独回退）；前端把备份 `index.html`、`version.json` 拷回 `frontend/dist/`。

## 2026-11-13 一键成片时长锁定

- 现象：移动端“围绕这张图生成 1 分钟别墅售楼大片”，成片 1 分 45 秒。线上 `vprod_mwezbew44c94fe9edec2`：`targetSeconds=60`，规划 8 段（12+13+10+15+14+12+14+15）= 105 秒。
- 根因：`targetSeconds` 只拼成“成片总时长约 N 秒”放进 requirement；TapCanvas 规划不受约束，Tanva 也不校验。复刻早已用 `remakeClipPlan`（N×S + `step` + `max_duration`）锁定总长，成片没有。线上 `TAPCANVAS_PLAN_EXACT_DURATION` 未开启。
- 修复：`tapcanvas-plans.protocol` 新增 film 专用 `targetDurationSeconds`；`clipPlan` 通用化，`filmClipPlan` 段长约 10 秒、≤18 段（15→2×8，30→3×10，60→6×10，90→9×10，180→18×10）；提示词写“规划为 N 个 Clip、每个 S 秒”，请求带 `step=S`、`clipPreference=max_duration`；开启精确总长时改发 `targetDurationSeconds`。`video-production` 改传该字段，去掉“约 N 秒”软提示。
- 兜底：规划总长与要求相差超过 max(5 秒, 20%) 时，在生成图片/视频前丢弃规划、换 clientRequestId 重规划一次（`meta.durationReplanned`，多一次规划费）；仍不达标则写警告继续。分镜提示词带逐镜头时间码，不能事后按比例缩放 Clip 时长。

## 2026-11-13 保存成片直连 TOS + 下载进度

- 现象：iPhone 微信内点“保存成片”一直显示“正在准备视频…”。日志：40.8MB 成片两次经 `/api/assets/proxy` 只传出 3.3MB、35.6MB（均 200，客户端提前断开）。
- 根因：保存面板强制走 101 代理把整份文件读成 Blob，期间无进度；且微信内置浏览器既不支持 `navigator.share` 文件也不能下载 blob，即使下完也保存不了。
- 修复（`MediaSaveButton`）：自家桶（`VITE_ASSET_PUBLIC_BASE_URL` 主机）只直连 TOS（`cache: no-store`，避免复用 `<video>` 的非 CORS 缓存），不回退代理；第三方地址直连失败才回退代理。流式读取显示百分比 + MB 进度条，30 秒无新数据中止并提示重试。微信内不预下载：视频引导“···→在默认浏览器中打开”并提供复制视频链接，图片长按保存。
- 部署（2026-11-13 21:30 前后，UTC+8）：`996059a4`（文档 `e93bbce8`）推送 main，101 fast-forward。后端：本地对线上版本构建的两个 dist 与生产 SHA-256 一致后，单文件替换 `dist/tapcanvas-plans/tapcanvas-plans.protocol.js`（`bef3ab1b…`）、`dist/video-production/video-production.service.js`（`06183b18…`），旧文件备份 `/opt/tanva-backups/film-duration-media-save-20261113-996059a4/backend-dist/`；三个队列 active=0 时 `pm2 reload tanvas-api`，内外网 health 200；线上模块实测 film 60 秒 → `step=10`、`max_duration`、“6 个 Clip、每个 10 秒”。前端：`/opt/tanva-releases/film-duration-media-save-20261113-996059a4/dist` 隔离构建，旧 dist 备份同名目录 `frontend-dist/`，增量发布后原子切换入口，公网 commitSha `e93bbce80921`。真机（iPhone 微信 / Safari）保存与新成片时长尚未验收。
- 回退：后端把备份的两个 JS 拷回 `backend/dist/` 对应目录后 `pm2 reload tanvas-api`；前端把备份 `index.html`、`version.json` 拷回 `frontend/dist/`。

