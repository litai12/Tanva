# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Added
- Credits Backend 基础设施新增多形态积分 groundwork：Prisma 增加 `CreditLot` / `CreditConsumePolicy`，`CreditTransaction` 增加 lot / policy 审计字段；后端新增 `credit-lot-policy.ts` 用于 lot 过滤、优先级排序和扣减规划。
- Credits Backend 已将三条发放链路接入 lot：充值成功、管理员补发、新用户注册赠送；当前均按 permanent lot 落库，为后续切换到 lot 真值扣减做准备。
- 认证系统新增观猹 OAuth2 登录：后端增加 `/api/auth/watcha/authorize` + `/api/auth/watcha/callback`，支持授权回调后自动登录、绑定/创建本地账号（`watchaUserId`）。
- 登录页在“登录”按钮下方新增观猹入口按钮，复用后端授权跳转链路并支持回调错误提示。
- 工作流历史版本：新增 `WorkflowHistory` 表（按 `userId + projectId + updatedAt` 复合主键），后端提供查询接口；前端右上角增加 n8n 风格历史按钮与“恢复并保存”交互。
- 画布与 AI 对话框支持 JSON 复制/导入（右键 + `Ctrl/Cmd+Shift+C/V`），导出内容与 `Project.contentJson` 保持一致。
- Flow 新增 `MiniMax 音乐生成` 节点（`minimaxMusic`）：支持 `prompt`、`lyrics`、`isInstrumental`、`lyricsOptimizer`，输出音频 URL 并支持历史回放/下载；后端新增 `POST /api/ai/minimax-music`，接入 MiniMax `music_generation` 接口并纳入积分服务 `minimax-music`。
- 新增用户模板云端持久化：后端增加 `UserTemplate` 数据模型与 `/api/user-templates` 鉴权 CRUD，前端“我的模板”从本地 IndexedDB 优先切换为后端存储（保留本地回退与迁移）。
- 前端右侧库面板新增双标签：`全局历史` 与 `手动素材`，全局历史支持搜索、类型筛选、页码分页（`1 2 ... N`）、拖拽/发送到画板；同时修复库面板内容区在部分视口下无法下滑的问题。

### Changed
- 工作流历史恢复新增来源标记：从历史版本“恢复并保存”后，新写入的 `WorkflowHistory` 会记录 `restoredFromUpdatedAt/restoredFromVersion`，前端历史列表可直接看到“恢复自哪个版本”，避免恢复生成的新记录与普通保存记录难以区分（`backend/src/projects/*`, `frontend/src/components/workflow-history/WorkflowHistoryButton.tsx`, `frontend/src/services/projectApi.ts`）。
- Backend `WorkflowHistory` 新增 7 天保留策略：项目历史查询仍返回当前项目全部现存记录，但由 `projects` 定时任务每日凌晨物理清理 7 天前数据，并为 `updatedAt` 增加索引以降低批量删除成本（`backend/src/projects/projects.service.ts`, `backend/src/projects/projects-scheduler.service.ts`, `backend/src/projects/projects.module.ts`, `backend/prisma/schema.prisma`）。
- Workspace 顶部右侧工具区恢复手动保存与工作流历史入口：`ManualSaveButton` 与 `WorkflowHistoryButton` 重新挂载到 `FloatingHeader`，用户可再次直接保存并查看/恢复工作流历史（`frontend/src/components/layout/FloatingHeader.tsx`）。
- Flow/Admin：将 `Vidu` 视频节点收拢为单一 `viduVideo` 入口，当前仅保留 `Q2 / Q3` 两档；移除除 `vidu-q2 / vidu-q3` 外的其余 Vidu 型号配置和暴露入口（`frontend/src/pages/Admin.tsx`, `backend/src/admin/services/node-config.service.ts`, `backend/src/ai/services/model-routing.service.ts`, `backend/src/ai/services/video-provider.service.ts`）。
- Flow：修正节点添加面板分组逻辑，不再把所有 `category: "input"` 节点提前归入“文字类节点”；`video` 输入节点现在会按真实节点类型显示在“视频类节点”（`frontend/src/components/flow/FlowOverlay.tsx`）。
- Workspace 顶部项目名区域新增快捷 `+` 新建入口：在当前项目名称右侧可一键新建项目；项目下拉中的“新建项目”同步复用同一创建逻辑并增加防连点状态（`frontend/src/components/layout/FloatingHeader.tsx`）。
- Flow: tightened connection validation in FlowOverlay so text handles (text/prompt/response-text) and image handles (img/image/image*) are no longer cross-connectable by source node type alone.
- Flow: fixed Kling video run-path image collection to include `image-2` (end frame) and enforce handle order (`image` -> `image-2`), so Kling 3.0 Pro start/end frame mode can take effect.
- AI `generate-image`：当上游仅返回外链 `imageUrl` 时，统一改为后端拉取并转存 OSS 后再返回；管理员/白名单仍可跳过水印，但不再直返第三方临时链接，减少云端历史过期裂图（`backend/src/ai/ai.controller.ts`）。
- Credits Backend: `updateApiUsageStatus` 增加状态机保护，禁止 `failed -> success` 与 `success -> failed` 反向回写，减少超时自动退款与晚到成功回写造成的状态/账务不一致（`backend/src/credits/credits.service.ts`）。
- Frontend `/my-credits`: “今日消耗 / 最近 7 天消耗 / 趋势图”改为净消耗口径（`spend - refund`，最小 0），避免失败后已退款流水仍被计入消耗（`frontend/src/pages/MyCredits.tsx`）。
- Flow：节点添加面板与快捷连接候选统一隐藏 `sora2Video` / `sora2Character` / `nano2`，不再展示 `Sora 2`、`Sora2 Character` 与 `Nano2` 入口（`frontend/src/components/flow/FlowOverlay.tsx`）。
- AI Analyze：`POST /api/ai/analyze-image` 增加 `sourceImages` 多图输入（兼容原 `sourceImage` 单图）；Flow `Analysis` 节点同步支持多图连线分析，`gemini/gemini-pro/banana` 按多文件联合分析，`midjourney describe` 对多图输入返回明确不支持错误。
- Flow Analysis：`text` 句柄支持多条 Prompt 连线并在运行时串联拼接（不再被新连线覆盖）。
- AI 图像调用（`generate-image` / `edit-image` / `blend-images`）前端自动重试从 3 次收敛为 1 次，避免网络抖动时同一次用户操作触发多条积分扣减/退款流水；失败重试由后端 provider 内部策略承接（`frontend/src/services/aiBackendAPI.ts`）。
- Canvas 右键菜单中的 JSON 操作改为直接复用 Flow「我的模板」导入/导出链路：`导出画布 JSON` 触发 `flow:export-template-request`，`导入画布 JSON` 触发 `flow:import-template-request`；同时 `FlowOverlay` 新增 `flow:export-template-request` / `flow:import-template-request` / `flow:import-template-json` 事件监听，统一走同一套导入导出实现（`frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`）。
- Flow `Multi Generate`（`generate4`）节点移除 `Count` 配置，运行轮次固定为 4；新建节点初始化数据不再写入 `count` 字段，避免配置面板与实际行为不一致（`frontend/src/components/flow/nodes/Generate4Node.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/types.ts`）。
- Credits 页面（`/my-credits`）概览卡片右上角改为“立即充值”按钮（点击弹出 `PaymentPanel`）；同时顶部“我的积分”入口图标升级为金币高光样式（`frontend/src/pages/MyCredits.tsx`, `frontend/src/components/layout/FloatingHeader.tsx`）。
- Credits 充值弹窗布局微调：左侧套餐区域补充底部留白，视觉更舒展（`frontend/src/components/payment/PaymentPanel.tsx`）。
- Workspace 保存状态提示位置调整：不再在画布顶部常驻显示，改为在设置首页（Workspace）用户信息区展示（`frontend/src/components/layout/FloatingHeader.tsx`）。
- Workspace 顶部右侧工具区新增“积分”入口（图标 + 当前余额），并与设置弹窗“积分详情”复用同一跳转逻辑，统一打开 `/my-credits`（`frontend/src/components/layout/FloatingHeader.tsx`）。
- Flow：节点拖拽新增自动对齐（边缘/中心吸附）与参考线展示，复用图片自动对齐算法 `detectAlignments/deduplicateAlignments`，并接入全局开关 `snapAlignmentEnabled`（`frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/flow.css`）。
- Workspace 设置弹窗：切换左侧分组后，右侧内容区滚动位置会重置到顶部，不再记忆上一次分组的滚动位置（`frontend/src/components/layout/FloatingHeader.tsx`）。
- Canvas：`ImageContainer` 图片操作新增“提取调色板”，点击后按当前图片提取 6 个主色，并在原图右侧生成独立调色板图片（走快速上传链路，最终持久化为远程引用）。
- Canvas 绘制新增 `Shift` 融图交互：在仅选中 1 张图片且使用 `free/line/rect/circle` 绘制时，按住 `Shift` 完成绘制会将图形直接烘焙进该图片（含填充）；本地即时替换后后台上传并自动升级为远程引用，失败时回退保留原始图形（`frontend/src/components/canvas/DrawingController.tsx`）。
- Canvas 绘图面板新增线条样式选项：`实线 / 虚线 / 点画线 / 手绘风（两头粗中间细）/ 手绘风（中间粗两头细）`；手绘风在 `free/line` 下会把中心线转换为闭合轮廓路径，并在 SVG 导出时保留 `stroke-dasharray` / `stroke-dashoffset`（`frontend/src/components/toolbar/ToolBar.tsx`, `frontend/src/stores/toolStore.ts`, `frontend/src/components/canvas/hooks/useDrawingTools.ts`, `frontend/src/components/canvas/DrawingController.tsx`）。
- 管理后台「付费用户」列表新增白名单状态透出：后端 `GET /api/admin/paid-users` 返回 `noWatermark`，前端状态列对白名单用户显示 `VIP`（`backend/src/admin/admin.service.ts`, `frontend/src/services/adminApi.ts`, `frontend/src/pages/Admin.tsx`）。
- Workspace 顶部帮助入口改为悬停下拉：问号按钮不再直接跳转，改为 hover 后显示 `用户手册` 与 `更新日志` 两个链接项（`frontend/src/components/layout/FloatingHeader.tsx`）。
- Workspace 外观设置：新用户默认 `风格样式` 改为 `网格`（`GridStyle.LINES`），用户手动切换后的样式继续按现有本地偏好持久化（`canvas-settings` / `tanva-view-settings`）保留。
- Flow `ImageSplit` 新增“分割模式”配置：支持 `智能分割` 与 `自定义网格`；`自定义网格` 可按 `列×行`（如 `4×2`）固定切分，并自动同步输出端口数量（总数限制 `<=50`）。
- AI 生成分辨率选项调整：Pro（`banana` / `gemini-pro`）重新开放 `1K / 2K` 选择，不再固定 `4K`；聊天面板与 Flow 生成节点（`GenerateNode` / `GenerateProNode` / `GeneratePro4Node`）保持一致。
- Credits: 调整图像编辑/融合计费与名称展示。Ultra（`gemini-3.1-image-edit`/`gemini-3.1-image-blend`）0.5K=20、2K=45；Pro（`gemini-image-edit`/`gemini-image-blend`）1K=40、2K=60；对应服务名更新为 `（Ultra）` / `（Pro）`，以便前端积分流水直接区分模式。
- Credits/API: `GET /api/credits/transactions`（含管理员对应接口）新增返回 `provider` 与 `model`，并继续返回 `channel`，用于前端直接展示“渠道 + 模型”。
- AI Analyze: `POST /api/ai/analyze-image` 计费链路补充 `aiProvider/channelHint` 入库，避免部分图像分析流水缺失渠道信息。
- Frontend `/my-credits`: 交易列表“项目”行新增模型展示，与渠道并列显示（`渠道：X · 模型：Y`）。
- Credits/Video Async：补齐异步视频积分状态收敛链路（新增 `POST /api/ai/video-task-success` 成功回写；`generate-video-provider` 创建失败退款兜底；pending 超时自动退款覆盖视频服务，默认 30 分钟）；`/my-credits` 交易列表新增状态列，`pending` 显示黄色“处理中”。
- Credits/Video Async：新增视频自动退款分界线，默认仅处理 `2026-03-28T00:00:00.000Z` 之后创建的 `pending` 记录（可通过 `CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT` 覆盖，`off/none/0` 关闭），避免上线时历史记录批量退款。
- Flow�?�??�?�??�?��?��?�??�??�?�?�?�?��?��??�?�??叠�?�?保�??�??�?卡�??�?�?�??子�??�?��?��?��?并保�??�?�?�?�??�?��??�?线�?端�?��?��?�?��??�?�??�?��?�?�??叠卡�??�?��?��?示�?�??�?��??缩�?��?��?�?�?`frontend/src/components/flow/FlowOverlay.tsx`�?�`frontend/src/components/flow/nodes/NodeGroupNode.tsx`�?�??
- Flow�?修复�??�?�?��??叠/�?�?�??换�?�?线�?常�?失�??�?��?�?�??叠�?��?�??�?线�?�为 `hidden`�?保�??�??�?edge id�?�?�?�?�?可稳�?恢复�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- �?��?�积�??页�??积�??记�?�?�表格�?��?�??�?��?积�??�?��??�?使�?�每条交�??�?? `balanceAfter`�?�?�?管�?�??�??积�??详�??�?�中�??�?额�?示保�?��?�?��?`frontend/src/pages/MyCredits.tsx`�?`frontend/src/i18n/locales/zh-CN.ts`�?`frontend/src/i18n/locales/en-US.ts`�?�??
- 管�?�?台�?��?��??表�??�??积�??详�??�?�弹�?�?��?�??�?�??积�??�??�?�?�模�?�?对齐�?��?�端积�??�??�?�?示�?项�?�/积�??/�??�?��?��?�/�?�费�?��?��?�?并�?��?�??�?��?积�??�?�?�?��?�?额�?�?��?示�?�?端�?��?管�?�??�??�?��?��?�询积�??流水�?�口�?`GET /api/admin/users/:userId/credits/transactions`�?�??
- Canvas�?�?��??�?�?右侧缩�?��?��?�为项�?�级�??页�??�?�载�?不�?��?��?��??�?�?��?�??史�?`frontend/src/components/canvas/ImageContainer.tsx`�?�??
- Canvas�?�??中�?��??�?步�??AI 对话�?�?��?�?�??使�??`remoteUrl`�?缺失�?��?OSS key 转为可访�??URL�?`frontend/src/components/canvas/DrawingController.tsx`�?�??
- AI 对话�?�?�?�?�?�渲�??�?��?�?��??key 转为可访�??URL�?避�?��?��?`/projects/...` 导�?��?��??空�?��?`frontend/src/components/chat/AIChatDialog.tsx`�?�??
- Canvas�?�?传�??�??�?�确保 `remoteUrl` 为�?�??OSS URL�?�?��?`VITE_ASSET_PUBLIC_BASE_URL`�?�?避�?��??中�?��??只�?��?key�?`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?�?传�??�??�?� `imageData.url` �?�??使�?��?�? URL�?避�?��??中�?�仍落�?� key�?`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?�?��??�??�??�?传�?�?��?�?��?�触�?�?次保�?�?`frontend/src/components/canvas/hooks/useQuickImageUpload.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?�?��?��?传�?��??�?�?��?�??�?�项�?��?��?�??史�?确保�?�?�??表可见�?`frontend/src/components/canvas/ImageUploadComponent.tsx`�?�??
- Canvas�?�?�?�??�?��?传�?�?��?补�??项�?��?��?�??史�?`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?Paper 反序�??�??�?�强�?�对�?�?�?��??走代�?�?避�?�跨�??空�?��?`frontend/src/services/paperSaveService.ts`�?�??
- Flow�?Image �??�?��?��?�??�?�?��?��?�板�?��??�?��?�?��?��?�?�?��?��??�?源�?�?��?�?��?��?��?�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- AI 对话�?�?对话�?�??容�?�右�?�恢复为浏�?�?��?认�?�?�?不�?��?示�?��?�?�?�?�?`frontend/src/components/chat/AIChatDialog.tsx`�?�??
- AI 对话�?�?�??�?�模式�??�?��??�?��?�禁�?�不可�?�项�?�?�?��??�?�提示不�?��?��??�?��??�?��?�并�?��?��??�?? Auto�?`frontend/src/components/chat/AIChatDialog.tsx`�?�??
- AI 对话�?�?�?��?/�?�?�?�源�?�为�?�? URL �?��?�??�?�传�?端�?不�?�序�??�??为 base64�?`frontend/src/stores/aiChatStore.ts`�?�??
- Flow�?Image Split �??�?�运�?�?�使�??`canvas/flow-asset`�?Split �?�不�?�强�?��?�?OSS�?�?保�?�?��??�? `frontend/src/services/flowSaveService.ts` �?��?�补传并�? `inputImageUrl` �?�换为�?�?URL/OSS key�?�?��?�??仍为 `inputImageUrl + splitRects`�?Worker 侧计�?�?��?主线�?峰�?��??
- 设计 JSON�?`Project.contentJson` / `PublicTemplate.templateData` 强�?�禁止 `data:`/`blob:`/base64 �?��??�?�?� DB/OSS�?�?端�?�?+ 提�?�?��?�修复�??�?��?�??
- �?端 AI�?`POST /api/ai/generate-image` 不�?��?�?? base64 `imageData`�?�?�为�?�?OSS 并�?�??`imageUrl`�?�?��?Flow/AI Chat �?�?�已�??�?��?�??
- AI Chat�?并�?�?��??�??�?��?X2/X4/X8�?并�?�?�?�提�?�?� 10�?并�?��?��??�? `VITE_AI_IMAGE_PARALLEL_CONCURRENCY` �?�置�?-10�?�??
- Flow�?�?��??�??�?��?�?�以�?�? URL/OSS key 为主�?Camera/Three/ImageGrid/VideoFrameExtract �?不�?��?��?�?? base64/缩�?��??`flow-asset:`�?�?运�?�?��?�许临�?��?�?��?�?保�?�?��?对 `content.flow` �?�??�?�?��??校�?补传�?�换�?避�?�落�?�??
- 保�?�?�?�?��?��?传�?��??�?�不�?��?��?�?端保�?�?�?�为提示�??�?丢失�?��?并�?�保�? payload 中�?�离�?��?��?��??�?�?��?�?��?面板对�?��?传�?��??�??�?并�?��?��?��?�?传�??
- Canvas�?�?�?�?��??�?�?��??�?��?remote URL / `/api/assets/proxy` / OSS key / �?�对路�?�?�?并�? `<img>`/Paper.js Raster �??�?示源�?�?�?�口�??`frontend/src/utils/imageSource.ts`�?`toRenderableImageSrc`�?�`isPersistableImageRef`�?�`normalizePersistableImageRef`�?�`resolveImageToBlob/DataUrl`�?�??
- Canvas�?�?��?��?传�?��?`blob:` �?�?�?�??�?�??�?��? OSS `key`�?��?台�?传�?�?��??�?�??�? `tanva:upgradeImageSource` �?�??�?�?�?�?�并�??�??`ObjectURL`�?�??
- �?�端 UI�?�?��?�?��?/缩�?��?��?�?示�?�?� `SmartImage`/`useNonBase64ImageSrc`�?�? `data:image/*`/�?base64 渲�??�?�?转换�?`blob:`�?objectURL�?�??�?`canvas`�?�?��?大�?符串驻�??�?�??�?峰�?��??
- �?�端�?�?认禁�??`/api/assets/proxy` �?�?��?源代�?�?�?�为�?��? OSS/CDN�?`VITE_ASSET_PUBLIC_BASE_URL` �?��?� `projects/...` �?key�?�??要代�?�?��?�式设置 `VITE_PROXY_ASSETS=true`�?�??
- �?�端�?�?�?�?��??�?��?�?��?传�?�?�?传�?��??�?离�?页面/�??换项�?�/�??�?��?��?�?�弹�?�确认提示�?�?�??`beforeunload` �?浏�?�?��?��?�?�??�?�??
- �?空�?��?�?�?��?undo/redo �??史并�?�?�?�贴板/�?��?��?�?�?避�?��?空�?仍被�?�快�?��?�?�导�?��??�?不�?��??
- �?端�?�?�?�?��?可�??�? `CORS_DEV_ALLOW_ALL` �?��?跨�??并忽�??`CORS_ORIGIN`�??
- �?端�?�?��??`CORS_ORIGIN=*` �?��?�??�??来源�?�?建议�?��??�?�?�?�??
- �?�端 AI�?`aiImageService` �?�?使�?� `fetchWithAuth` 请�?�?确保工�?��??�?��?�??�??API 注�?��?��?头并复�?��?��?��?��?�?`frontend/src/services/aiImageService.ts`�?�??
- �?�端�?�?请�?�?�?��?��?�口�?� `fetchWithAuth`�?�?�?�?��?�?401/403 �??�?��?��?�?并为�?��?/第�?�?�请�?提�?`auth: "omit"` �?`credentials` �?��?��?`frontend/src/services/authFetch.ts` �?�?�??
- �?端 AI�?Seedance�?doubao�?�?�?任�?��?��??�?�?��?��?传�??OSS�?�?�?�??�?��?? OSS �?��?�?��?��?避�?��?�?TOS �?��?��??CORS/�?�??�?��?�??

### Fixed
- Flow Image 节点：修复“上传失败后刷新出现幽灵图”。上传失败时会回滚预分配但未落地的 `imageUrl(key)`，避免把不存在的 OSS key 持久化；同时将 `uploading=true` 且携带图片数据的节点视为不可持久化，阻止自动保存在上传未完成时写入不稳定引用（`frontend/src/components/flow/nodes/ImageNode.tsx`, `frontend/src/utils/projectContentValidation.ts`）。
- Flow：`Image Split` 读取 `seedream5` 上游时补齐 `imageUrls/images` 兜底，并将分割加载源改为“强制代理优先、直连回退”候选策略，修复 Seedream 外链图在分割节点报“图片加载失败”（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Flow：`Analysis` 节点输入解析改为多候选回退（`imageData/imageUrl/outputImage/thumbnail`）并在裁切链路支持多 baseRef 尝试；同时 `resolveImageToDataUrl/resolveImageToBlob` 对白名单远程 URL 增加“强制 `/api/assets/proxy`”候选兜底，修复线上偶发 `图片加载失败/缺少图片输入`（`frontend/src/components/flow/nodes/AnalyzeNode.tsx`, `frontend/src/utils/imageSource.ts`）。
- Flow：`Image Split` 切片缩略图预览增加“代理优先 + 原地址回退”加载策略，移除跨域 `anonymous` 的硬依赖，并允许缺失 `sourceWidth/sourceHeight` 时按天然尺寸回退渲染，修复“已分割但缩略图全灰块”（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Canvas：重做图片裁切执行链路并修复偶发“像被压缩/低清/裁切不可用”。`ImageContainer` 裁切改为按实时源解析 Blob 后再裁切（不依赖缓存 dataURL 输入），本地预览走 `blob:` + 后台上传回写远程引用；裁切开始即预分配新 OSS key 并清理上传中旧 `remoteUrl`，避免回写竞争把图切回旧源；同时回写尺寸改为按 X/Y 独立缩放，`imageUrlCache` 新增图片源指纹命中策略，避免同一 `imageId` 更换源图后误用旧缓存（`frontend/src/components/canvas/ImageContainer.tsx`, `frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/services/imageUrlCache.ts`）。
- Flow：`Generate` 节点顶部输入缩略图现在会识别 `Image/ImagePro` 的 `crop` 以及 `ImageSplit(splitRects)`，按裁切区域预览，避免视觉上误判为“传的是整图”；运行时传参逻辑保持按裁切结果处理（`frontend/src/components/flow/nodes/GenerateNode.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`）。
- Flow：`Generate` 节点读取连线输入预览时改为优先使用 `imageData/inputImage`（运行时资源）再回退 `imageUrl/inputImageUrl`，修复“已连线时上传/替换图片后缩略图不立即更新”的问题（`frontend/src/components/flow/nodes/GenerateNode.tsx`）。
- Canvas/LayerPanel: canvas selection now back-syncs to layer panel highlight for image/model/path, with auto-expand/activate of the owning layer (`frontend/src/components/panels/LayerPanel.tsx`, `frontend/src/components/canvas/DrawingController.tsx`).
- Flow/TextNote: 非编辑态下文本便签中心区域恢复可直接拖拽移动（不再仅边缘可拖），仅双击进入编辑态（`frontend/src/components/flow/nodes/TextNoteNode.tsx`）。
- Flow/TextNote: 文本便签四边连接句柄改为默认隐藏且不可交互（不再自动弹出可连接节点面板），并将便签背景统一为淡土黄色（`frontend/src/components/flow/nodes/TextNoteNode.tsx`）。
- Payment: 修复支付宝充值回调空实现导致的漏入账；新增回调体解析、主动查询核对、手动确认补单与过期订单清理，降低“第三方已支付但前端/积分未更新”风险。
- 2D�?D�?修复混�??submit �?�?��?�容�?�?�??使�??`ImageUrl` �?符串并�?�?��?种 payload �??�??�?避�??`Code:1001 Invalid param`�?`backend/src/ai/services/convert-2d-to-3d.service.ts`�?�??
- 2D�?D�?�?�?��??工�?�栏�??�??D�?D�?��?端�?�?��??换为混�??�??D�?submit/query 轮询�?�?保�?��??�??�?�端交�?�?�?��?D�?�?�?�流�?不�?�?�?�?模�??�??�?�来源�?�换为混�??�?�口�?`backend/src/ai/services/convert-2d-to-3d.service.ts`�?�??
- 2D�?D�?修复混�??�?�??模�??�?��?�板 3D 容�?�中�?�载失败�?CORS�?�?��?�?`Model3DViewer` 对�?�?模�??URL 强�?��?`/api/assets/proxy`�?�?��?端代�?�?�名�?�?��?�?��?COS �??名�?`q-sign-*` �?签名�?�?��?�?��?`frontend/src/components/canvas/Model3DViewer.tsx`�?�`frontend/src/utils/assetProxy.ts`�?�`backend/src/oss/oss.service.ts`�?�??
- 2D�?D�?�?端模�??URL 提�?�?�为�??�??格式�?�??级�??�?��?��?�?�?? `glb/gltf`�?`zip` �??�?�?�?�?��?�?�??�??缩�??�?��?导�?��??�?�端模�??�?�载�?常�?`backend/src/ai/services/convert-2d-to-3d.service.ts`�?�??
- Flow�?恢�?`klingVideo` �??史�?线�??`targetHandle=audio` �?�容句�??�?修复�?�项�?��?�载�?��?� React Flow `error#008`�?`frontend/src/components/flow/nodes/GenericVideoNode.tsx`�?�??
- Canvas 保�?�?`paperSaveService` �??Paper �?�就绪�?�不�?��?�?? `paperJson`�?避�?��?常�?��?�?�板�??容�??空快�?��?��??�??并�?��?��?��??丢失�?`frontend/src/services/paperSaveService.ts`�?�??
- 3D 模�??�?载�?�?�?模�??�?��?��?载�?��?�?强�?��?`/api/assets/proxy`�?修复混�??�?��?COS `q-sign-*` �?��?��?载�??CORS 失败�?`frontend/src/utils/downloadHelper.ts`�?�??
- AI 对话�?�?修复 AUTO 模式工�?��??�?��?��?��?�卡�?��??�?��??中�?��?��?�?Banana 工�?��??�?��?�?� 20s �?�?��?快�??�??�?�?�?�?� `tool-selection` �?�?走�??�?�模�??解�?��?�路�?`backend/src/ai/providers/banana.provider.ts`�?�`backend/src/ai/ai.controller.ts`�?�??
- AI edit-image: stop auto-retrying on `NETWORK_ERROR` for long-running edit requests, preventing repeated long waits and duplicate retry calls after downstream/proxy connection close; also accept `imageUrl` as a valid success result in edit API mapping (`frontend/src/services/aiBackendAPI.ts`, `frontend/src/services/aiImageService.ts`).
- Canvas: fix refresh-time false image lock that made some images non-draggable/non-deletable; recovery now trusts explicit imageLocked/snapshot.locked only, and Delete gets an imageId-based fallback path (frontend/src/components/canvas/DrawingController.tsx, frontend/src/components/canvas/hooks/useImageTool.ts, frontend/src/components/canvas/hooks/useInteractionController.ts).
- Flow�?恢复�?线�??�?��?��??中 + Delete �?��?��?��?为�?修复 `pointer/marquee/select` �?�?线�?��?�被误�?�为空�?��?�??起�?��?并�?��?�?线�?��?��?�式�??中�?Delete/Backspace �?��?�已�??�?线�??�??�?�?��?�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Referral�?�??请码�?��??请�?�?�达�??10 人�?继续可�?�并继续记�?�??请�?�系�?�?�?止�?��?�??请积�??�?�?��?�?不�?��?�??�??已达�?�??�?��??�?�类�?�?�提示�?`backend/src/referral/referral.service.ts`�?�??
- Backend�?�?��??Kling �?�?�??�?�对�?�??�?�?�??模�??�??换�?kling-v2-1�?�?��?Kling 2.6 / Kling O3 �?��?保�?�不�?�?backend/src/ai/services/video-provider.service.ts�?�??
- Flow�?�??�?�弹�?�?��?�?��?端�??�?��?�置�?��?�?�为�??�?�?�??�?�??Flow �??�?�类�??�?��?�并�?�??使�?��?端�?�据�?避�?��?�端 fallback �?�?端�?�置叠�?��?�?��?��?�复�??Kling �??�?��?frontend/src/components/flow/FlowOverlay.tsx�?�??
- Flow�?�?��??Kling 2.6 �??�?��?�口�?不�?��?��??�?�弹�?�?快�??�?�?��?�?中�?�示�?�?�端�?认�??�?��?�置�?�?步移�?�该项�?frontend/src/components/flow/FlowOverlay.tsx�?�frontend/src/services/nodeConfigService.ts�?�??
- Flow�?修复�??�?�弹�?中 Kling 系�??�?�置名�?�正确�?��?�??Flow �??�?�类�??�?��?�?��?��?�?��??�?��??建�??�?��?�?�?��? Kling / Kling 2.6 / Kling O1 / Kling O3 �?�名�?�容�?frontend/src/components/flow/FlowOverlay.tsx�?�??
- Flow�?修�?`Seedream` �??�?�左侧 `image` �?�?�句�??被容�?�校�?�??误�?��?��?�?�可正常�?�?��?��??�?�?�句�??�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Flow�?修�?`Seedream` �??�?�中�??�??�?乱码�?帮�?�说�??�?��??�?�提示�?��?�?�?��?尺寸�?�??�?签�?�?并�?尺寸�?签�??�??�?�?�?ASCII �??�?��?避�?��?常�?符�?�示�?`frontend/src/components/flow/nodes/Seedream5Node.tsx`�?�??
- Flow�?�?�??�?页�?��?�?�项�?��?��?�??�?��?屏缩�?��?��?��??viewport �?步修正�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Canvas�?�?�??�?页�?��?�?�项�?��?�?Paper �?��??�?�中/�??�?�偶�?失�??�??恢复�?��?�?`frontend/src/components/canvas/DrawingController.tsx`�?�`frontend/src/utils/paperCoords.ts`�?�??
- Flow�?�??�?��?�路�?�许传�??�?�?URL�?�?��?端�?载�?�?�?�?避�?�端跨�??读�?失败�?`frontend/src/components/flow/FlowOverlay.tsx`�?�`backend/src/ai/ai.controller.ts`�?�`backend/src/ai/dto/image-generation.dto.ts`�?�??
- AI 对话�?�?�?��?�?�混�?来源�?��??�??�?传�?��?��?源�?��?�?�?URL�?避�??CORS �?base64 序�??�??失败�?`frontend/src/stores/aiChatStore.ts`�?�??
- Flow�?Generate �?�?�解�?��?�??使�?� Image �??�?��?�?�渲�??�?�据�?并�??proxy �??�?失败�?�使�?�带�?��?�??�?�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Flow�?MiniMap 即�?��?�示�?��??占位�?导�?��?�?�即触�?�?�建并�?�导�?��?��?��?��??�?触�?�?`frontend/src/services/paperSaveService.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Flow�?�?��?��? MiniMap �?��??占位不�?�示�??�?��?�?反序�??�??�?�?�即触�?�?�建�?件�?并�?��?�建失败�?��??�??�?�快�?�种子�??�?`frontend/src/services/paperSaveService.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�`frontend/src/components/canvas/hooks/useImageTool.ts`�?�??
- Flow�?MiniMap �?��??/�??�?��?�?�?��?��?��?可即�?��?��?��?�?�为�?件驱�?�并保�??1s �??�?轮询�?`frontend/src/components/flow/MiniMapImageOverlay.tsx`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Flow�?MiniMap 不�?��?��??�?��?��?�??�?��?��?��?��?保�?��?�续可见�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Flow�?修复�?��??�??�?�裁�?��?�?尺寸读�?�?�?��?缩�?�影�?��?导�?��?��?��?�?�?被�?�大�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Worker �?��??�?传�?主线�?�?�传 access token�?OSS presign 请�?携带 Authorization�?避�?�跨�?401�?`frontend/src/services/imageUploadWorkerClient.ts`�?�`frontend/src/workers/imageUploadWorker.ts`�?�`frontend/src/services/ossUploadService.ts`�?�??
- �?�端�?��?�?`fetchWithAuth` �?�?� Authorization 为空�?�注�??access token�?避�?�空�?��?��?�注�?��?`frontend/src/services/authFetch.ts`�?�??
- Worker �?��??�??�?��?�??�?主线�?�?�传 access token 并�?� Worker 请�?中补�?Authorization�?避�?�跨�?�?源�??�?401�?`frontend/src/services/imageSplitWorkerClient.ts`�?�`frontend/src/workers/imageSplitWorker.ts`�?�??
- �?�端 AI�?`aiImageService` �?��?��?话�?�补�??`refresh_token` Authorization 头�?避�?�跨�?�?依�?cookie 导�?� 401�?`frontend/src/services/aiImageService.ts`�?�??
- AI 对话�?�?�??中�??�?��?�右�?��?�许浏�?�?��?认�?�?�?确保可复�?��??中�??�?��?`frontend/src/components/chat/AIChatDialog.tsx`�?�??
- Flow�?Image �??�?��?�?��?��?�板�?�以�?�?�渲�??�?源为�??�?含 `crop`/ImageSplit �?�?裁�?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?��?��?�?游�?�?��?��?保�??�?�?�裁�?�渲�??�?��?��?避�?��??�??�?��?��?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?�裁�?��?�?�?�为�?�??�?�容�?��?�?�?中�?�示�?避�?��??�?��??�??�??�?�?尺寸�?常�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?�裁�?��?�?使�?��??�?裁�?��??辨�??�?�?�并缩�?��?示�?避�?��?�?保�?�?��??辨�??�?小�?模�?�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?�可�??�?解�?��?游 Image �?�路中�??裁�?�信息�?避�?��?��?�路�??�??�?��??�?�?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?ImageSplit �??�? Image �?�路�?�?��?��??�?解�?��?游裁�?�信息�?避�?��??�??�?��??�?��?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?ImageSplit �?��?�裁�?��?�?? Image �??�?��?�?��?�可�??溯�?游解�?� baseRef�?确保�??裁�?��?�??�??�?��??�?�??�?��?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?ImageSplit �?�?��?�?�?��?游为裁�?��?�路�?��?�??�?�示裁�?��?�?并�?�?临�?��?�?��??�?好�?避�?��??�?�示�?��?��?跳�?�?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?Image �??�?��??换�?�?��?线�?��?�?�?� crop�?避�?�复�?��?�裁�?��?�??�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- Flow�?Image �??�?��?�?游读�?�?��??�?��?�??�?�?��?线�?避�?��?游�?��?��?�?游不�?��?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image �??�?��?�?��?��?�板�?��?�??`crop`�?�?�?�裁�?��?�??�??�?�??�?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Analysis �??�?��?��?�?�?��?线�?��?�?�?�??�?��??�?�据�?避�?��?�?仍�?�示�?��?��?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�??
- Flow�?Analysis �??�?��??Image�??Image�??Analysis �?�路中可�??�?�?�?��?游 `crop`/`ImageSplit`�?避�?��??�??�?��?��?��?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�??
- Flow�?Analysis �??�?��?��?�?Image �?�?�?示�?��?继续�??溯�?��?�?�来渲�??�?�?�?避�?��?��?空�?��?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�??
- Flow�?Image �??�?��?��?�?��?��?游 Image/ImagePro �?��?�?�??使�?�源�??�?��?�身�?��??并�?��?�读�?�??`crop` �?裁�?��?�?�?避�?��?�路传�??�?�?��??空�?��??�??�??�?��?��?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?ImageSplit �??�?� Image �??�?��?��?�??使�??`inputImageUrl/inputImage` �?为�?��?�?�?��?误�?��?游缩�?��?�导�?��??�?�?�度�?�?��?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?ImageGrid 读�? Image/ImagePro �??�?��?��?�??�?�??`crop`�?避�?��?游仍使�?��?��?��?`frontend/src/components/flow/nodes/ImageGridNode.tsx`�?�??
- 项�?��??容�?�载�?�?�端对�?项�??`GET /api/projects/:id/content` �?并�?�?��?��?�?端 OSS �?��?��?禁�?��?�跳�?读�??并设置�?�?��?�?��?�?�复�?载�?�?��?��?�卡顿�??
- �?端 AI�?工�?��??�?��?��?解�?��?�稳健�?�?��?��?��?�?�??�?�/markdown code fence/尾�?��??号/松�?� key:value/�?�??�?�提�?工�?�名�?�?避�?�误�?�级�?� chatResponse�?`backend/src/ai/tool-selection-json.util.ts`�?�??
- AI 对话�?�?工�?��??�?��?�段�??�?示�??正�?��?��??中...�?�占位提示�?并复�?��?次工�?��??�?��?�??避�?��?�复请�?�?`frontend/src/stores/aiChatStore.ts`�?�??
- AI �?��??�?�?�?`generate-image` 对�??空�??�?�?格式�?��?��?��?�?次请�?�??�?��?��?��?�?�??�?3 次�?�?并�?空�??�?�?格式�?�?�?为 502�?BadGateway�?�?�?�端保�??�??�?�?��?�?�?��?对话�? X4 模式偶�?只�??�??3 张�??�?��?�?`backend/src/ai/ai.controller.ts`�?�`frontend/src/services/aiBackendAPI.ts`�?�??
- Assets Proxy�?`GET /api/assets/proxy` �?�?��?��?�?�?�主�?� cancel �?�?个�?��?�?�?客�?�端中�?��??abort �?游 fetch 并�?�?��?�?流�?避�??`ReadableStream is locked` �?��??�?�?��?�?�?�?��??代�?�?�??�??�?�?�?�占�?��??
- Flow�?Analyze/�?�??�?��??�?�?�?�?��??�?�使�??`credentials: omit`�?避�?�跨�??�?�署�? `/api/assets/proxy` �??`Access-Control-Allow-Origin=*` �?`credentials: include` �?�突导�?�浏�?�?��?��?��?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�`frontend/src/components/flow/FlowOverlay.tsx`�?�??
- �?�端�?��??转码�?�?��?�?��?并�?�?�流�?�??�?10�?�?�?�口�?��??�??�?�/转�??�?`canvas.toDataURL/toBlob`�?�`FileReader.readAsDataURL`�?�`Response.blob`�?�`createImageBitmap/WebCodecs` �?�?并�?� AI Chat/Flow/�?��?�?�?�路复�?��?�?��?�?�?��?��?��?��?��??�?峰�?��?卡顿�??
- �?��?��?`AutoScreenshotService` �?�?� Raster �?��?�?��??确�?跨�??�?�?�设�?crossOrigin�?��?��?��?��?�载�?��??�?避�?��?�?`/api/assets/proxy` �?源被�?�复请�?导�?��??�?�口�?�屏�?�??�?�??�?��??
- Canvas�?保�?`paperJson` �?��? `*/api/assets/proxy?...` 反解�?remote URL/OSS key�?避�?��?? `http://localhost:5173/...` �?运�?�?�代�?�?��?落�?�??
- Canvas�?修复反序�??�??�? `Raster.source` �?为 `<img>.src` 导�?� OSS key/�?�?�?�?��?�被正确�?�?��?代�?�?�?��?��?��??空�?��?`frontend/src/services/paperSaveService.ts`�?�??
- 保�?�?�?端保�?�?��?额�?�?�?`aiChatSessions`/`assets.images` 中�?�??�?? `data:`/`blob:`/�?base64�?含 `localDataUrl/dataUrl/previewDataUrl`�?�`imageData/thumbnail` �?�?�?避�?��??�?��??�?空�?仍携�?dataURL�?�导�??payload �?大�??落�?污�??�??
- Flow�?Image Split �??�?��?�?��?�??�??�?��??�?��?�不�?�置灰�?�?��?��?��? `splitRects` �??�?� Image �??�?�并�?� Image �??�?�运�?�?�裁�?��?�?�?不落�?�?�??
- Flow�?Image Split �??�?��??Image �??�?�裁�?��?�?�?�右�?�保�?导�?��?�不�?��??�?contain �??�?��?�边�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- Flow�?Image Split �?�置恢复为�??�?�?�端口�?��??1-50)�?�语�?�?�?格�??�??�??端口�?��?��?��?�导�?�?�?2048x2048 �?512x512 �??�??可设 `16`�?�?`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?Image Split�?Worker �?格�??�??�?不�?�对�??�??�?�??�?��?�边裁�??�?��?并保证�?�?��?��?�严格�?�?端口�?��?避�?��??�??尺寸被裁小/�?��?��?移�?`frontend/src/workers/imageSplitWorker.ts`�?�`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?Analysis �??�?��?��?�解�?� Image Split / Image(crop) �??裁�??�?�?��?�?�?��??�?��?�口�?��?�?�?��??�??�?��?�??�?�?��?��?�?并保�?��??�??�??辨�??�?尺寸正确�?`frontend/src/components/flow/nodes/AnalyzeNode.tsx`�?�`frontend/src/components/flow/nodes/ImageSplitNode.tsx`�?�??
- Flow�?修�?Image Split �??�??�?��?游裁�??�?��?�?�误�??解码�?�?�素尺寸导�?��?导�?�只�?�载�?�缩�?��?��?��??辨�??被�??缩�?�?�? 2048->400 �?1024 �??�??�?200�?�?并�?��?边�?�?�边�?�??�?`frontend/src/components/flow/FlowOverlay.tsx`�?�`frontend/src/components/flow/nodes/ImageGridNode.tsx`�?�??
- Flow�?�?�?�??�?��?�??�?��??�?线解�?��?�?��?� Image Split �??�??�?为�?�?��??
- Flow�?Image Split �??�?��??Image �??�?��?`crop`�?�?��?游运�?�?��??裁�??�?�??传�?�?避�?�仍使�?��?�?��??�?��??
- Canvas�?修复�? OSS key/proxy/path 误�?��?base64/�?�?传导�?��?��??置灰�??�?��?�?含快�??�?传�?�导�?��?�建�?�?�?��?�?缩�?��?��?�?载�?�路�?�??
- Canvas�?AI �?��??占位符�?级为�?�? URL �?��??�?�?�载�?��??换�?避�?��?��?�?��??�??�?��?��??�?��??
- Canvas�?�?��??�?级�??�?`Raster.source` �?�?即恢�?`bounds`/�??�?��??素�?避�??Paper.js �?��??�?�置尺寸导�?��??�?��?��??
- Canvas�?�?传中�?��??�?�许�??�?�移�?��?�?禁�?��?�?/�?�?�?�?��?�?避�?�误触�?�??
- Canvas�?修复误�?`HTMLImageElement` 传�? `Raster.source` 导�?��?�?� `[object HTMLImageElement]`�?�?传�?�?��?�?��??�?�载失败/�?失�?`frontend/src/components/canvas/PaperCanvasManager.tsx`�?�`frontend/src/components/canvas/hooks/useQuickImageUpload.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- Canvas�?修复�?传�?��??�?�?��?�??`ObjectURL` 误�?��?�使�?�被提�?��??�?��?导�?��?��??�?失�?��?��?��?�?�恢复�?�示�??�?��?�?`frontend/src/services/paperSaveService.ts`�?�`frontend/src/components/canvas/DrawingController.tsx`�?�??
- �?�端�?��?�?补齐�?��??�?��?请�?�?�触�?�?��?��??�?��??�?��?�?�?�?�??`fetchWithAuth`/`triggerAuthExpired` �?�? 401/403�?并�?��?��?失�??�?��?�?�?��?��?话�?�?�?`frontend/src/services/authEvents.ts`�?�`frontend/src/services/authFetch.ts`�?�??
- �?�端�?��?�?`fetchWithAuth` �??refresh �?�??�?��??�?�?��?仍 401/403 �?��?�?触�?`triggerAuthExpired`�?避�?��?��?��?��?401 �?�?�跳转�?��?�??�?��?�?`frontend/src/services/authFetch.ts`�?�??
- Flow�?禁�?��??�?��??�?��?��??�?��?�平移�?`autoPanOnNodeDrag`�?�?并�?� `dragStop` 强�?��??�?步�?口�?避�?�快�??�??�?��??�?��?��?口�?移导�?��?��?�??�?��?��?偏移�??
- Flow�?�?维�??�?��?`ThreeNode`�?�?传模�??�?�?��?��?中�?��?��?并�?模�??URL �?��?�??为�?�?�?�?��?避�?��??�?resize �?模�??丢失�??
- Flow�?�?维�??�?��?`ThreeNode`�?�?��??�?� resize �??canvas 保�?��?�满�?�??�?��?�?中不�?�?`setSize` 避�?��?��?��?�??�?��?�?�?�?次�?��?�?renderer 并即�?�渲�??�??
- Flow�?修复�?��??�??�?�渲�??�?� `uploading/uploadError` �?��?�?导�?��??�?�屏崩�?�?`frontend/src/components/flow/nodes/ImageNode.tsx`�?�??
- 项�?��?�?��?�?�??�??�??访�?�项�?��?��?�??�??项�?�不�?�?��?��?404�?�?触�?�?�端�?�?�?��?? `projectId` �??容�??�?��?�?避�?�误�?��?��?失�??�?`backend/src/projects/projects.service.ts`�?�??
- Flow�?模板导�??保�?�?��?��?`flow-asset:`/`blob:`/OSS key/`/api/assets/proxy?...` �?�?��??�?�?��?�?�??为可�?��?�??�?�?��?并�??Image Split 模板中迁�?`splitImages` -> `splitRects`�?避�?��?��?�模板�?��??缺失�?`frontend/src/components/flow/FlowOverlay.tsx`�?�??

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.

## [Stability Note - 2026-03-20]
- Added frontend runtime stability bootstrap with storage schema guard, build version polling, and global runtime error capture/reporting.
- Added backend telemetry endpoint POST /api/telemetry/frontend-error for collecting frontend runtime failures.
- Hardened deployment cache behavior for index.html and version.json, and aligned frontend builder dependency installation.
- Kept autosave debounce at 5 seconds and added a minimum persisted save interval (15s) to reduce high-frequency write pressure.
- Added backend per-project serialized save execution and duplicate-content hash short-circuit to reduce save write amplification under concurrency.



- Added Object.hasOwn polyfill during frontend bootstrap to avoid white-screen crashes on legacy Edge builds.


- Flow: added `threePathTracer` node entry (3D PathTracer) and integrated optional `three-gpu-pathtracer` mode in `ThreeNode` with raster fallback on init/render errors.
- Flow: `ThreeNode` ? changing BG / light sliders no longer disposes the whole WebGL context; PathTracer load gap falls back to a raster frame (`requestRender`).
- Flow: quick-connect pins base targets first (`textPrompt` for text, `image` for image) while keeping usage-based ranking for the rest (`FlowOverlay.tsx`).


- 3D canvas interaction tuning for Mac trackpads: reduced OrbitControls rotate/zoom/pan sensitivity, lowered Model3DViewer max DPR to 1.25, and slowed camera-state sync frequency to reduce zoom overshoot and interaction stutter (frontend/src/components/canvas/Model3DViewer.tsx).

- Model3D canvas performance alignment with ThreeNode: switched Model3DViewer to demand-driven rendering (`frameloop="demand"`), removed always-on preserveDrawingBuffer, capped DPR at 1, and changed model move/resize persistence to commit only once at transform end to avoid per-frame history/autosave stalls (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/hooks/useModel3DTool.ts`, `frontend/src/components/canvas/DrawingController.tsx`).

- Model3D drag/resize now uses local preview updates during pointer move and commits to Paper/state/history only on pointer-up, reducing whole-canvas jank during transform (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/hooks/useModel3DTool.ts`, `frontend/src/components/canvas/DrawingController.tsx`).

## [Stability Note - 2026-03-21]
- Backend: reduced `/api/ai/text-chat` 500s under DB pressure by hardening credits scheduler and Prisma pool handling.
- Added non-overlap locks for credits cron jobs to avoid concurrent job pile-ups.
- Moved credit anomaly detection from every 5 minutes to hourly.
- Mapped Prisma connection-pool timeout (`P2024`) to `503 ServiceUnavailable` with retryable message.
- Reduced stale pending auto-refund default batch size from 200 to 100.
- Added Prisma index `ApiUsageRecord(responseStatus, serviceType, createdAt)` for stale pending scans.

- Model3D interaction smoothing follow-up: camera persistence now commits only at OrbitControls end (not during onChange), and Model3DViewer uses a lighter light rig to reduce shader cost on dense 2D->3D assets (`frontend/src/components/canvas/Model3DViewer.tsx`).

- Canvas 3D container now supports one-click conversion to Flow `three` node, auto-placing the node near the model and patching `modelUrl/modelName` for immediate loading (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`).

- ThreeNode performance guard during canvas image drag: skip non-essential Three.js renders while `tanva-canvas-dragging` is active, avoid redundant OrbitControls update loop on `change`, and trigger a single redraw on global mouseup to reduce drag-frame drops when 3D nodes are present (`frontend/src/components/flow/nodes/ThreeNode.tsx`).

- Gesture routing fix for 3D areas: global/Flow wheel-zoom capture now bypasses Flow `three` viewport and canvas `Model3DContainer`, so two-finger zoom inside 3D focuses on model controls instead of canvas zoom; plus freeze Flow 3D WebGL viewport visuals during canvas image dragging to reduce compositing overhead (`frontend/src/components/canvas/GlobalZoomCapture.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/nodes/ThreeNode.tsx`, `frontend/src/components/flow/flow.css`).

- Refined 3D zoom gesture routing with robust hit detection (`target` + `composedPath` + `elementFromPoint`) so Flow `three` node pinch/ctrl-wheel no longer falls through to canvas zoom when event targets are retargeted by browser/input drivers (`frontend/src/components/canvas/GlobalZoomCapture.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`).

- Canvas image-drag optimization for in-canvas 3D containers: add dedicated `tanva-image-dragging` state, suspend `Model3DViewer` rendering while image drag is active, and temporarily disable pointer events/visual updates for canvas 3D overlays to reduce drag jank (aligned with Flow ThreeNode freeze strategy) (`frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/index.css`).

- Reduced canvas drag rerenders around in-canvas 3D: memoized `Model3DContainer` and `Model3DViewer` with structural prop comparators (ignoring callback identity churn), plus `contain: layout paint` on container root so image/model drags do not repeatedly re-render 3D viewers when bounds/model data are unchanged (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`).

- Restored previous in-canvas 3D interaction chrome visibility (corner handles/border no longer clipped) by removing container paint containment, while keeping 3D content render suspended during model move/resize (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`).

- Drag UX/perf refinement for canvas 3D containers: when render is suspended (image drag or model move/resize), keep a visible static frame snapshot instead of blank viewport, and reduce per-move state churn by avoiding `realTimeBounds` state writes on every move tick (final bounds still committed on mouseup) (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/index.css`).
- Canvas 3D container resize/drag performance follow-up: `Model3DContainer` now subscribes only to `zoom/panX/panY` (instead of the full canvas store) to avoid unrelated high-frequency rerenders during image drag; `Model3DViewer` drops unused `width/height` props from memo comparison so resizing the 3D container no longer forces per-tick viewer rerenders, and suspended-frame snapshots are now reusable across drag/resize cycles (with tainted-canvas capture guarded) to reduce start-of-drag stutter (`frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D drag/resize visual fallback: `Model3DViewer` now pre-warms a reusable suspended frame after model load, and when frame capture is unavailable it falls back to an inline SVG thumbnail card (model name + 3D marker), so moving/resizing 3D containers no longer appears as blank while rendering is suspended for performance (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D suspended-preview reliability fix: replaced `data:image/svg+xml` fallback with a pure DOM/CSS placeholder card (still prefers captured frame when available) to avoid blank states in environments where `data:` image sources are blocked or sanitized during drag/resize suspension (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D camera-save and WebGL lifecycle fix: `model3d-camera` autosave/history now only schedules when camera state actually changes (deduped via current instance ref), and camera sync callbacks are muted during container move/resize/image-drag to avoid transform-induced camera saves; `Model3DViewer` now skips initial camera persistence emit and force-releases WebGL renderer/context on unmount (`forceContextLoss`) to mitigate accumulated active-context warnings (`frontend/src/components/canvas/hooks/useModel3DTool.ts`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D capture white-image fix: before camera capture, request target `Model3DViewer` to refresh and publish a cached frame; screenshot pipeline now prioritizes this cached frame (`img[data-model3d-snapshot-cache="true"]`) and only falls back to raw WebGL canvas, avoiding blank captures under `frameloop="demand"` + non-preserved drawing buffers (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/canvas/Model3DContainer.tsx`, `frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/services/AutoScreenshotService.ts`).
- Dev-console cleanup for 3D viewer teardown: avoid calling `forceContextLoss` during DEV/HMR unmount cycles, and in PROD only call it when WebGL context is not already lost (`isContextLost` guard), eliminating noisy `WebGL: INVALID_OPERATION: loseContext: context already lost` logs while retaining production context-leak protection (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas refresh persistence hardening for 3D containers: in `tanvaPaperRestored` flow, added explicit 3D runtime rehydrate fallback from `assets.models` when Paper project has no usable 3D groups; `rebuildFromPaper` now restores 3D bounds from placeholder path, group bounds, or `data.bounds` fallback (instead of requiring a specific child path), and `setModel3DInstances` gained structural no-op guard/clear logic to avoid unnecessary repeated updates that could contribute to React update-depth loops (`frontend/src/components/canvas/DrawingController.tsx`).
- Canvas 3D moving/resizing visual stability upgrade: `Model3DViewer` now rejects likely-blank WebGL frame captures, asynchronously pre-generates a real model preview via `model3DPreviewService`, and uses `suspendedFrame || modelPreviewFrame` as the suspended visual/cache source; this ensures drag/resize displays a model thumbnail instead of blank even when demand-render WebGL buffer capture is empty (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D interaction policy alignment with Flow ThreeNode: moving/resizing in-canvas 3D containers no longer enters suspended-thumbnail mode; model viewport stays visible during transform while OrbitControls remains disabled during drag/resize. Suspended preview is now reserved for explicit external suspension (e.g., image-drag performance guard) (`frontend/src/components/canvas/Model3DViewer.tsx`).
- Canvas 3D/Flow ThreeNode external-drag policy update: while dragging other 2D images (`tanva-image-dragging`), both canvas 3D containers and Flow ThreeNode viewports now stay blank (no visible thumbnail fallback), while keeping hidden frame cache only for screenshot capture reliability (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/flow/flow.css`).
- Canvas image-drag visual policy refinement: 3D containers and Flow ThreeNode now keep the current frame visible (instead of forcing blank) while other 2D images are dragged; render loops are still gated under `tanva-canvas-dragging`/`tanva-image-dragging` (including PathTracer sample loop), preserving drag FPS while avoiding abrupt blanking (`frontend/src/components/canvas/Model3DViewer.tsx`, `frontend/src/components/flow/nodes/ThreeNode.tsx`, `frontend/src/components/flow/flow.css`, `frontend/src/index.css`).
- Flow ThreeNode interaction polish: increased `NodeResizer` invisible hit area (22px) to make resize/scale handles easier to grab, removed paint containment clipping on ThreeNode root, and lifted the image output handle to a dedicated high z-layer so it stays visible above node content/resizer overlays (`frontend/src/components/flow/nodes/ThreeNode.tsx`, `frontend/src/components/flow/flow.css`).
- Canvas 3D white-capture fix: `Model3DViewer` now forces a same-camera render before capture and can fall back to an offscreen renderer for explicit camera captures; runtime snapshot payload now carries `frameDataUrl` and source tag, while `AutoScreenshotService` only consumes runtime snapshots and skips near-blank WebGL fallback frames to avoid inserting white rectangles.

## [Credits Patch - 2026-03-21]
### Changed
- Backend credits now apply `resolutionPricing` to any service that defines this pricing block (not only `*-image` service types).
- Seedream 5.0 (`doubao-seedream-5-0-260128`) now correctly deducts 60 credits when `imageSize=4K`.
- Added 4K pricing for Pro and Nano banana 2 edit/blend services:
  - `gemini-image-edit`: 4K -> 60 credits
  - `gemini-image-blend`: 4K -> 60 credits
  - `gemini-3.1-image-edit`: 4K -> 60 credits
  - `gemini-3.1-image-blend`: 4K -> 60 credits
- Non-4K edit/blend pricing remains unchanged at 30 credits.
- Correction: Pro mode 4K edit/blend pricing is 120 (not 60): `gemini-image-edit` 4K -> 120, `gemini-image-blend` 4K -> 120.

## [Flow Patch - 2026-03-21]
### Fixed
- Flow `runNode` image input resolution now falls back across multiple image candidates (instead of stopping at the first failed value), reducing intermittent `viewAngle` failures with error `缺少图片输入` when a stale temporary image ref exists but a valid `imageUrl` is also present (`frontend/src/components/flow/FlowOverlay.tsx`).

## [Language Provider Patch - 2026-03-21]
### Added
- Admin 设置页新增 `banana_text_provider`（Banana 语言链路供应商切换），支持 `auto`、`legacy_auto`、`apimart`、`legacy`。

### Changed
- Backend `BananaProvider` 文本链路（`/api/ai/text-chat`、`/api/ai/tool-selection`）接入 Apimart `POST /v1/chat/completions`，并复用 `NANO2_API_KEY`。
- Banana 文本默认模型切换为 `gemini-3-flash-preview-apimart`；若切回 147 链路会自动归一化为兼容模型。
- Follow-up: Banana Apimart 文本默认模型调整为 `gemini-2.5-flash`，并对文本链路启用快速失败/快速切换（减少 503/429 场景下的无效重试等待）。

## [Apimart Text Model Patch - 2026-03-22]
### Changed
- Switched Banana Apimart text default model from `gemini-2.5-flash` to `gemini-3-flash-preview`.
- Updated backend text default model mapping for `banana` / `banana-2.5` / `banana-3.1` to `gemini-3-flash-preview`.
- Updated frontend `aiChatStore` Banana text defaults to `gemini-3-flash-preview` to keep client/server defaults aligned.

## [Canvas Batch Download Patch - 2026-03-22]
### Added
- Canvas 组合选择工具栏新增“批量下载”按钮，支持一次性下载当前选中集合（含组块内图片）中的全部图片（`frontend/src/components/canvas/SelectionGroupToolbar.tsx`, `frontend/src/components/canvas/DrawingController.tsx`）。

### Changed
- `DrawingController` 的单图下载逻辑新增静默模式和布尔返回值，供批量下载复用并在批量完成后统一提示结果（`frontend/src/components/canvas/DrawingController.tsx`）。

## [Flow Patch - 2026-03-24]
### Added
- Flow: added `videoToGif` node and backend `POST /api/video-gif/convert` pipeline (ffprobe + ffmpeg palettegen/paletteuse + OSS upload) to convert connected videos into GIF output URLs.

## [Flow Patch - 2026-03-24]
### Changed
- Flow `Image` node title now supports inline rename on double-click (`Enter`/blur to save, `Escape` to cancel), persisting to `data.label` (`frontend/src/components/flow/nodes/ImageNode.tsx`).

## [Flow Patch - 2026-03-24-2]
### Changed
- Flow `videoToGif` node UI: moved GIF download action to top-right button and removed bottom "open original" link row.

## [Flow Patch - 2026-03-24-3]
### Changed
- Flow `videoToGif` node removed loop toggle and fixed default GIF playback loop to non-infinite.
- Flow `videoToGif` node removed right-side output handle; node now acts as a conversion/download terminal.
- Flow `videoToGif` node credits updated to 30 in frontend fallback config and backend default node config.

## [Flow Patch - 2026-03-24-4]
### Changed
- Flow `videoToGif` backend now converts by input video duration by default (no hard `120s` cap in default path), and forces GIF output loop to non-infinite (`-loop 1`) even if loop param is provided by legacy callers (`backend/src/oss/video-gif.controller.ts`).
- Flow `videoToGif` node helper text updated to reflect duration behavior (`frontend/src/components/flow/nodes/VideoToGifNode.tsx`).

## [Flow Patch - 2026-03-24-5]
### Changed
- `videoToGif` conversion endpoint now integrates credits billing: pre-deduct 30 credits on start, mark success/failed status in `ApiUsageRecord`, and auto-refund on conversion failure (`backend/src/oss/video-gif.controller.ts`, `backend/src/credits/credits.config.ts`, `backend/src/oss/oss.module.ts`).
- Backend/frontend default node config for `videoToGif` now align with `serviceType=video-to-gif` and `priceYuan=0.3` for pricing/config consistency (`backend/src/admin/services/node-config.service.ts`, `frontend/src/services/nodeConfigService.ts`).
- Tencent Speech no-audio resilience: backend now probes input video audio stream before `ProcessMedia`; if no audio stream is detected, it auto-injects a silent AAC track via ffmpeg, uploads the patched video to OSS, and submits Tencent task with the patched URL. Added env toggles `TENCENT_MPS_AUTO_INJECT_SILENT_AUDIO` (default `true`), `TENCENT_MPS_FFPROBE_TIMEOUT_MS` (default `20000`), and `TENCENT_MPS_FFMPEG_TIMEOUT_MS` (default `180000`).

## [Bilingual Patch - 2026-03-29]
### Changed
- Frontend payment panel now uses locale-aware copy (`useLocaleText`) for order status, filter tabs, QR/payment prompts, and manual verification CTA (`frontend/src/components/payment/PaymentPanel.tsx`).
- Frontend library panel now uses locale-aware copy for upload/delete/send-to-canvas flows, detail panel labels, history filter/pagination, and 3D preview status text (`frontend/src/components/panels/LibraryPanel.tsx`).
- Frontend layer panel now uses locale-aware copy for panel header/actions, item/layer context menu labels, pending-upload badge/tooltip, default auto-generated item names, and bottom stats summary (`frontend/src/components/panels/LayerPanel.tsx`).
- Frontend toolbar now uses locale-aware copy for line-style picker labels, major tooltips/titles, and clear-canvas confirmation text (`frontend/src/components/toolbar/ToolBar.tsx`).
- Frontend AI chat dialog now uses locale-aware copy in key interaction controls: bottom parameter/tool buttons, upload/send helper prompts, history toolbar labels, and image/video preview action tooltips (`frontend/src/components/chat/AIChatDialog.tsx`).
- Frontend prompt optimization panel now uses locale-aware copy for labels/placeholders/errors/CTA buttons in the long-press expansion settings panel (`frontend/src/components/chat/PromptOptimizationPanel.tsx`).
- Frontend global keyboard shortcut handler now uses locale-aware copy for clipboard JSON toasts and cloud-save warning/error messages (`frontend/src/components/KeyboardShortcuts.tsx`).
- Frontend project manager modal now uses locale-aware copy for header, create/select/delete actions, leave-guard prompts, rename/delete confirms, empty state, and pagination text (`frontend/src/components/projects/ProjectManagerModal.tsx`).
- Frontend account badge now uses locale-aware copy for greeting, auth status labels/source tooltip, and logout button text (`frontend/src/components/AccountBadge.tsx`).
- Frontend app loader/overlay loading indicator now use locale-aware default loading messages (`frontend/src/components/AppLoader.tsx`, `frontend/src/components/AppLoadingIndicator.tsx`).
- Frontend auth wrapper now uses locale-aware copy for session-expired toast, auth-check loading message, and reload CTA (`frontend/src/components/AuthWrapper.tsx`).
- Frontend forgot-password modal now uses locale-aware copy for step labels, input placeholders, validation errors, and success/failure toasts across phone/verify/reset steps (`frontend/src/components/auth/ForgotPasswordModal.tsx`).
- Frontend autosave status/manual-save button now use locale-aware copy for saving/error/warning labels and blocked-cloud-save messaging (`frontend/src/components/autosave/AutosaveStatus.tsx`, `frontend/src/components/autosave/ManualSaveButton.tsx`).
- Frontend pending-upload leave guards now use locale-aware copy for navigation interception prompt title/message, detail lines, and action buttons (`frontend/src/components/guards/PendingUploadLeavePrompt.tsx`, `frontend/src/components/guards/PendingUploadNavigationGuard.tsx`).
- Frontend canvas zoom/focus/image-size indicators now use locale-aware copy for zoom menu entries/tooltips, focus-mode toggle tooltip, and original-size mode badge text (`frontend/src/components/canvas/ZoomIndicator.tsx`, `frontend/src/components/canvas/FocusModeButton.tsx`, `frontend/src/components/canvas/ImageSizeIndicator.tsx`).
- Frontend workflow history panel now uses locale-aware copy for empty/loading states, restore flow prompts, action labels, and panel header controls (`frontend/src/components/workflow-history/WorkflowHistoryButton.tsx`).
- Frontend layer-tool toggle and shared-template card now use locale-aware copy for toolbar/template action labels (`frontend/src/components/toolbar/LayerTool.tsx`, `frontend/src/components/template/SharedTemplateCard.tsx`).
- Cleaned residual Chinese inline comments in protected-route/template-overlay/smart-image utility components to keep bilingual scan baseline accurate (`frontend/src/routes/ProtectedRoute.tsx`, `frontend/src/components/template/TemplateLibraryOverlay.tsx`, `frontend/src/components/ui/SmartImage.tsx`).
- Frontend image/3D upload triggers now use locale-aware error copy for upload failure and picker readiness/opening errors (`frontend/src/components/canvas/ImageUploadComponent.tsx`, `frontend/src/components/canvas/Model3DUploadComponent.tsx`).
- Cleaned residual Chinese inline comments in canvas helper/renderer and shared UI primitive files to keep bilingual scan baseline accurate (`frontend/src/components/canvas/SelectionBoxOverlay.tsx`, `frontend/src/components/canvas/SnapGuideRenderer.tsx`, `frontend/src/components/canvas/ScaleBarRenderer.tsx`, `frontend/src/components/flow/nodes/GenerationProgressBar.tsx`, `frontend/src/components/ui/context-menu.tsx`, `frontend/src/components/ui/dropdown-menu.tsx`).
- Frontend OSS demo and prompt-optimizer demo pages now use locale-aware copy for user-facing actions, field labels, helper texts, and error messages (`frontend/src/pages/OSSDemo.tsx`, `frontend/src/pages/PromptOptimizerDemo.tsx`).
- Cleaned residual Chinese inline comment in app entry route bootstrap to keep bilingual scan baseline accurate (`frontend/src/main.tsx`).
- Frontend selection-group toolbar now uses locale-aware copy for capture/group/ungroup/batch-download/send-to-dialog action labels and tooltips (`frontend/src/components/canvas/SelectionGroupToolbar.tsx`).
- Cleaned residual Chinese inline comments/log labels in canvas container/interaction helpers to keep bilingual scan baseline accurate (`frontend/src/pages/Canvas.tsx`, `frontend/src/components/canvas/GlobalZoomCapture.tsx`, `frontend/src/components/canvas/InteractionController.tsx`).

## [Bilingual Patch - 2026-03-30]
### Changed
- Frontend background-removal tool + removed-image export panel now use locale-aware copy for upload prompts, success/failure messages, action buttons, and empty states (`frontend/src/components/canvas/BackgroundRemovalTool.tsx`, `frontend/src/components/canvas/BackgroundRemovedImageExport.tsx`).
- Frontend image preview modal now uses locale-aware copy for default title/history title, close/loading labels, generated-time tooltip, and fallback image alt text (`frontend/src/components/ui/ImagePreviewModal.tsx`).
- Frontend template modal now uses locale-aware copy for public/my tabs, loading states, user-template cards, add-template card, delete confirmations, and empty placeholders (`frontend/src/components/template/TemplateModal.tsx`).
- Frontend toolbar color/text controls now use locale-aware copy for eyedropper hints, transparent/fill labels, text style titles, color/alignment labels, and Chinese font display names (`frontend/src/components/toolbar/ColorPicker.tsx`, `frontend/src/components/toolbar/TextStylePanel.tsx`).
- Frontend expand-image selector and Sora2 test page now use locale-aware copy for operation hints/tooltips and Chinese prompt helper text (`frontend/src/components/canvas/ExpandImageSelector.tsx`, `frontend/src/pages/Sora2Test.tsx`).
- Frontend debug panels now use locale-aware copy for memory/history/cache labels, retry/API status text, and action buttons (`frontend/src/components/debug/MemoryDebugPanel.tsx`, `frontend/src/components/debug/HistoryDebugPanel.tsx`, `frontend/src/components/debug/CachedImageDebug.tsx`).
- Cleaned residual Chinese-only comments in MiniMap/text-selection overlay components to keep bilingual scan baseline accurate (`frontend/src/components/flow/MiniMapImageOverlay.tsx`, `frontend/src/components/canvas/TextSelectionOverlay.tsx`).
- Bilingual scanner baseline for unadapted TSX files reduced from `30` to `17` in this round.
- Removed deprecated RunningHub test page and public route (`/runninghub-test`) from frontend entry routing (`frontend/src/main.tsx`, `frontend/src/pages/RunningHubTest.tsx`, `helloagents/wiki/modules/frontend-app.md`).
- Frontend global-history list/detail views now use locale-aware copy for headers, filters, search placeholders, empty states, delete/undo prompts, and detail metadata labels (`frontend/src/components/global-history/GlobalImageHistoryPage.tsx`, `frontend/src/components/global-history/GlobalImageDetailModal.tsx`).
- Bilingual scanner baseline further reduced from `17` to `14` after removing `RunningHubTest` and adapting global-history pages.
- Flow add-panel template/custom empty states and category chips now use locale-aware labels (including `全部/All`, `其他/Other`, and placeholder subtitle copy) to avoid mixed-language UI in English mode (`frontend/src/components/flow/FlowOverlay.tsx`).
- Layer default naming now follows current locale for newly created layers (`图层 N`/`Layer N`), and layer panel display maps legacy `图层 N`/`Layer N` aliases to current language without mutating stored names (`frontend/src/stores/layerStore.ts`, `frontend/src/components/panels/LayerPanel.tsx`).
- Project default naming now follows current locale (`workspacePage.prompt.defaultName`) for auto-created/fallback projects, and header quick-switch display maps legacy `未命名*`/`Untitled*` aliases to current language (`frontend/src/stores/projectStore.ts`, `frontend/src/components/layout/FloatingHeader.tsx`).
- Payment package badges now localize backend-provided `tag/bonus` labels such as `首充翻倍` and `送X%`/`+X%` to prevent Chinese-only badge text in English mode (`frontend/src/components/payment/PaymentPanel.tsx`).


## [Seedream5 Provider Switch - 2026-04-05]
### Added
- Admin settings add `seedream5_provider` (`doubao` / `watcha`) to switch Seedream 5.0 provider channel.
- Backend Seedream5 service reads `seedream5_provider` and routes to Doubao or Watcha at runtime.

### Changed
- Watcha Seedream channel now supports dedicated env vars: `WATCHA_SEEDREAM_API_KEY`, `WATCHA_SEEDREAM_ENDPOINT`, `WATCHA_SEEDREAM_MODEL`.

## [Library Interaction Patch - 2026-04-05]
### Changed
- `库 -> 全局历史` 卡片单击行为从“直接发送到画板”改为“先打开左侧详情浮层”，详情浮层布局与 `个人素材` 保持一致，并提供发送/下载/删除操作（`frontend/src/components/panels/LibraryPanel.tsx`）。
- `库` 面板内的 `个人素材` 与 `全局历史` 卡片统一支持双击打开全屏预览（复用 `ImagePreviewModal`），单击仍用于选中并展示详情（`frontend/src/components/panels/LibraryPanel.tsx`）。

## [Project Library Patch - 2026-04-05]
### Changed
- `库` 面板新增独立 `项目库` 标签（与 `全局历史`、`个人素材` 并列），按当前项目 ID 过滤展示项目内历史记录，并维护独立搜索/筛选/分页状态（`frontend/src/components/panels/LibraryPanel.tsx`）。
- `项目库` 复用历史卡片交互：单击打开详情浮层（发送到画板/下载/删除），双击打开全屏预览；删除后会按项目过滤条件刷新当前列表（`frontend/src/components/panels/LibraryPanel.tsx`）。
