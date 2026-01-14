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

## 依赖
- `paper`、`@types/paper`
-（可选）3D：`three`、`@react-three/fiber`、`@react-three/drei`

