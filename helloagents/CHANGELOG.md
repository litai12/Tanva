# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Added
- 工作流历史版本：新增 `WorkflowHistory` 表（按 `userId + projectId + updatedAt` 复合主键），后端提供查询接口；前端右上角增加 n8n 风格历史按钮与“恢复并保存”交互。
- 画布与 AI 对话框支持 JSON 复制/导入（右键 + `Ctrl/Cmd+Shift+C/V`），导出内容与 `Project.contentJson` 保持一致。

### Changed
- Canvas：图片预览右侧缩略图改为展示当前项目历史列表，主图保持双击选中图片优先（`frontend/src/components/canvas/ImageContainer.tsx`）。
- Flow：Image 节点新增“发送到画板”按钮，支持将当前图片资源一键发送到画布（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- AI 对话框：对话框内容区右键恢复为浏览器默认菜单，不再展示自定义菜单（`frontend/src/components/chat/AIChatDialog.tsx`）。
- Flow：Image Split 分割运行时使用 `canvas/flow-asset`（Split 时不再强制上传 OSS）；保存前通过 `frontend/src/services/flowSaveService.ts` 自动补传并将 `inputImageUrl` 替换为远程 URL/OSS key，持久化仍为 `inputImageUrl + splitRects`；Worker 侧计算降低主线程峰值。
- 设计 JSON：`Project.contentJson` / `PublicTemplate.templateData` 强制禁止 `data:`/`blob:`/base64 图片进入 DB/OSS（后端清洗 + 提供批量修复脚本）。
- 后端 AI：`POST /api/ai/generate-image` 不再返回 base64 `imageData`，改为上传 OSS 并返回 `imageUrl`（前端 Flow/AI Chat 调用已适配）。
- AI Chat：并行图片生成（X2/X4/X8）并发上限提升到 10，并支持通过 `VITE_AI_IMAGE_PARALLEL_CONCURRENCY` 配置（1-10）。
- Flow：图片节点输出以远程 URL/OSS key 为主（Camera/Three/ImageGrid/VideoFrameExtract 等不再持久化 base64/缩略图/`flow-asset:`）；运行时允许临时引用，但保存前会对 `content.flow` 做内联图片校验/补传替换，避免落库。
- 保存：存在未上传图片时不再阻塞云端保存；改为提示“将丢失”，并在保存 payload 中剥离本地图片引用；图层面板对未上传图片打标并支持重试上传。
- Canvas：统一图片引用适配（remote URL / `/api/assets/proxy` / OSS key / 相对路径），并将 `<img>`/Paper.js Raster 的展示源统一收口到 `frontend/src/utils/imageSource.ts`（`toRenderableImageSrc`、`isPersistableImageRef`、`normalizePersistableImageRef`、`resolveImageToBlob/DataUrl`）。
- Canvas：本地上传改为 `blob:` 预览优先（先关联 OSS `key`、后台上传，成功后通过 `tanva:upgradeImageSource` 覆盖远程引用并回收 `ObjectURL`）。
- 前端 UI：画板/图层/缩略图等展示引入 `SmartImage`/`useNonBase64ImageSrc`，将 `data:image/*`/裸 base64 渲染统一转换为 `blob:`（objectURL）或走 `canvas`，减少大字符串驻留与内存峰值。
- 前端：支持通过 `VITE_PROXY_ASSETS=false` + `VITE_ASSET_PUBLIC_BASE_URL` 直连 OSS/CDN（将 `projects/...` 等 key 拼成可访问 URL），减少对 `/api/assets/proxy` 的依赖。
- 前端：编辑器内若存在上传中/待上传图片，离开页面/切换项目/退出登录时弹出确认提示（覆盖 `beforeunload` 与浏览器前进后退）。
- 清空画布：重置 undo/redo 历史并清理剪贴板/图像缓存，避免清空后仍被旧快照引用导致内存不降。
- 后端：开发环境可通过 `CORS_DEV_ALLOW_ALL` 放开跨域并忽略 `CORS_ORIGIN`。
- 后端：支持 `CORS_ORIGIN=*` 放开所有来源（仅建议本地/测试）。
- 前端 AI：`aiImageService` 统一使用 `fetchWithAuth` 请求，确保工具选择等内部 API 注入鉴权头并复用刷新逻辑（`frontend/src/services/aiImageService.ts`）。
- 前端网络请求：全量收口到 `fetchWithAuth`，统一鉴权与 401/403 退出逻辑，并为公开/第三方请求提供 `auth: "omit"` 与 `credentials` 控制（`frontend/src/services/authFetch.ts` 等）。
- 后端 AI：Seedance（doubao）视频任务成功后自动上传到 OSS，仅返回自有 OSS 公网链接，避免上游 TOS 直链的 CORS/过期问题。

### Fixed
- Flow：生成链路允许传递远程 URL，由后端下载处理，规避前端跨域读取失败（`frontend/src/components/flow/FlowOverlay.tsx`、`backend/src/ai/ai.controller.ts`、`backend/src/ai/dto/image-generation.dto.ts`）。
- Flow：Generate 输入解析优先使用 Image 节点当前渲染数据，并在 proxy 拉取失败时使用带鉴权兜底（`frontend/src/components/flow/FlowOverlay.tsx`）。
- Flow：MiniMap 即时显示图片占位，导入完成即触发重建并用导入时间戳兜底触发（`frontend/src/services/paperSaveService.ts`、`frontend/src/components/canvas/DrawingController.tsx`）。
- Flow：刷新后 MiniMap 图片占位不显示的问题，反序列化完成即触发重建事件，并在重建失败时回退到快照种子化（`frontend/src/services/paperSaveService.ts`、`frontend/src/components/canvas/DrawingController.tsx`、`frontend/src/components/canvas/hooks/useImageTool.ts`）。
- Flow：MiniMap 图片/节点概览在刷新后可即时更新，改为事件驱动并保留 1s 兜底轮询（`frontend/src/components/flow/MiniMapImageOverlay.tsx`、`frontend/src/components/canvas/DrawingController.tsx`）。
- Flow：MiniMap 不再在拖动画布/节点时隐藏，保持持续可见（`frontend/src/components/flow/FlowOverlay.tsx`）。
- Flow：修复图片节点裁剪预览尺寸读取受画布缩放影响，导致刷新后预览被放大（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Worker 图片上传：主线程透传 access token，OSS presign 请求携带 Authorization，避免跨站 401（`frontend/src/services/imageUploadWorkerClient.ts`、`frontend/src/workers/imageUploadWorker.ts`、`frontend/src/services/ossUploadService.ts`）。
- 前端鉴权：`fetchWithAuth` 仅在 Authorization 为空时注入 access token，避免空值阻断注入（`frontend/src/services/authFetch.ts`）。
- Worker 图片分割：通过主线程透传 access token 并在 Worker 请求中补齐 Authorization，避免跨站资源拉取 401（`frontend/src/services/imageSplitWorkerClient.ts`、`frontend/src/workers/imageSplitWorker.ts`）。
- 前端 AI：`aiImageService` 刷新会话时补充 `refresh_token` Authorization 头，避免跨站仅依赖 cookie 导致 401（`frontend/src/services/aiImageService.ts`）。
- AI 对话框：选中文本时右键允许浏览器默认菜单，确保可复制选中文本（`frontend/src/components/chat/AIChatDialog.tsx`）。
- Flow：Image 节点发送到画板时以当前渲染资源为准，含 `crop`/ImageSplit 预览裁剪（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：Image 节点断开上游连接时会保留当前裁剪渲染状态，避免回退到整图（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：Image 节点裁剪预览改为与节点容器等比居中显示，避免生成的切片预览尺寸异常（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：Image 节点裁剪预览使用原始裁剪分辨率绘制并缩放展示，避免下载/保存时分辨率变小与模糊（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：Image 节点可递归解析上游 Image 链路中的裁剪信息，避免长链路回退到原始图（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：ImageSplit 通过 Image 链路输入时递归解析上游裁剪信息，避免回退到原图（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Flow：ImageSplit 接收裁剪后的 Image 节点输入时可回溯上游解析 baseRef，确保按裁剪结果分割而非原图（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Flow：ImageSplit 输入预览在上游为裁剪链路时优先显示裁剪预览并等待临时输入准备好，避免先显示整图后跳变（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Flow：Image 节点切换输入连线时清理旧 crop，避免复用旧裁剪结果（`frontend/src/components/flow/FlowOverlay.tsx`）。
- Flow：Image 节点从上游读取图片时优先跟随连线，避免上游更新后下游不刷新（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：Image 节点发送到画板时尊重 `crop`，发送裁剪结果而非原图（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：Analysis 节点断开输入连线时清理残留图片数据，避免预览仍显示旧图（`frontend/src/components/flow/nodes/AnalyzeNode.tsx`）。
- Flow：Analysis 节点在 Image→Image→Analysis 链路中可递归识别上游 `crop`/`ImageSplit`，避免回退成整图（`frontend/src/components/flow/nodes/AnalyzeNode.tsx`）。
- Flow：Analysis 节点在上游 Image 仅作展示时会继续回溯其输入来渲染预览，避免初始空白（`frontend/src/components/flow/nodes/AnalyzeNode.tsx`）。
- Flow：Image 节点在连接到下游 Image/ImagePro 时会优先使用源节点自身图片并支持读取其 `crop` 做裁剪预览，避免链路传递后图片空白或回退整图（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：ImageSplit 生成 Image 节点时优先使用 `inputImageUrl/inputImage` 作为基底，减少误用上游缩略图导致的清晰度下降（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Flow：ImageGrid 读取 Image/ImagePro 节点时优先尊重 `crop`，避免下游仍使用整图（`frontend/src/components/flow/nodes/ImageGridNode.tsx`）。
- 项目内容加载：前端对同项目 `GET /api/projects/:id/content` 做并发去重；后端 OSS 未配置/禁用时跳过读写并设置超时，减少重复下载与长时间卡顿。
- 后端 AI：工具选择响应解析更稳健（支持前后缀文本/markdown code fence/尾随逗号/松散 key:value/从文本提取工具名），避免误降级到 chatResponse（`backend/src/ai/tool-selection-json.util.ts`）。
- AI 对话框：工具选择阶段先展示“正在思考中...”占位提示，并复用一次工具选择结果避免重复请求（`frontend/src/stores/aiChatStore.ts`）。
- AI 图片：后端 `generate-image` 对“空图/非法格式图”在同一次请求内自动重试（最多 3 次），并将空图/非法格式统一视为 502（BadGateway）；前端保留兜底重试，减少对话框 X4 模式偶发只生成 3 张的问题（`backend/src/ai/ai.controller.ts`、`frontend/src/services/aiBackendAPI.ts`）。
- Assets Proxy：`GET /api/assets/proxy` 跟随重定向前主动 cancel 上一个响应体；客户端中断时 abort 上游 fetch 并安全清理流，避免 `ReadableStream is locked` 报错，降低高频图片代理下的内存/连接占用。
- Flow：Analyze/参考图拉取远程图片时使用 `credentials: omit`，避免跨域部署下 `/api/assets/proxy` 的 `Access-Control-Allow-Origin=*` 与 `credentials: include` 冲突导致浏览器拦截（`frontend/src/components/flow/nodes/AnalyzeNode.tsx`、`frontend/src/components/flow/FlowOverlay.tsx`）。
- 前端图片转码：新增全局并发限流（暂定 10），收口图片生成/转化（`canvas.toDataURL/toBlob`、`FileReader.readAsDataURL`、`Response.blob`、`createImageBitmap/WebCodecs` 等）并在 AI Chat/Flow/画布等链路复用，降低多图场景瞬时内存峰值与卡顿。
- 截图：`AutoScreenshotService` 绘制 Raster 时仅在“确实跨域且未设置 crossOrigin”场景才重载图片，避免同源 `/api/assets/proxy` 资源被重复请求导致的接口刷屏与内存抖动。
- Canvas：保存 `paperJson` 时将 `*/api/assets/proxy?...` 反解为 remote URL/OSS key，避免把 `http://localhost:5173/...` 等运行时代理地址落库。
- Canvas：修复反序列化后 `Raster.source` 变为 `<img>.src` 导致 OSS key/远程引用未被正确识别与代理，出现图片空白（`frontend/src/services/paperSaveService.ts`）。
- 保存：云端保存前会额外清理 `aiChatSessions`/`assets.images` 中残留的 `data:`/`blob:`/裸 base64（含 `localDataUrl/dataUrl/previewDataUrl`、`imageData/thumbnail` 等），避免“全选清空后仍携带 dataURL”导致 payload 过大或落库污染。
- Flow：Image Split 分割完成后“生成节点”不再置灰；支持基于 `splitRects` 生成 Image 节点并在 Image 节点运行时裁剪预览（不落库）。
- Flow：Image Split 生成的 Image 节点裁剪预览在右键保存/导出时不再包含 contain 留白白边（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- Flow：Image Split 配置恢复为“输出端口数量(1-50)”语义；网格切分按端口数自动推导（例如 2048x2048 要 512x512 切片可设 `16`）（`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Flow：Image Split（Worker 网格切分）不再对切片做“去白边裁切”，并保证输出数量严格等于端口数，避免切片尺寸被裁小/数量漂移（`frontend/src/workers/imageSplitWorker.ts`、`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Flow：Analysis 节点支持解析 Image Split / Image(crop) 的裁切输入，调用分析接口时会发送切片图（而非整图），并保持切片分辨率与尺寸正确（`frontend/src/components/flow/nodes/AnalyzeNode.tsx`、`frontend/src/components/flow/nodes/ImageSplitNode.tsx`）。
- Flow：修复 Image Split 切片在下游裁切/拼合时误按解码后像素尺寸导出，导致只加载到缩略图时分辨率被压缩（例如 2048->400 使 1024 切片变 200），并降低边缘白边概率（`frontend/src/components/flow/FlowOverlay.tsx`、`frontend/src/components/flow/nodes/ImageGridNode.tsx`）。
- Flow：视频节点参考图按连线解析，支持 Image Split 切片作为输入。
- Flow：Image Split 生成的 Image 节点（`crop`）在下游运行时按裁切结果传参，避免仍使用完整原图。
- Canvas：修复将 OSS key/proxy/path 误判为 base64/待上传导致图片置灰的问题（含快速上传、导入重建实例、视频缩略图与下载链路）。
- Canvas：AI 图片占位符升级为远程 URL 时先预加载再切换，避免画布闪白/“刷新感”。
- Canvas：图片升级切换 `Raster.source` 后立即恢复 `bounds`/选择元素，避免 Paper.js 短暂重置尺寸导致的闪烁。
- Canvas：上传中图片允许拖拽移动，但禁用组合/编辑等操作，避免误触发。
- Canvas：修复误将 `HTMLImageElement` 传给 `Raster.source` 导致变成 `[object HTMLImageElement]`，上传完成后图片加载失败/消失（`frontend/src/components/canvas/PaperCanvasManager.tsx`、`frontend/src/components/canvas/hooks/useQuickImageUpload.ts`、`frontend/src/components/canvas/DrawingController.tsx`）。
- Canvas：修复上传图片完成后因 `ObjectURL` 误判未使用被提前回收，导致图片消失、刷新后才恢复显示的问题（`frontend/src/services/paperSaveService.ts`、`frontend/src/components/canvas/DrawingController.tsx`）。
- 前端鉴权：补齐部分直连请求未触发自动退出的问题；统一用 `fetchWithAuth`/`triggerAuthExpired` 处理 401/403，并在登录失效时清理本地会话缓存（`frontend/src/services/authEvents.ts`、`frontend/src/services/authFetch.ts`）。
- 前端鉴权：`fetchWithAuth` 在 refresh 返回成功但重试仍 401/403 时也会触发 `triggerAuthExpired`，避免出现接口 401 但未跳转登录的问题（`frontend/src/services/authFetch.ts`）。
- Flow：禁用节点拖拽时的自动平移（`autoPanOnNodeDrag`），并在 `dragStop` 强制回同步视口，避免快速拖动节点时视口漂移导致其他节点整体偏移。
- Flow：三维节点（`ThreeNode`）上传模型后自动居中相机，并将模型 URL 持久化为远程引用，避免切换/resize 后模型丢失。
- Flow：三维节点（`ThreeNode`）在节点 resize 时 canvas 保持铺满；拖拽过程中不频繁 `setSize` 避免闪烁，拖拽结束后一次性同步 renderer 并即时渲染。
- Flow：修复图片节点渲染时 `uploading/uploadError` 未定义导致的白屏崩溃（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- 项目权限：非所有者访问项目时返回“项目不存在”（404），触发前端清理无效 `projectId` 的容错逻辑，避免误判登录失效（`backend/src/projects/projects.service.ts`）。
- Flow：模板导出/保存支持将 `flow-asset:`/`blob:`/OSS key/`/api/assets/proxy?...` 等图片引用归一化为可持久化引用，并在 Image Split 模板中迁移 `splitImages` -> `splitRects`，避免公共模板图片缺失（`frontend/src/components/flow/FlowOverlay.tsx`）。

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.
