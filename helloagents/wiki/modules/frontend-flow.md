# 前端模块：Flow（frontend-flow）

## 作用
- 提供流程/节点编排能力（ReactFlow），并与画布/素材/生成等能力联动。

## 关键目录（节选）
- `frontend/src/components/flow/FlowOverlay.tsx`：Flow 主入口（体量较大）
- `frontend/src/components/flow/nodes/`：节点实现（含进度条、生成节点等）
- `frontend/src/components/flow/types.ts`：类型定义
- `frontend/src/components/flow/utils/`：辅助逻辑
- `frontend/src/components/flow/PersonalLibraryPanel.tsx`：个人库面板（与后端 personal-library 相关）

## 依赖
- `reactflow`

