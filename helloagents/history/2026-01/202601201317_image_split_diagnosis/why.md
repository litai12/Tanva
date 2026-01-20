# 变更提案: ImageSplit 诊断与修复

## 需求背景
当前前端 ImageSplit 流程出现两类问题：
1) 分割后的图片预览被认为出现分辨率下降。
2) 生成 Image 子节点后连接图片分析/其他图片接口时，展示的仍是分割前的原图。

## 变更内容
1. 梳理 ImageSplit 从输入、切分、预览到下游节点传递的全链路。
2. 确认分辨率下降的来源（是否为预览缩放、运行时重编码或传递缩略图）。
3. 让下游节点使用裁剪后的图片内容（而非原图）。

## 影响范围
- **模块:** Flow 节点/ImageSplit、Image 节点渲染、图片输入传递
- **文件:** `frontend/src/components/flow/nodes/ImageSplitNode.tsx`，`frontend/src/components/flow/nodes/ImageNode.tsx`，`frontend/src/workers/imageSplitWorker.ts`，相关图片输入解析处
- **API:** 无
- **数据:** 仅运行时裁剪；持久化仍保留远程 URL/OSS key + crop 参数

## 核心场景

### 需求: ImageSplit Preview Fidelity
**模块:** Flow / ImageSplit
预览不应因流程导致分辨率下降，若仅是显示缩放需明确。

#### 场景: Preview matches source
使用高分辨率输入图像进行分割，预览清晰度与原图一致（仅按容器缩放）。

### 需求: Downstream nodes use cropped image
**模块:** Flow / Image 节点输出
生成子节点并连接图片分析/其他接口时，应使用裁剪后的子图。

#### 场景: Image analysis uses crop
ImageSplit -> Image -> 图片分析节点，分析输入为裁剪后的区域而非原图。

## 风险评估
- **风险:** 错误地持久化 dataURL/blob，违反设计 JSON 约束
- **缓解:** 裁剪仅在运行时生成；保存前强制上传并替换为远程引用
