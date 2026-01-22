# 任务清单: Flow 刷新渲染修复

目录: `helloagents/plan/202601221056_flow_refresh_render/`

---

## 1. FlowOverlay 水合与清空逻辑
- [ ] 1.1 在 `frontend/src/components/flow/FlowOverlay.tsx` 中加入项目切换判定，仅在 projectId 变化时清空节点，验证 why.md#需求-返回页面后-flow-正常渲染-场景-返回首页再进入项目
- [ ] 1.2 在 `frontend/src/components/flow/FlowOverlay.tsx` 中新增“已水合”标记并在写回前检查，验证 why.md#需求-首屏水合不写回空-flow-场景-进入项目后首屏水合，依赖任务1.1

## 2. 保存防护与回归检查
- [ ] 2.1 在 `frontend/src/components/flow/FlowOverlay.tsx` 中补充写回防护说明或轻量日志（若需要），验证 why.md#需求-首屏水合不写回空-flow-场景-进入项目后首屏水合，依赖任务1.2

## 3. 安全检查
- [ ] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 文档更新
- [ ] 4.1 评估是否需要更新 `helloagents/wiki/` 或 `frontend/docs/`（如无需更新请记录原因）

## 5. 测试
- [ ] 5.1 手动验证：返回首页再进入项目后 Flow 节点渲染正常且不覆盖保存
- [ ] 5.2 手动验证：刷新后首屏水合不写回空 Flow，随后正常保存
