# 变更提案: Image 节点发送到画布

## 需求背景
Image 节点已有图片预览，但缺少“发送到画布”能力，导致用户无法把当前节点图片一键落到画布，与 Generate/Camera/Three 等节点的操作不一致。

## 变更内容
1. 在 Image 节点内置操作区新增“发送到画布”按钮（放在左侧）
2. 复用现有的 Flow onSend 机制，将节点当前图片发送到画布

## 影响范围
- **模块:** Flow Image 节点
- **文件:** `frontend/src/components/flow/nodes/ImageNode.tsx`, `frontend/src/components/flow/FlowOverlay.tsx`
- **API:** 无
- **数据:** 不新增持久化字段

## 核心场景

### 需求: Image 节点发送到画布
**模块:** Flow / Image
Image 节点存在图片时，点击按钮应触发发送到画布；没有图片时按钮置灰并提示。

#### 场景: Image 节点存在图片
点击“发送到画布”后，画布新增对应图片。
- 预期结果：触发 `triggerQuickImageUpload` 并显示提示

#### 场景: Image 节点无图片
按钮不可用，提示“无可发送的图像”。
- 预期结果：不触发任何上传事件

## 风险评估
- **风险:** flow-asset 临时引用无法直接发送
- **缓解:** 复用已有 normalize 逻辑，过滤 flow-asset 引用
