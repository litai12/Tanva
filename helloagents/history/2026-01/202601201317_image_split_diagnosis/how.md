# 技术设计: ImageSplit 诊断与修复

## 技术方案
### 核心技术
- React + React Flow 节点数据流
- OffscreenCanvas / canvas 裁剪
- 运行时资源引用（flow-asset / blob）

### 实现要点
- 诊断预览分辨率下降来源：
  - ImageSplitNode 中的运行时重编码（`normalizeBlobForRuntime`）。
  - ImageNode 预览渲染（CanvasCropPreview 的 contain 缩放）。
  - 下游节点读取的是原图还是缩略图/裁剪图。
- 修复下游节点取图逻辑：
  - 当 Image 节点存在 crop 信息时，提供运行时裁剪后的图像数据给下游。
  - 保持持久化只存远程引用 + crop 参数；避免写入 base64/blob。
- 保证 ImageSplit 连接路径一致性：
  - ImageSplit 输出 -> Image 节点 -> 其他图片接口的传递链路统一使用裁剪结果。

## 架构设计
无需新增架构组件。

## 安全与性能
- **安全:** 禁止 dataURL/blob 落库，保存前强制上传并替换为远程引用。
- **性能:** 裁剪在运行时进行，避免重复重编码与大尺寸 canvas 造成内存峰值。

## 测试与部署
- **测试:** 本地复现实例验证预览清晰度与下游节点输入一致性。
- **部署:** 无特殊要求。
