# 前端模块：应用入口与路由（frontend-app）

## 作用
- 负责应用入口渲染、路由定义与受保护路由的初始化策略。

## 关键文件
- `frontend/src/main.tsx`：路由表（Home/Login/Register/Workspace/App/Admin/MyCredits 等）
- `frontend/src/routes/ProtectedRoute.tsx`：延迟初始化认证状态，避免首页加载即请求 `/api/auth/me`
- `frontend/src/App.tsx`：主应用（工作区/画布等以实现为准）

## AI 对话框右键菜单
- 对话框内容区使用浏览器默认右键菜单。

## 活动通知栏
- 组件：`frontend/src/components/layout/CampaignNoticeBar.tsx`
- 配置：`frontend/src/components/layout/campaignNoticeConfig.ts`
- 入口：首页 `/` 与工作区 `/app` 顶部均挂载活动通知栏；父级使用正常文档流/flex 布局让页面内容整体下移，不遮挡主内容。
- 显示规则：顶部活动通知栏不持久化关闭状态，也不因倒计时到期自动隐藏；点叉只关闭当前页面实例，刷新后会重新显示。
- 倒计时：当前活动截止时间为北京时间 `2026-06-06 00:00:00`；倒计时归零后横条仍保留数字块样式并显示 `00`。
- 关闭行为：点击右侧关闭按钮只隐藏当前 React 页面实例，不写入 localStorage/sessionStorage；刷新页面后会重新显示。
- 详情入口：通知栏内“了解详情”按钮会触发 `CAMPAIGN_NOTICE_DETAIL_EVENT`，由 `LoginNoticeModal` 重新打开默认公开赛活动弹窗；该入口不写入登录提醒关闭记录，用户关闭过登录弹窗后仍可再次查看。
- 画布避让：`frontend/src/index.css` 中的 `.tanva-campaign-shell` 会在通知栏存在时调整工作区固定顶栏、工具栏和左右侧栏位置。

## AI 对话框图片模式可用性
- 手动模式会根据当前图片数量自动禁用不支持选项，并在不兼容时回退到 Auto。
- 发送按钮在模式不支持当前图片数量时禁用并提示原因。
- 展开历史模式默认预留顶部间隙，让画布/顶栏仍露出一条内容；用户拖拽顶部边缘后仍可把面板拉高到接近全屏。
- Auto research-only 问题会先按普通 Text 模式计算并传递当前 `model`、`providerOptions` 路由和 `thinkingLevel` 给 Agent，再消费 Agent 的 `research_text` 事件，把联网文字回答写入消息正文；随后 `research_result` 会把联网文字回答与火山 `volc` 结构一并保存到 `metadata.agentTrace`，正文继续以联网文字回答为主，不再拼接火山搜索摘要/案例文本，同时通过 `metadata.agentTrace.researchResult` 渲染只含标题、必要元信息、真实图片和来源链接的图文案例卡片；无 `imageUrl` 的图片候选不会显示占位块。研究类 Agent 步骤现在跟随真实后端进度更新，页面不会再把联网检索与组织卡片提前显示为已完成。
- AI Chat 文本生成失败时会把占位正文替换为失败说明，并把 `generationStatus.stage` 置为“已终止”，避免错误后仍显示“正在生成文本回复...”。

## 设备访问
- `/app` 入口仍会对手机和小屏触摸设备展示移动端提示，但 iPad 已从移动设备拦截中排除；检测同时兼容传统 `iPad` userAgent 与 iPadOS 13+ 的 `MacIntel + maxTouchPoints > 1` 模式。

## AI 对话框会话边界
- `ContextManager` 不在构造期自动恢复全局本地会话；恢复由 `aiChatStore.initializeContext()` 按项目作用域调度。
- 有项目 ID 时，对话框会话只从 `Project.content.aiChatSessions` / `aiChatActiveSessionId` 水合；IndexedDB/localStorage 中的全局本地会话仅用于无项目场景，避免切换/新建项目时旧历史串入当前项目。

## 离开保护（上传中/待上传）
- 编辑器（`/app`）内若存在上传中/待上传图片（含 Flow 内联图片引用），在离开页面/切换项目/退出登录/浏览器前进后退时会弹出确认提示，避免误操作导致图片丢失或无法保存到云端。

## 项目打开缓存
- `ProjectAutosaveManager` 打开项目时优先读取 IndexedDB 项目内容缓存（`tanva_project_cache`），命中后先从本地内容水合画布/Flow/AI 会话，再后台校验远端项目元信息。
- 缓存校验中会设置 `projectContentStore.cacheValidationPending`，自动保存和手动保存都应暂停，避免用户基于旧缓存修改时覆盖远端新版本。
- 切换项目的 Paper 清空、内容替换与反序列化前会让出一帧给浏览器提交 UI，减少项目下拉/标题刷新被同步 Paper 工作阻塞的体感卡顿。
- 顶部项目下拉选择项目时应允许菜单立即关闭，并用下一轮 macrotask 调用 `projectStore.open()`；项目内容本地缓存只能跳过远端内容请求，不能消除 Paper `importJSON`、Raster runtime rebuild 或 ReactFlow hydrate 的主线程成本。
- `paperSaveService.deserializePaperProject()` 支持在项目切换路径已提前 `clearProject()` 成功时跳过内部重复 `project.clear()`；`projectLoadDebug` 会记录 Paper runtime rebuild 输入和耗时，便于定位切换卡顿瓶颈。
- `/app` 会在项目切换后显示轻量全屏项目加载层，直到 Flow overlay 完成首次 hydrate 后的 paint 并经过一次 idle/稳定窗口后写入 `projectContentStore.projectViewReady = true`；加载失败时不继续遮挡画布。

## 路由约定（节选）
- 公开：`/`、`/auth/login`、`/auth/register`、`/oss`
- 登录页新增观猹 OAuth 入口（位于登录按钮下方），点击后跳转后端 `/api/auth/watcha/authorize`，由后端回调 `/api/auth/watcha/callback` 完成登录与回跳。
- 受保护：`/workspace`、`/app`、`/admin`、`/my-credits`
- 登录页与注册页已补充移动端适配：小屏下认证卡片改为顶部对齐并允许纵向滚动，标签切换改为三列紧凑布局，验证码输入区改为纵向堆叠，协议文案允许多行左对齐，避免窄屏遮挡与横向溢出（`frontend/src/pages/auth/Login.tsx`, `frontend/src/pages/auth/Register.tsx`）。

## 登录提醒弹窗
- 组件：`frontend/src/components/auth/LoginNoticeModal.tsx`
- 配置：管理后台 `/admin` → 系统设置 → 登录提醒，保存到系统设置 `login_notice`（JSON：`{ enabled, content, contentHtml, mediaType, mediaUrl, posterUrl, primaryButtonText, primaryButtonUrl, secondaryButtonText, secondaryButtonUrl }`）。后台编辑器支持受限富文本：字体、字号、颜色、背景色、加粗、斜体、下划线；保存时同时保留纯文本 `content` 兼容旧客户端。顶部媒体支持图片或静音循环视频，媒体和封面均通过 OSS 上传或远程 URL 配置。
- 读取：用户进入受保护路由后前端调用公开接口 `GET /api/settings/login-notice`；开启且内容非空时展示弹窗，公开首页 `/` 不触发。前端渲染 `contentHtml` 前会通过白名单清洗，仅允许安全标签和样式；媒体 URL 会拒绝 `data:`/`blob:`/`javascript:`。
- 按钮动作：次按钮 URL 填 `/__action__/wechat` 会关闭登录提醒并打开/固定工作区右上角微信二维码浮层；留空且按钮文案包含“社群/微信/WeChat”时也按微信动作处理。内部 URL 使用 React Router 跳转，目标路径与当前路径相同（如已在 `/app`）时只关闭弹窗，不刷新画布。
- 默认内置活动：`contest-default-2026-06-06` 只展示 2026 Tanvas AI 创作公开赛单页弹窗，暂不展示 Seedance 活动页、轮播箭头或视频自动切页；保留“赛事报名 | 加入赛事交流群”和“获取赛事详细信息”按钮。“获取赛事详细信息”会新开页面打开公众号文章 `https://mp.weixin.qq.com/s/E-WqYdpy-9bU5gtw0xQI4g`，不替换当前画板页。
- 公开赛二维码：管理后台微信咨询二维码设置新增 `contest_registration_qrcode`（赛事报名二维码）。公开赛页“赛事报名 | 加入赛事交流群”按钮触碰或点击时展示两个二维码：赛事报名二维码和 `login_notice_button_qrcode`（进入公告的按钮二维码，缺失时回退到微信群二维码或 `/qrcode-group.png`）；弹窗重新打开、触发该按钮时都会重新读取公开二维码接口，避免后台刚上传后前端仍持有旧空状态。
- 关闭记录按 `userId + last_auth_at + notice.updatedAt` 写入本地存储；同一次登录关闭后不重复弹出，用户重新登录会再次弹出。

## 我的积分（`/my-credits`）
- 页面与应用入口都不再静默触发 `claimDailyReward()`；签到积分必须由用户手动触发领取，不再自动签到。
- 积分流水在“项目”列支持显示 AI 渠道与模型（如 `渠道：A · 模型：gemini-2.5-flash-image-preview`），用于定位实际执行链路。
- 记录列表会额外读取已支付会员订单，并把 VIP 订阅消费按 `PaymentOrder.planName/amount/paymentMethod/orderNo` 合并展示；普通充值仍沿用积分流水展示，避免重复。
- 概览卡片右上角提供“立即充值”文字按钮；点击后在当前页弹出 `PaymentPanel` 充值面板。
- `MembershipPanel` 中“积分充值”区域对所有用户开放，且在会员页顶部优先展示（打开即见），无需先选择或购买 VIP。
- `MembershipPanel` 的 VIP 订阅视图使用紧凑的当前会员摘要栏承载计费周期切换、当前额度和刷新说明；套餐卡片按档位强化视觉区分，减少长卡片大留白，但不改变订单创建、支付方式切换和轮询逻辑。
- `MembershipPanel` 的 VIP 套餐卡片合计积分按预计月合计展示：套餐到账积分 + `dailyGiftCredits * 30` 每日签到积分 + `dailyGiftCredits * (rewardMultiplier - 1) * 4` 连续 7 天签到额外奖励。
- `MembershipPanel` 的 VIP 套餐权益列表不再展示“每日赠送”，改为展示每周连签 7 天按当前套餐可额外获得的积分：`dailyGiftCredits * (rewardMultiplier - 1)`。
- `MembershipPanel` 的额度刷新提示使用警示色文案：月度套餐在计费日刷新并清零未使用额度，年付套餐按月发放并在年度到期日统一清零，单独购买额度不受套餐周期影响。
- `MembershipPanel` 的标准版套餐卡片不显示王冠图标，权益列表不再重复展示“基础月卡积分：500”首行。
- `PaymentPanel`（`frontend/src/components/payment/PaymentPanel.tsx`）核心交互文案已接入 `useLocaleText`（订单状态、筛选、支付提示、二维码状态、手动核对按钮）。
- 概览与趋势的“消耗”口径为净消耗：按 `spend - refund` 计算（最小值为 0），避免失败后退款仍被算入“今日/近 7 天消耗”。

## 双语适配（画布侧）
- `LayerPanel`（`frontend/src/components/panels/LayerPanel.tsx`）已接入 `useLocaleText`：面板标题、操作 tooltip、上下文菜单、待上传标识与底部统计文案均按语言切换。
- `LibraryPanel`（`frontend/src/components/panels/LibraryPanel.tsx`）已接入 `useLocaleText`：上传/删除/发送提示、详情面板字段、全局历史筛选和分页文案按语言切换。
- `LibraryPanel` 新增独立 `项目库` 标签：按当前 `currentProjectId` 过滤展示项目内历史记录（与 `全局历史` 分离），并复用单击详情弹层、发送/下载/删除操作与双击全屏预览交互。
- `LibraryPanel` 的全局历史/项目库复用 `global-history/historyMedia.ts`：图片与视频记录共享类型标签、媒体 URL、视频封面和下载文件名解析；视频记录支持封面/播放/详情下载，但禁用发送或拖拽到画板。
- `ToolBar`（`frontend/src/components/toolbar/ToolBar.tsx`）已接入 `useLocaleText`：主工具 tooltip、线条样式面板、清空画布确认等高频交互文案双语化。
- `AIChatDialog`（`frontend/src/components/chat/AIChatDialog.tsx`）底部参数栏与上传菜单、历史会话工具条、图片/视频预览操作 tooltip 已按中英文切换（组件内通过 `i18n.language` + `lt()` 本地文案映射实现）。
- `PromptOptimizationPanel`（`frontend/src/components/chat/PromptOptimizationPanel.tsx`）已接入双语文案：输出语言/长度倾向/风格/重点字段标签、占位符、错误提示和底部操作按钮按语言切换。
- `KeyboardShortcuts`（`frontend/src/components/KeyboardShortcuts.tsx`）已接入双语文案：快捷键复制/导入 JSON 的 toast 提示，以及云端保存阻断与失败文案按语言切换。
- `ProjectManagerModal`（`frontend/src/components/projects/ProjectManagerModal.tsx`）已接入双语文案：项目管理头部、创建/批量选择/删除、离开保护确认、重命名/删除确认、空态与分页文案按语言切换。项目卡片会懒加载当前页内容快照，从 `assets` 与 Flow 节点数据提取图片引用并渲染宫格预览；该逻辑只读项目内容，不做缩略图转存或保存链路改动。
- `AccountBadge`（`frontend/src/components/AccountBadge.tsx`）已接入双语文案：问候语、认证状态标签与来源 tooltip、退出登录按钮按语言切换。
- `AppLoader` / `AppLoadingIndicator`（`frontend/src/components/AppLoader.tsx`, `frontend/src/components/AppLoadingIndicator.tsx`）默认加载提示已按语言切换。
- `AuthWrapper`（`frontend/src/components/AuthWrapper.tsx`）会话过期 toast、登录状态校验加载文案、错误态“重新加载”按钮已按语言切换。
- `ForgotPasswordModal`（`frontend/src/components/auth/ForgotPasswordModal.tsx`）已接入双语文案：手机号/验证码/重置密码三步流程的标题、说明、输入占位、错误提示、操作按钮与 toast 按语言切换。
- `AutosaveStatus` / `ManualSaveButton`（`frontend/src/components/autosave/AutosaveStatus.tsx`, `frontend/src/components/autosave/ManualSaveButton.tsx`）已接入双语文案：保存状态提示、手动保存按钮、保存失败与未上传阻断提示按语言切换。
- `PendingUploadLeavePrompt` / `PendingUploadNavigationGuard`（`frontend/src/components/guards/PendingUploadLeavePrompt.tsx`, `frontend/src/components/guards/PendingUploadNavigationGuard.tsx`）已接入双语文案：离开确认弹窗标题/说明/详情行/按钮与路由拦截提示按语言切换。
- `ZoomIndicator` / `FocusModeButton` / `ImageSizeIndicator`（`frontend/src/components/canvas/ZoomIndicator.tsx`, `frontend/src/components/canvas/FocusModeButton.tsx`, `frontend/src/components/canvas/ImageSizeIndicator.tsx`）已接入双语文案：缩放菜单与按钮 tooltip、专注模式提示、原始尺寸模式标识按语言切换。
- `WorkflowHistoryButton`（`frontend/src/components/workflow-history/WorkflowHistoryButton.tsx`）已接入双语文案：历史面板标题、刷新/关闭/恢复操作、空态与恢复确认提示按语言切换。
- `LayerTool` / `SharedTemplateCard`（`frontend/src/components/toolbar/LayerTool.tsx`, `frontend/src/components/template/SharedTemplateCard.tsx`）已接入双语文案：图层面板按钮标题、模板卡片空态/标签前缀/删除提示按语言切换。
- `ImageUploadComponent` / `Model3DUploadComponent`（`frontend/src/components/canvas/ImageUploadComponent.tsx`, `frontend/src/components/canvas/Model3DUploadComponent.tsx`）已接入双语文案：上传失败、组件未就绪、无法打开文件选择器等错误提示按语言切换。
- `SelectionBoxOverlay` / `SnapGuideRenderer` / `ScaleBarRenderer` / `GenerationProgressBar` / `context-menu` / `dropdown-menu` 已清理残余中文注释，保持扫描基线准确并避免误报未双语化文件。
- `OSSDemo` / `PromptOptimizerDemo`（`frontend/src/pages/OSSDemo.tsx`, `frontend/src/pages/PromptOptimizerDemo.tsx`）已接入双语文案：Demo 页按钮、状态提示、字段标签、辅助说明和错误提示按语言切换。
- `SelectionGroupToolbar`（`frontend/src/components/canvas/SelectionGroupToolbar.tsx`）已接入双语文案：截图、组合/解组、批量下载、发送到对话框等动作的按钮文字和 tooltip 按语言切换。
- `Canvas` / `GlobalZoomCapture` / `InteractionController` 已清理残余中文注释与日志标签，保持扫描基线准确并避免误报未双语化文件。
- `BackgroundRemovalTool` / `BackgroundRemovedImageExport`（`frontend/src/components/canvas/BackgroundRemovalTool.tsx`, `frontend/src/components/canvas/BackgroundRemovedImageExport.tsx`）已接入双语文案：上传提示、处理成功提示、导出按钮、空态说明按语言切换。
- `ImagePreviewModal` / `TemplateModal`（`frontend/src/components/ui/ImagePreviewModal.tsx`, `frontend/src/components/template/TemplateModal.tsx`）已接入双语文案：预览标题与加载文案、模板页签与加载态、模板删除确认和占位文案按语言切换。
- `ColorPicker` / `TextStylePanel`（`frontend/src/components/toolbar/ColorPicker.tsx`, `frontend/src/components/toolbar/TextStylePanel.tsx`）已接入双语文案：吸管取色提示、透明/更多按钮、字体/字重/颜色/对齐标题按语言切换。
- `MemoryDebugPanel` / `HistoryDebugPanel` / `CachedImageDebug`（`frontend/src/components/debug/MemoryDebugPanel.tsx`, `frontend/src/components/debug/HistoryDebugPanel.tsx`, `frontend/src/components/debug/CachedImageDebug.tsx`）已接入双语文案：监控状态、历史栈说明、缓存图调试标签与操作按钮按语言切换。
- `Sora2Test`（`frontend/src/pages/Sora2Test.tsx`）已接入双语文案：视频提示词占位与画幅提示说明按语言切换。
- `MiniMapImageOverlay` / `TextSelectionOverlay` 已清理残余中文注释，保持扫描基线准确并避免误报未双语化文件。
- `GlobalImageHistoryPage` / `GlobalImageDetailModal`（`frontend/src/components/global-history/GlobalImageHistoryPage.tsx`, `frontend/src/components/global-history/GlobalImageDetailModal.tsx`）已接入双语文案：历史页标题、搜索/筛选、加载与空态、删除撤销提示，以及详情弹窗元数据标签按语言切换。
- `FloatingHeader` + `projectStore`（`frontend/src/components/layout/FloatingHeader.tsx`, `frontend/src/stores/projectStore.ts`）已补充双语策略：自动创建/兜底项目名按当前语言生成，且历史 `未命名*`/`Untitled*` 项目名在顶部标题与项目下拉中按当前语言显示。
- 工作区顶部项目下拉按 `projectStore.recentProjectIds` 展示最近打开的 5 个项目；本地历史不足 5 个时从完整项目列表补齐，当前项目缺失时会兜底加入。
- 工作区顶部项目名右侧新增快捷 `+` 新建按钮（`FloatingHeader`），点击可直接创建并切换到新项目；项目下拉中的“新建项目”复用同一创建逻辑并带防连点保护。
- 工作区右上角 Nano Banana/Gemini/GPT-Image-2 路线快捷切换会读取今日普通/尊享路线成功率并在下拉内显示信号条；数据来自 `/api/ai/banana-route-success-rates`。
- 生文/生图线路的尊享路线视觉对齐 `lt-dev9`：菜单与设置页均使用 amber 王冠样式，不使用绿色星标。
- `PaymentPanel`（`frontend/src/components/payment/PaymentPanel.tsx`）已下架“双倍/首充翻倍”角标展示；`送X%` 等赠送百分比角标同样保持前端屏蔽。
- `LayerPanel` + `layerStore`（`frontend/src/components/panels/LayerPanel.tsx`, `frontend/src/stores/layerStore.ts`）已补充图层名双语兼容：新建图层默认名按当前语言生成，历史 `图层 N`/`Layer N` 显示按当前语言映射。

## 工作区顶部帮助入口（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：问号按钮改为 hover 展开下拉菜单，不再直接点击跳转。
- 菜单项：`用户手册`（飞书文档）与 `更新日志`（仓库 `frontend/docs/06-变更日志.md`）。

## 画板撤销/重做
- 全局快捷键由 `frontend/src/components/KeyboardShortcuts.tsx` 调用 `historyService.undo/redo`。
- `historyService` 恢复快照时会通过 `projectContentStore.hydrate(..., { resetProjectViewReady: false })` 更新内容，并保持当前工作区 `projectViewReady=true`；撤销/重做不应触发项目切换加载层。

## 工作区顶部积分入口（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：右上角工具区新增“积分”按钮（图标 + 当前余额），点击后新开页进入 `/my-credits`。
- 数据：复用顶部已加载的 `getMyCredits()` 结果（加载中显示 `...`，暂无数据显示 `--`）。

## 工作区设置弹窗（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：切换左侧设置分组时，右侧内容滚动区域会回到顶部（不保留上一次分组的滚动位置）。
- 保存状态提示（如“有未保存更改”）放在设置首页用户信息区显示，不再在画布顶部常驻显示。
- AI 设置里的“图片输入方式”写入 `aiChatStore.imageInputTarget`：`canvas` 为默认行为，外部图片粘贴/拖拽/上传直接上画布；`node` 会把这些外部图片输入转成 Flow Image 节点。显式“发送到画布”的内部按钮仍按按钮语义走画布链路。
