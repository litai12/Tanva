# 技术设计: Flow 刷新渲染修复

## 技术方案
### 核心技术
- React + ReactFlow
- Zustand store (`useProjectContentStore`)

### 实现要点
- 为 FlowOverlay 增加 `prevProjectIdRef`，仅在项目真正切换时清空节点，避免重新进入同一项目时清空已水合内容。
- 增加 `hasHydratedFlowRef`（或同等状态），当 Flow 从 store 水合完成后才允许写回；首屏水合前跳过 `scheduleCommit`。
- 保持现有 `hydratingFromStoreRef` 防环路逻辑，避免引入重复写回。

## 架构设计
无变更。

## 安全与性能
- **安全:** 不涉及权限或敏感数据变更
- **性能:** 增加少量状态判断，忽略不必要的写回

## 测试与部署
- **测试:** 手动验证“返回首页再进入”与“刷新后首屏”两个场景
- **部署:** 无特殊流程
