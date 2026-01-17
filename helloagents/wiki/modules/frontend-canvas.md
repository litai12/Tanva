# 前端模块：画布（frontend-canvas）

## 作用
- 提供绘图画布能力（Paper.js），包含交互控制、缩放/对齐/网格、文本编辑、选择与导出等。

## 关键目录（节选）
- `frontend/src/components/canvas/`：画布主组件与控制器
  - `DrawingController.tsx`：绘制/控制核心（体量较大，优先从此入口理解）
  - `PaperCanvasManager.tsx`：Paper.js 管理与生命周期
  - `InteractionController.tsx`：交互控制（拖拽、选择等）
  - `GridRenderer.tsx`、`SnapGuideRenderer.tsx`、`ScaleBarRenderer.tsx`：辅助渲染
  - `TextEditor.tsx` / `SimpleTextEditor.tsx`：文字编辑
- `frontend/src/components/canvas/hooks/`：与画布交互相关 hooks

## 图片引用协议（重要）
- **可持久化（允许落库/落 JSON）**：remote URL、OSS key（如 `projects/...`）、同源路径（`/`/`./`/`../`）、以及 `/api/assets/proxy?...`（保存时建议去代理包装为 key/remote URL）。
- **仅运行时临时态（禁止持久化）**：`data:`、`blob:`、`flow-asset:`、裸 base64（允许短暂存在，但**渲染优先转 `blob:`（objectURL）或用 `canvas`**；保存前必须上传并替换为远程 URL/OSS key，否则应阻止保存）。
- **统一工具**：`frontend/src/utils/imageSource.ts`
  - `toRenderableImageSrc`：把 key/proxy/remote/path 转成可渲染的 src（默认会按需走 proxy 降低 CORS；如需禁用 proxy：`VITE_PROXY_ASSETS=false` + `VITE_ASSET_PUBLIC_BASE_URL`）。
  - `isPersistableImageRef` / `normalizePersistableImageRef`：保存前判定与规范化（避免把 proxy/data/blob 写进设计 JSON）。
  - `resolveImageToBlob` / `resolveImageToDataUrl`：上传/AI/edit 等需要 blob/dataURL 的场景。
  - UI 渲染：`frontend/src/components/ui/SmartImage.tsx`、`frontend/src/hooks/useNonBase64ImageSrc.ts`（把 base64/dataURL 转成 `blob:` 渲染）。
- **Paper.js Raster 约定**：
  - `raster.source` 用 `toRenderableImageSrc(...)` 的结果（展示用）。
  - `raster.data.key`（OSS key）/ `raster.data.remoteUrl`（http(s)）用于持久化与“需要真实 URL”的能力调用。
  - 保存由 `frontend/src/services/paperSaveService.ts` 统一处理：上传 pending 图片、替换引用、避免内联大数据落库。

## 依赖
- `paper`、`@types/paper`
-（可选）3D：`three`、`@react-three/fiber`、`@react-three/drei`
