# 技术设计: MiniMap 图片刷新异常修复

## 技术方案
### 核心技术
- React + TypeScript
- Paper.js
- React Flow MiniMap

### 实现要点
- 反序列化完成即触发 `paper-project-imported` 事件，提前重建运行时实例。
- paperJson 恢复路径按 `data.imageId` 匹配并重建 `imageInstances`，避免依赖 `data.type`。
- 若恢复重建结果为空，回退到快照 bounds 种子化 `imageInstances`，保证 `window.tanvaImageInstances` 立即可用。
- 图片加载完成后再覆盖更新实例数据，保持与 Paper.js 实际尺寸一致。

## 安全与性能
- **安全:** 无额外输入路径变更，遵循现有数据源读取。
- **性能:** 使用签名比较避免多余渲染，避免高频轮询。

## 测试与部署
- **测试:** 手动刷新含图片的项目，确认 MiniMap 立即显示；拖动/缩放后显示仍正确。
- **部署:** 前端静态构建与发布流程不变。
