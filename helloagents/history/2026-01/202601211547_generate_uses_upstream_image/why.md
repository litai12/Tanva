# 变更提案: Generate 使用上游图片节点渲染图

## 需求背景
Multi-generate → Image → Generate 线性链路中，点击 Generate 节点 run 时没有使用上游 Image 节点的展示图片（预期使用原图/当前渲染图）。

## 变更内容
1. 明确 Generate 节点获取上游图片的优先级与来源。
2. 修复未读取上游图片资源的问题，保证使用当前节点展示图。

## 影响范围
- **模块:** Flow 节点链路、图片资源解析
- **文件:** `frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/components/flow/nodes/ImageNode.tsx`, `frontend/src/components/flow/nodes/*`（以实际实现为准）
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: Generate 读取上游图片
**模块:** Flow 生成链路
线性连接的 Multi-generate → Image → Generate 链路，点击 Generate 节点 run。

#### 场景: 使用 Image 节点展示图
Generate 使用上游 Image 节点当前展示的图片（原图，不经过 Image Split）。
- 不出现空图/未使用上游图片

## 风险评估
- **风险:** 上游图片引用来源多样（remote URL / key / flow-asset），解析失败可能导致生成空图。
- **缓解:** 统一走现有图片资源解析工具，优先使用当前渲染资源并保留回退路径。
