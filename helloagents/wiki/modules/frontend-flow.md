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
- **Worker 计算**：`Image Split` 使用 `frontend/src/workers/imageSplitWorker.ts` 在 Worker 内解码并计算裁切矩形，避免主线程做像素级扫描与 `toDataURL` 产生的峰值。

## 3D 模型节点
- 三维节点（`frontend/src/components/flow/nodes/ThreeNode.tsx`）选择模型文件后会上传至 OSS，并将 `modelUrl` 持久化为远程引用，避免 `blob:` 等临时 URL 进入 `content.flow`。
- 加载远程模型时可通过 `proxifyRemoteAssetUrl` 走 `/api/assets/proxy`，以规避 OSS CORS（受 `VITE_PROXY_ASSETS` 控制）。

## 依赖
- `reactflow`
