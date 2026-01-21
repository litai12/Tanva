# 技术设计: 画布图片预览项目内列表

## 技术方案
### 核心技术
- React + TypeScript
- NestJS + Prisma

### 实现要点
- 后端查询 DTO 增加 sourceProjectId，并在 list 查询条件中追加过滤。
- 前端 globalImageHistoryApi.list 支持 sourceProjectId 参数。
- ImageContainer 内部维护项目级历史分页状态（items/hasMore/nextCursor/isLoading）。
- ImagePreviewModal 增加滚动触底回调 onLoadMore，并透出 loading/hasMore 状态。

## API设计
### GET /api/global-image-history
- **请求:** query 参数新增 sourceProjectId
- **响应:** 结构不变（items/nextCursor/hasMore）

## 安全与性能
- **安全:** 仍按 userId 范围查询，sourceProjectId 仅作为附加过滤条件。
- **性能:** 前端避免拉全量，预览列表按分页懒加载。

## 测试与部署
- **测试:**
  - 双击画布图片后，右侧列表仅显示当前项目图片。
  - 滚动到列表底部自动加载更多，直到 hasMore=false。
  - 不同项目间切换后列表正确刷新。
- **部署:** 常规前后端发布流程。
