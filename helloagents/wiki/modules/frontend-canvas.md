# 前端模块：画布（frontend-canvas）

## 作用
- 提供绘图画布能力（Paper.js），包含交互控制、缩放/对齐/网格、文本编辑、选择与导出等。
- 绘图工具支持线条样式选择：`实线 / 虚线 / 点画线 / 手绘风（两头粗中间细）/ 手绘风（中间粗两头细）`（手绘风对 `free/line` 生效，完成绘制时会转为闭合轮廓路径）。

## 关键目录（节选）
- `frontend/src/components/canvas/`：画布主组件与控制器
  - `DrawingController.tsx`：绘制/控制核心（体量较大，优先从此入口理解）
  - `PaperCanvasManager.tsx`：Paper.js 管理与生命周期
  - `InteractionController.tsx`：交互控制（拖拽、选择等）
  - `GridRenderer.tsx`、`SnapGuideRenderer.tsx`、`ScaleBarRenderer.tsx`：辅助渲染
  - `TextEditor.tsx` / `SimpleTextEditor.tsx`：文字编辑
- `frontend/src/components/panels/LibraryPanel.tsx`：右侧库面板（手动素材 / 全局历史切换，支持拖拽或发送到画板）
- `frontend/src/components/canvas/hooks/`：与画布交互相关 hooks

## 图片引用协议（重要）
- **可持久化（允许落库/落 JSON）**：remote URL、OSS key（如 `projects/...`）、同源路径（`/`/`./`/`../`）、以及 `/api/assets/proxy?...`（保存时建议去代理包装为 key/remote URL）。
- **仅运行时临时态（禁止持久化）**：`data:`、`blob:`、`flow-asset:`、裸 base64（允许短暂存在，但**渲染优先转 `blob:`（objectURL）或用 `canvas`**；保存前必须上传并替换为远程 URL/OSS key，否则应阻止保存）。
- **统一工具**：`frontend/src/utils/imageSource.ts`
  - `toRenderableImageSrc`：把 key/proxy/remote/path 转成可渲染的 src（默认会按需走 proxy 降低 CORS；如需禁用 proxy：`VITE_PROXY_ASSETS=false` + `VITE_ASSET_PUBLIC_BASE_URL`）。
  - `isPersistableImageRef` / `normalizePersistableImageRef`：保存前判定与规范化（避免把 proxy/data/blob 写进设计 JSON）。
  - `resolveImageToBlob` / `resolveImageToDataUrl`：上传/AI/edit 等需要 blob/dataURL 的场景。
- 选中图片同步到 AI 对话框时，优先使用 `remoteUrl`；缺失时再用 `toRenderableImageSrc` 将 key 转为可访问 URL。
  - UI 渲染：`frontend/src/components/ui/SmartImage.tsx`、`frontend/src/hooks/useNonBase64ImageSrc.ts`（把 base64/dataURL 转成 `blob:` 渲染）。
- **Paper.js Raster 约定**：
  - `raster.source` 用 `toRenderableImageSrc(...)` 的结果（展示用）。
  - `raster.data.key`（OSS key）/ `raster.data.remoteUrl`（http(s)）用于持久化与“需要真实 URL”的能力调用。
  - 保存由 `frontend/src/services/paperSaveService.ts` 统一处理：上传 pending 图片、替换引用、避免内联大数据落库；并在序列化 `paperJson` 时将 `*/api/assets/proxy?...` 反解为 key/url（避免把运行时代理地址落库）。
  - 云端保存前还会做兜底清理：`frontend/src/utils/projectContentValidation.ts` 的 `sanitizeProjectContentForCloudSave` 会剥离 `assets.images` 的 `localDataUrl/dataUrl/previewDataUrl` 等运行时字段，并清理 `aiChatSessions` 内的 `imageData/thumbnail/...` 内联图片引用，确保 `contentJson` 不含 `data:`/`blob:`/裸 base64。

## 依赖
- `paper`、`@types/paper`
-（可选）3D：`three`、`@react-three/fiber`、`@react-three/drei`

## 本地图片上传链路（blob 预览 → OSS）
- 入口：`frontend/src/components/canvas/ImageUploadComponent.tsx`（选择文件后先生成 `blob:` 预览，同时生成 OSS `key`，落到 `imageData.url/key` 并标记 `pendingUpload=true`）
- 上传：`frontend/src/services/imageUploadService.ts` → `frontend/src/services/ossUploadService.ts`（先 `POST /api/uploads/presign` 获取策略，再 `POST` 到 OSS `host`）
- 上传中回显：`frontend/src/components/canvas/ImageContainer.tsx`（根据 `pendingUpload` 显示“上传中…”）
- 成功回写与清理：`frontend/src/components/canvas/DrawingController.tsx` 监听 `tanva:upgradeImageSource`，切换 `Raster.source` 到远程引用、清理 `localDataUrl` 并回收 `ObjectURL`
- 远程地址：上传回写时将 OSS `key` 解析为完整 `remoteUrl`（基于 `VITE_ASSET_PUBLIC_BASE_URL`），优先使用 `remoteUrl` 同步到 AI 对话框
- 保存兜底：`frontend/src/services/paperSaveService.ts` 的 `ensureRemoteAssets` 会在云保存前补传 `pendingUpload` 的图片，并同样触发 `tanva:upgradeImageSource`

## JSON 复制/导入（Project.contentJson）
- 右键画布菜单与 `Ctrl/Cmd+Shift+C` 支持复制画布 JSON（严格走 `sanitizeProjectContentForCloudSave` 清理内联图片引用）。
- `Ctrl/Cmd+Shift+V` 或右键导入画布 JSON 时追加到当前项目，并触发 `paper-project-changed` 重建实例。

## 画布图片预览
- 双击画布图片打开预览蒙层，主图优先显示当前双击图片。
- 右侧缩略图栏展示当前项目的“全局图片历史”列表，支持点击切换预览。

## 图片调色板条
- `ImageContainer` 的图片操作菜单新增 `提取调色板`（位于“更多”菜单候选项内）。
- 点击后会基于当前图片数据做降采样与主色聚类，提取 6 个主色，并生成一张独立的竖向调色板图片放在原图右侧（复用 `triggerQuickImageUpload` 链路）。
- 调色板图片按普通图片资产处理：先本地显示，后续上传并持久化为远程 URL/OSS key，不会把内联 base64 落库。

## 图层面板反向选中
- 当用户在画板中选中图片/3D/路径时，`DrawingController` 会派发 `tanva-canvas-selection-updated`，`LayerPanel` 会据此自动高亮对应图元项。
- 同步时会自动展开并激活对应图层，避免“画板已选中但图层面板无反馈”；图片场景仍兼容 `tanva-image-instances-updated`。
- 主要实现位于 `frontend/src/components/panels/LayerPanel.tsx`。

## 库面板（右侧）
- 顶部提供双标签：`全局历史` 与 `手动素材`。
- `手动素材` 维持原逻辑：来自 `personalLibraryStore + personalLibraryApi`，支持上传/删除/详情/发送到画板。
- `全局历史` 在库面板内独立拉取，支持搜索、类型筛选、页码分页（`1 2 ... N`）、点击发送或拖拽到画板。
- 库面板主内容区使用固定滚动容器（`flex + min-h-0 + overflow-y-auto`），避免历史列表在部分视口下无法下滑的问题。

## 3D 拍照白图防护
- `Model3DViewer` 在处理 `tanva:model3d-capture-frame` 时会先强制渲染当前机位（`invalidate + renderer.render(scene, camera)`），再抓取帧数据。
- 显式拍照场景下，抓帧支持离屏 renderer 兜底，减少 `frameloop="demand"` + 非保留缓冲导致的白图。
- 缓存图会标记 `data-model3d-snapshot-source`，截图服务仅使用 `runtime` 来源，不会误用预生成 preview。
- `AutoScreenshotService` 在 runtime 帧不可用时会检查 WebGL canvas 是否近似空白；若为空则跳过绘制，避免把整块白底写入结果图。
