# 变更提案: MiniMap 图片刷新异常修复

## 需求背景
页面刷新后，画布内图片节点仍存在，但 MiniMap 内不显示，需要等待并拖动图片后才出现，影响定位与导航。

## 变更内容
1. 明确 MiniMap 图片覆盖层的更新时机与数据来源。
2. 修复图片在初次加载/回填后 MiniMap 不刷新的问题。

## 影响范围
- **模块:** 画布图片实例同步、MiniMap 覆盖层
- **文件:** `frontend/src/components/flow/MiniMapImageOverlay.tsx`, `frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/components/canvas/hooks/useImageTool.ts`
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: 页面刷新后的 MiniMap 显示
**模块:** MiniMap 覆盖层
页面刷新并回填图片资产后，MiniMap 需要立即显示图片位置。

#### 场景: 刷新后无需交互即可看到图片
刷新进入画布后，无需等待拖动图片。
- MiniMap 立即呈现图片的占位矩形

## 风险评估
- **风险:** 更新时序调整可能引入额外刷新开销或重复渲染。
- **缓解:** 仅在图片实例或 bounds 变化时触发更新，保留去抖/签名判断。
