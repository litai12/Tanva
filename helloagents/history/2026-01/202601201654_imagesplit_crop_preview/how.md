# 技术设计: ImageSplit 裁剪链路输入展示修复

## 技术方案
### 核心技术
- React Flow 节点数据解析
- Canvas 裁剪预览（现有 CanvasCropPreview）

### 实现要点
- Image 节点解析上游输入时优先使用自身 data.imageUrl/imageData，再回溯上游，避免 imageSplit -> image 的 pass-through 丢失
- Image 节点在连接到上游 image 节点时，识别其 crop 并使用 baseRef 渲染裁剪预览
- FlowOverlay 运行时解析图片输入时，若源节点为 image/imagePro 且存在 crop，直接走裁剪逻辑生成 dataURL

## 架构设计
无

## 架构决策 ADR
无

## API设计
无

## 数据模型
无

## 安全与性能
- **安全:** 保持设计 JSON 仅存远程引用 + crop 元数据，不落库 base64/blob
- **性能:** 仅在运行时或预览时按需裁剪，避免生成多余图片资源

## 测试与部署
- **测试:** 手动回归 ImageSplit -> Image / ImageGrid / Generate4 链路展示与运行
- **部署:** 前端重新构建即可
