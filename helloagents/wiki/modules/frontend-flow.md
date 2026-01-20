# 前端模块：Flow（frontend-flow）

## 作用
- 提供流程/节点编排能力（ReactFlow），并与画布/素材/生成等能力联动。

## 关键目录（节选）
- `frontend/src/components/flow/FlowOverlay.tsx`：Flow 主入口（体量较大）
- `frontend/src/components/flow/nodes/`：节点实现（含进度条、生成节点等）
- `frontend/src/components/flow/types.ts`：类型定义
- `frontend/src/components/flow/utils/`：辅助逻辑
- `frontend/src/components/flow/PersonalLibraryPanel.tsx`：个人库面板（与后端 personal-library 相关）

## 图片与内存
- **原则**：不要在 `content.flow`（项目内容 JSON）里持久化大体积 base64；这会导致序列化/对比/自动保存时产生巨型临时字符串并推高内存。
- **Flow 图片资产**：`frontend/src/services/flowImageAssetStore.ts` 的 `flow-asset:<id>` 仅用于运行期/本地缓存；**保存到后端前必须替换为远程 URL/OSS key**（否则会被阻止保存/或被后端清洗丢弃）。当前通过 `frontend/src/services/flowSaveService.ts` 在保存链路里自动补传并替换（优先覆盖 `Image Split` 的输入图引用）。
- **Image Split 持久化（方案A）**：运行时可用 `inputImageUrl=flow-asset:` 做分割/下游裁切；保存到后端前会补传并替换为 `inputImageUrl`（远程 URL/OSS key）+ `splitRects[]`（裁切矩形）+ `sourceWidth/sourceHeight`，切片图片本身不落库。渲染/下游（例如 `Image Grid`）按需从原图裁切。
- **Image Split 输出端口数**：节点配置使用“输出端口数量(1-50)”，Worker 会按 `cols=ceil(sqrt(count))`、`rows=ceil(count/cols)` 做网格裁切；例如 2048x2048 要得到 512x512 的 4x4 切片，应将输出端口设为 `16`（仅裁切不缩放）。
- **裁切输出尺寸**：下游按 `splitRects[].width/height`（源坐标系）作为输出尺寸；当 base 图像只加载到缩略图（`naturalW < sourceWidth`）时，仍会输出正确尺寸（避免 1024 误变 200）。
- **Image 节点裁切透传**：`Image`/`ImagePro` 节点带 `crop` 时，下游聚合（如 `Image Grid`）会优先按 `crop` 裁切再拼合，避免回退到整图；节点连接链路中也支持读取上游 `Image` 的 `crop` 进行裁剪预览。
- **Analysis 裁切继承**：`Analysis` 节点在输入为 `Image/ImagePro` 时会递归向上游查找 `crop`/`ImageSplit`，以确保链路中转后仍使用裁剪结果。
- **Analysis 断开清空**：断开图片连线后会清理节点内残留的 `imageData/imageUrl`，预览恢复为空状态。
- **Worker 计算**：`Image Split` 使用 `frontend/src/workers/imageSplitWorker.ts` 在 Worker 内解码并计算裁切矩形，避免主线程做像素级扫描与 `toDataURL` 产生的峰值。

## 3D 模型节点
- 三维节点（`frontend/src/components/flow/nodes/ThreeNode.tsx`）选择模型文件后会上传至 OSS，并将 `modelUrl` 持久化为远程引用，避免 `blob:` 等临时 URL 进入 `content.flow`。
- 加载远程模型/图片时默认可通过 `proxifyRemoteAssetUrl` 走 `/api/assets/proxy`，以规避 OSS CORS（受 `VITE_PROXY_ASSETS` 控制）。若 OSS 已配置 CORS 且希望禁用 proxy，请设置 `VITE_PROXY_ASSETS=false` 并配置 `VITE_ASSET_PUBLIC_BASE_URL`（用于把 `projects/...` 这类 key 直接拼成可访问 URL）。
- Three.js 渲染器尺寸以容器 `clientWidth/clientHeight` 为准，并使用 `renderer.setSize(w, h, false)` 仅更新绘制缓冲（不改写 canvas 的样式尺寸），避免节点 resize 时 canvas 未铺满可视区域。

## 依赖
- `reactflow`
