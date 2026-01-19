# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Added
- 工作流历史版本：新增 `WorkflowHistory` 表（按 `userId + projectId + updatedAt` 复合主键），后端提供查询接口；前端右上角增加 n8n 风格历史按钮与“恢复并保存”交互。

### Changed
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

### Fixed
- 项目内容加载：前端对同项目 `GET /api/projects/:id/content` 做并发去重；后端 OSS 未配置/禁用时跳过读写并设置超时，减少重复下载与长时间卡顿。
- 后端 AI：工具选择响应解析更稳健（支持前后缀文本/markdown code fence/尾随逗号/松散 key:value/从文本提取工具名），避免误降级到 chatResponse（`backend/src/ai/tool-selection-json.util.ts`）。
- AI 对话框：工具选择阶段先展示“正在思考中...”占位提示，并复用一次工具选择结果避免重复请求（`frontend/src/stores/aiChatStore.ts`）。
- AI 图片：后端 `generate-image` 对“空图/非法格式图”在同一次请求内自动重试（最多 3 次），并将空图/非法格式统一视为 502（BadGateway）；前端保留兜底重试，减少对话框 X4 模式偶发只生成 3 张的问题（`backend/src/ai/ai.controller.ts`、`frontend/src/services/aiBackendAPI.ts`）。
- Assets Proxy：`GET /api/assets/proxy` 跟随重定向前主动 cancel 上一个响应体；客户端中断时 abort 上游 fetch 并安全清理流，避免 `ReadableStream is locked` 报错，降低高频图片代理下的内存/连接占用。
- 前端图片转码：新增全局并发限流（暂定 10），收口图片生成/转化（`canvas.toDataURL/toBlob`、`FileReader.readAsDataURL`、`Response.blob`、`createImageBitmap/WebCodecs` 等）并在 AI Chat/Flow/画布等链路复用，降低多图场景瞬时内存峰值与卡顿。
- 截图：`AutoScreenshotService` 绘制 Raster 时仅在“确实跨域且未设置 crossOrigin”场景才重载图片，避免同源 `/api/assets/proxy` 资源被重复请求导致的接口刷屏与内存抖动。
- Canvas：保存 `paperJson` 时将 `*/api/assets/proxy?...` 反解为 remote URL/OSS key，避免把 `http://localhost:5173/...` 等运行时代理地址落库。
- Canvas：修复反序列化后 `Raster.source` 变为 `<img>.src` 导致 OSS key/远程引用未被正确识别与代理，出现图片空白（`frontend/src/services/paperSaveService.ts`）。
- 保存：云端保存前会额外清理 `aiChatSessions`/`assets.images` 中残留的 `data:`/`blob:`/裸 base64（含 `localDataUrl/dataUrl/previewDataUrl`、`imageData/thumbnail` 等），避免“全选清空后仍携带 dataURL”导致 payload 过大或落库污染。
- Flow：Image Split 分割完成后“生成节点”不再置灰；支持基于 `splitRects` 生成 Image 节点并在 Image 节点运行时裁剪预览（不落库）。
- Flow：修复 Image Split 切片在下游裁切/拼合时误按解码后像素尺寸导出，导致只加载到缩略图时分辨率被压缩（例如 2048->400 使 1024 切片变 200），并降低边缘白边概率（`frontend/src/components/flow/FlowOverlay.tsx`、`frontend/src/components/flow/nodes/ImageGridNode.tsx`）。
- Flow：视频节点参考图按连线解析，支持 Image Split 切片作为输入。
- Flow：Image Split 生成的 Image 节点（`crop`）在下游运行时按裁切结果传参，避免仍使用完整原图。
- Canvas：修复将 OSS key/proxy/path 误判为 base64/待上传导致图片置灰的问题（含快速上传、导入重建实例、视频缩略图与下载链路）。
- Canvas：AI 图片占位符升级为远程 URL 时先预加载再切换，避免画布闪白/“刷新感”。
- Canvas：图片升级切换 `Raster.source` 后立即恢复 `bounds`/选择元素，避免 Paper.js 短暂重置尺寸导致的闪烁。
- Canvas：修复误将 `HTMLImageElement` 传给 `Raster.source` 导致变成 `[object HTMLImageElement]`，上传完成后图片加载失败/消失（`frontend/src/components/canvas/PaperCanvasManager.tsx`、`frontend/src/components/canvas/hooks/useQuickImageUpload.ts`、`frontend/src/components/canvas/DrawingController.tsx`）。
- Canvas：修复上传图片完成后因 `ObjectURL` 误判未使用被提前回收，导致图片消失、刷新后才恢复显示的问题（`frontend/src/services/paperSaveService.ts`、`frontend/src/components/canvas/DrawingController.tsx`）。
- 前端鉴权：补齐部分直连请求未触发自动退出的问题；统一用 `fetchWithAuth`/`triggerAuthExpired` 处理 401/403，并在登录失效时清理本地会话缓存（`frontend/src/services/authEvents.ts`、`frontend/src/services/authFetch.ts`）。
- 前端鉴权：`fetchWithAuth` 在 refresh 返回成功但重试仍 401/403 时也会触发 `triggerAuthExpired`，避免出现接口 401 但未跳转登录的问题（`frontend/src/services/authFetch.ts`）。
- Flow：禁用节点拖拽时的自动平移（`autoPanOnNodeDrag`），并在 `dragStop` 强制回同步视口，避免快速拖动节点时视口漂移导致其他节点整体偏移。
- Flow：三维节点（`ThreeNode`）上传模型后自动居中相机，并将模型 URL 持久化为远程引用，避免切换/resize 后模型丢失。
- Flow：三维节点（`ThreeNode`）在节点 resize 时 canvas 保持铺满；拖拽过程中不频繁 `setSize` 避免闪烁，拖拽结束后一次性同步 renderer 并即时渲染。
- Flow：修复图片节点渲染时 `uploading/uploadError` 未定义导致的白屏崩溃（`frontend/src/components/flow/nodes/ImageNode.tsx`）。
- 项目权限：非所有者访问项目时返回“项目不存在”（404），触发前端清理无效 `projectId` 的容错逻辑，避免误判登录失效（`backend/src/projects/projects.service.ts`）。

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.
