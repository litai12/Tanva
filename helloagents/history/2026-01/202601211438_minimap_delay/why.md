# 变更提案: MiniMap 刷新延迟展示修复

## 需求背景
刷新页面后，右下角 MiniMap 节点/图片内容会延迟约 30s 才显示，但画布已完成渲染。需要定位延迟来源并保证刷新后短时间内即可展示。

## 变更内容
1. 明确 MiniMap 展示依赖（React Flow 节点 + 画布图片实例）的就绪时机，并在就绪后立即驱动更新。
2. 减少仅靠轮询造成的滞后，改用事件/订阅触发的同步更新路径。

## 影响范围
- **模块:** Flow Overlay、Canvas/DrawingController
- **文件:** `frontend/src/components/flow/MiniMapImageOverlay.tsx`, `frontend/src/components/canvas/DrawingController.tsx`（可能）
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: minimap-refresh
**模块:** Flow Overlay
刷新页面后，MiniMap 应在画布首屏渲染完成后快速展示节点/图片概览。

#### 场景: show-within-1s
页面刷新进入项目后，MiniMap 在 1s 内出现可见节点/图片概览（不需要等待 30s）。
- 预期结果: MiniMap 内容在首屏渲染完成后尽快展示

## 风险评估
- **风险:** 触发时机不当可能导致 MiniMap 与画布坐标不同步
- **缓解:** 以画布视口/图片实例更新事件为触发源，并保留轻量兜底轮询
