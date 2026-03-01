# 任务清单: Flow MiniMap 拖拽时常驻

目录: `helloagents/plan/202601211256_flow_minimap_drag/`

---

## 1. MiniMap 可见性修复
- [√] 1.1 在 `frontend/src/components/flow/FlowOverlay.tsx` 中定位 MiniMap 隐藏逻辑，修复拖拽时被隐藏/卸载的问题，验证 why.md#需求-minimap-拖拽时常驻-场景-拖动画布节点
- [-] 1.2 若涉及样式控制，在 `frontend/src/index.css` 中补充/调整拖拽态样式，验证 why.md#需求-minimap-拖拽时常驻-场景-拖动画布节点，依赖任务1.1
> 备注: 当前仅需调整组件渲染条件，无需新增样式。

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md`

## 4. 测试
- [-] 4.1 手动测试：拖动画布/节点，MiniMap 持续可见
> 备注: 本地未执行手动测试。
