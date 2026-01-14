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
- **Flow 图片资产**：使用 `frontend/src/services/flowImageAssetStore.ts` 将图片 Blob 存入 IndexedDB，并在节点数据里仅保存 `flow-asset:<id>` 引用。
- **Worker 计算**：`Image Split` 使用 `frontend/src/workers/imageSplitWorker.ts` 在 Worker 内解码/切分/编码，避免主线程做像素级扫描与 `toDataURL` 产生的峰值。

## 依赖
- `reactflow`
