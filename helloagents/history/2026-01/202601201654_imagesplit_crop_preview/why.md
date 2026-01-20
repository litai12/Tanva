# 变更提案: ImageSplit 裁剪链路输入展示修复

## 需求背景
ImageSplit 生成的图片节点包含裁剪元数据（crop），但下游节点（图片节点/拼合/多图生成等）在连接时未正确识别裁剪输入，导致预览或运行时使用整图，甚至出现不展示的情况。

## 变更内容
1. 修复 Image 节点对“上游 image 节点携带 crop”的解析与展示
2. 运行时解析图片输入时支持 image 节点 crop（用于 AI/生成/拼合等）
3. 保持设计 JSON 仅存远程引用 + 裁剪元数据，不落库 base64/blob

## 影响范围
- **模块:** Flow 节点链路（Image / ImageSplit / Generate*）
- **文件:** `frontend/src/components/flow/nodes/ImageNode.tsx`, `frontend/src/components/flow/FlowOverlay.tsx` 等
- **API:** 无
- **数据:** 仅使用既有 crop 元数据

## 核心场景

### 需求: ImageSplit 生成节点的裁剪输入下游可用
**模块:** Flow / Image nodes
ImageSplit 生成的图片节点连接到可接收图片的节点时，应展示裁剪后的内容，并在运行时按裁剪内容作为输入。

#### 场景: ImageSplit -> Image
连接后目标 Image 节点应显示裁剪预览（非整图）。
- 预期结果：Image 节点基于 crop + baseRef 进行 canvas 裁剪展示

#### 场景: ImageSplit -> Image -> Generate4
运行时应将裁剪后的图像作为输入，而非整图。
- 预期结果：生成请求使用裁剪后的 dataURL

## 风险评估
- **风险:** 上游 image 节点存在 crop 但 baseRef 为空导致解析失败
- **缓解:** 仅在 baseRef 有效时启用 crop 逻辑，回退为整图
