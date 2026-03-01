# 任务清单: Flow图片节点缩放刷新尺寸一致

目录: `helloagents/plan/202601211212_flow_image_zoom_refresh/`

---

## 1. 图片节点渲染
- [√] 1.1 在 `frontend/src/components/flow/nodes/ImageNode.tsx` 中将 `CanvasCropPreview` 的尺寸来源改为布局尺寸（`offsetWidth/offsetHeight` 或 `clientWidth/clientHeight`），验证 why.md#需求-图片节点缩放后刷新尺寸一致-场景-放大后刷新
- [√] 1.2 在 `frontend/src/components/flow/nodes/ImageNode.tsx` 中加入尺寸回退与最小值保护，验证 why.md#需求-图片节点缩放后刷新尺寸一致-场景-放大后刷新，依赖任务1.1

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md`

## 4. 测试
- [-] 4.1 手动测试：滚轮放大画布 → 刷新页面 → 图片节点内部渲染尺寸一致
> 备注: 本地未执行手动测试。
