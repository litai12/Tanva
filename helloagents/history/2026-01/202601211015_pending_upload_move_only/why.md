# 变更提案: 上传中图片仅允许移动

## 需求背景
当前 Paper 画布内处于 OSS 上传中的图片资源无法进行任何操作，影响排版和预览效率。期望在上传未完成时允许拖拽移动，以便用户先完成布局，同时继续限制其他高风险操作。

## 变更内容
1. 上传中图片支持拖拽移动位置。
2. 上传中图片禁用调整尺寸、删除、替换、编辑等操作，仅保留移动。

## 影响范围
- **模块:** 前端画布交互、图片工具
- **文件:**
  - `frontend/src/components/canvas/hooks/useInteractionController.ts`
  - `frontend/src/components/canvas/DrawingController.tsx`
  - `frontend/src/components/canvas/ImageContainer.tsx`
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: 上传中图片可移动
**模块:** 画布交互
上传中的图片仍可被选中并拖拽移动。

#### 场景: 用户上传图片后立即调整位置
上传进行中
- 预期结果: 可拖拽移动位置
- 预期结果: 禁止缩放/删除/替换/编辑

## 风险评估
- **风险:** 上传中移动可能触发状态同步异常或误触发编辑行为。
- **缓解:** 统一在交互层面拦截非移动操作，仅更新坐标并保留 pendingUpload 标记。
