# 变更提案: Flow 刷新渲染修复

## 需求背景
从首页返回画布页时，项目数据拉取成功且 `content.flow` 有节点，但 Flow 画布不渲染；随后自动保存触发，导致 `flow.nodes` 被写成空数组，数据被覆盖。

## 变更内容
1. FlowOverlay 仅在项目切换时清空节点，避免重新进入同一项目时清空刚水合的数据。
2. FlowOverlay 写回前增加“已水合”保护，避免首屏空节点被保存覆盖。

## 影响范围
- **模块:** Flow Overlay / 项目内容保存
- **文件:** `frontend/src/components/flow/FlowOverlay.tsx`
- **API:** 无
- **数据:** `Project.contentJson.flow`

## 核心场景

### 需求: 返回页面后 Flow 正常渲染
**模块:** FlowOverlay
返回首页后再次进入项目时，Flow 节点应按 `content.flow` 渲染。

#### 场景: 返回首页再进入项目
数据已拉取且 `flow` 有节点。
- Flow 节点正常渲染
- 不触发空节点覆盖保存

### 需求: 首屏水合不写回空 Flow
**模块:** FlowOverlay/自动保存
进入项目后，Flow 处于首屏水合阶段时不应写回空节点。

#### 场景: 进入项目后首屏水合
Flow 节点尚未写入 ReactFlow 状态。
- 不将空数组写回 `content.flow`
- 水合完成后再允许保存

## 风险评估
- **风险:** 保存保护条件过严导致某些变更不落库
- **缓解:** 仅在“尚未完成水合”阶段阻止写回，水合完成后恢复正常保存
