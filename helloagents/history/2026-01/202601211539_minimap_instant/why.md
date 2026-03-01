# 变更提案: MiniMap 即时显示图片占位

## 需求背景
刷新进入项目后，画布图片已渲染，但 MiniMap 仍需等待约 10 秒才出现绿色图片块，影响定位与导航。

## 变更内容
1. 明确“实例重建/同步”触发时机，避免依赖 Raster 异步加载。
2. 在数据到达时即填充 `window.tanvaImageInstances` 并触发刷新事件。

## 影响范围
- **模块:** 画布实例重建、MiniMap 覆盖层
- **文件:** `frontend/src/services/paperSaveService.ts`, `frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/components/canvas/hooks/useImageTool.ts`, `frontend/src/components/flow/MiniMapImageOverlay.tsx`
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: 刷新后 MiniMap 立即可见
**模块:** Flow Overlay
刷新页面后，MiniMap 需在 1 秒内显示图片占位块。

#### 场景: 图片已渲染但 MiniMap 不显示
刷新进入画布，画布图片已显示。
- MiniMap 立即出现绿色图片块，无需等待 10 秒或拖拽触发

## 风险评估
- **风险:** 提前触发重建可能与图片加载竞态，导致短暂位置不准。
- **缓解:** 先用快照 bounds 种子化，再在图片加载完成后覆盖更新。
