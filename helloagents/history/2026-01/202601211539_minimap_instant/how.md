# 技术设计: MiniMap 即时显示图片占位

## 技术方案
### 核心技术
- React + TypeScript
- Paper.js
- React Flow MiniMap

### 实现要点
- 在 `hydrate(content)` 完成后、Raster 未加载前，先构建/种子化 `imageInstances`（来源：`projectAssets.images` 或 `paperJson` 中的图片项）。
- 调整重建触发时机：在 `paper-project-imported` 触发时立即同步 `window.tanvaImageInstances`，并在 Raster 加载完成后再一次校准更新；对“事件早于监听”场景使用导入时间戳兜底触发。
- 若 `paper-project-imported` 触发时仍无法从 Paper items 读取实例，则回退到快照 bounds 兜底。
- MiniMap 覆盖层保留签名去重，避免频繁无效渲染。

## 安全与性能
- **安全:** 无新增输入路径，沿用现有运行时状态。
- **性能:** 使用签名比较/最小更新，避免高频重建与无效渲染。

## 测试与部署
- **测试:** 刷新含图片项目，检查 1 秒内 MiniMap 立即显示；等待 10 秒后不应再发生明显二次跳变。
- **部署:** 前端构建流程不变。
