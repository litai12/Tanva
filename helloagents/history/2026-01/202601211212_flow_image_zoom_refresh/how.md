# 技术设计: Flow图片节点缩放刷新尺寸一致

## 技术方案
### 核心技术
- React + ReactFlow
- HTMLCanvas 渲染裁剪预览

### 实现要点
- 在 `CanvasCropPreview` 内使用布局尺寸（`offsetWidth/offsetHeight` 或 `clientWidth/clientHeight`）作为渲染基准，避免 ReactFlow 视口缩放的 CSS transform 影响。
- 当布局尺寸不可用时回退 `getBoundingClientRect` 并设置最小值，保证渲染稳定。
- 保持现有 ResizeObserver 逻辑，仅调整尺寸来源，减少回归风险。

## 安全与性能
- **安全:** 无新增输入面。
- **性能:** 避免 transform 尺寸导致额外缩放绘制，降低重复放大带来的像素处理开销。

## 测试与部署
- **测试:** 手动验证放大后刷新，图片节点内部尺寸与缩放前一致。
- **部署:** 无特殊步骤。
