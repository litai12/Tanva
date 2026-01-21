# 变更提案: 画布图片预览项目内列表

## 需求背景
当前双击画布图片会打开预览，但右侧缩略图列表基于全局历史拉全量数据后再本地过滤，导致展示范围过大且加载成本高。需要改为仅加载当前项目内的图片列表，并支持懒加载。

## 变更内容
1. 全局图片历史接口支持按项目 ID 过滤（sourceProjectId）。
2. 画布图片预览仅拉取当前项目的历史记录，并按分页懒加载。
3. 预览右侧缩略图滚动触底时自动加载更多，避免一次性拉全量。

## 影响范围
- **模块:** 全局图片历史 API、画布图片预览
- **文件:**
  - backend/src/global-image-history/dto/global-image-history.dto.ts
  - backend/src/global-image-history/global-image-history.service.ts
  - frontend/src/services/globalImageHistoryApi.ts
  - frontend/src/components/canvas/ImageContainer.tsx
  - frontend/src/components/ui/ImagePreviewModal.tsx
- **API:** GET /api/global-image-history (新增 sourceProjectId 查询参数)
- **数据:** 无

## 核心场景

### 需求: 画布双击图片时的项目内预览列表
**模块:** 画布图片预览
双击画布中的图片进入预览模式。

#### 场景: 右侧缩略图只展示当前项目图片
当前项目 ID 存在时，仅展示该项目关联图片，并在滚动到底部时继续加载。
- 预期结果: 列表不包含其他项目图片
- 预期结果: 列表按需分页加载，避免一次性全量请求

## 风险评估
- **风险:** 未拿到 projectId 时列表为空或回退逻辑不一致
- **缓解:** 缺少 projectId 时不触发请求并提示为空态，避免误显示全局数据
