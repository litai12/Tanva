# 技术设计: MiniMap 刷新延迟展示修复

## 技术方案
### 核心技术
- React + React Flow MiniMap
- Canvas/PaperJS 运行时图片实例（`window.tanvaImageInstances`）

### 实现要点
- 在 `DrawingController` 更新 `tanvaImageInstances` 时发出可订阅事件/标记（如自定义事件或 store 订阅），供 MiniMap 立即刷新。
- `MiniMapImageOverlay` 优先使用事件/订阅驱动更新，保留轻量轮询作为兜底，避免长延迟。
- 在 MiniMap SVG/graph 未就绪前做安全判断，避免竞态。

## 安全与性能
- **安全:** 不引入持久化变更；仅前端运行时同步
- **性能:** 以事件触发代替高频轮询，避免无意义的 rAF 空转

## 测试与部署
- **测试:** 手动刷新页面验证 1s 内展示；确认缩放/拖动/切换项目不回归
- **部署:** 前端发布流程
