# 前端模块：Flow（frontend-flow）

## 作用
- 提供流程/节点编排能力（ReactFlow），并与画布/素材/生成等能力联动。

## 关键目录（节选）
- `frontend/src/components/flow/FlowOverlay.tsx`：Flow 主入口（体量较大）
- `frontend/src/components/flow/nodes/`：节点实现（含进度条、生成节点等）
- `frontend/src/components/flow/types.ts`：类型定义
- `frontend/src/components/flow/utils/`：辅助逻辑
- `frontend/src/components/flow/PersonalLibraryPanel.tsx`：个人库面板（与后端 personal-library 相关）

## 规范
### 需求: 图片节点缩放后刷新尺寸一致
**模块:** Flow 图片节点
图片节点在画布放大后刷新页面，内部渲染尺寸应保持一致，不随缩放倍数被重复放大。

#### 场景: 放大后刷新
画布滚轮放大后刷新页面。
- 图片节点内部渲染尺寸与缩放前一致

### 需求: MiniMap 拖拽时常驻
**模块:** Flow 画布
拖动画布或拖动节点过程中，MiniMap 始终可见且不闪烁。

#### 场景: 拖动画布/节点
在同一页面拖动画布或节点。
- MiniMap 持续可见

### 需求: MiniMap 刷新后快速展示
**模块:** Flow Overlay
刷新页面后，MiniMap 应及时展示画布图片/节点概览。

#### 场景: 刷新后 1s 内展示
刷新页面进入项目。
- MiniMap 在 1s 内出现图片/节点概览（不等待长延迟）

## 图片与内存
- **原则**：不要在 `content.flow`（项目内容 JSON）里持久化大体积 base64；这会导致序列化/对比/自动保存时产生巨型临时字符串并推高内存。
- **Flow 图片资产**：`frontend/src/services/flowImageAssetStore.ts` 的 `flow-asset:<id>` 仅用于运行期/本地缓存；**保存到后端前必须替换为远程 URL/OSS key**（否则会被阻止保存/或被后端清洗丢弃）。当前通过 `frontend/src/services/flowSaveService.ts` 在保存链路里自动补传并替换（优先覆盖 `Image Split` 的输入图引用）。
- **Image Split 持久化（方案A）**：运行时可用 `inputImageUrl=flow-asset:` 做分割/下游裁切；保存到后端前会补传并替换为 `inputImageUrl`（远程 URL/OSS key）+ `splitRects[]`（裁切矩形）+ `sourceWidth/sourceHeight`，切片图片本身不落库。渲染/下游（例如 `Image Grid`）按需从原图裁切。
- **Image Split 输出端口数**：节点配置使用“输出端口数量(1-50)”，Worker 会按 `cols=ceil(sqrt(count))`、`rows=ceil(count/cols)` 做网格裁切；例如 2048x2048 要得到 512x512 的 4x4 切片，应将输出端口设为 `16`（仅裁切不缩放）。
- **裁切输出尺寸**：下游按 `splitRects[].width/height`（源坐标系）作为输出尺寸；当 base 图像只加载到缩略图（`naturalW < sourceWidth`）时，仍会输出正确尺寸（避免 1024 误变 200）。
- **Image 节点裁切透传**：`Image`/`ImagePro` 节点带 `crop` 时，下游聚合（如 `Image Grid`）会优先按 `crop` 裁切再拼合，避免回退到整图；节点连接链路中也支持读取上游 `Image` 的 `crop` 进行裁剪预览。
- **Image 节点发送到画布**：Image 节点在有图片资源时可一键发送到画布；发送内容以节点当前渲染资源为准（含 `crop`/ImageSplit 裁剪预览），避免回退为整图。
- **Analysis 裁切继承**：`Analysis` 节点在输入为 `Image/ImagePro` 时会递归向上游查找 `crop`/`ImageSplit`，以确保链路中转后仍使用裁剪结果。
- **Analysis 断开清空**：断开图片连线后会清理节点内残留的 `imageData/imageUrl`，预览恢复为空状态。
- **Worker 计算**：`Image Split` 使用 `frontend/src/workers/imageSplitWorker.ts` 在 Worker 内解码并计算裁切矩形，避免主线程做像素级扫描与 `toDataURL` 产生的峰值。

## 缺陷复盘
- **问题现象:** 画布放大后刷新，Image 节点裁剪预览尺寸变大。
- **根因:** 预览尺寸使用 `getBoundingClientRect`，被 ReactFlow 视口缩放 transform 影响。
- **修复:** 改用布局尺寸（`offsetWidth/clientWidth`）作为基准，回退时才读取 `getBoundingClientRect`。
- **预防:** 渲染尺寸计算优先使用布局尺寸，避免受 transform 影响。
- **问题现象:** 拖动画布/节点时 MiniMap 消失。
- **根因:** MiniMap 在 `isNodeDragging` 为 true 时被条件隐藏。
- **修复:** 去除拖拽态隐藏逻辑，保持仅在专注模式下隐藏。
- **预防:** 可视性依赖业务模式（如专注模式），避免与交互态绑定。
- **问题现象:** 刷新后 MiniMap 图片/节点概览延迟 30s 才出现。
- **根因:** MiniMap 仅依赖轮询读取 `window.tanvaImageInstances`，且缺少实例更新事件通知。
- **修复:** 增加 `tanva-image-instances-updated` 事件驱动更新，保留 1s 兜底轮询。
- **预防:** 对画布实例变更提供事件通知，避免单一轮询。
- **问题现象:** 刷新后 MiniMap 未显示图片占位，需要拖动图片后才出现。
- **根因:** 反序列化等待 Raster 加载后才触发重建事件，且事件可能早于监听注册导致丢失；重建失败时也未回退到快照数据。
- **修复:** 反序列化完成立即触发 `paper-project-imported` 并记录导入时间戳兜底触发；恢复路径按 `data.imageId` 匹配并在失败时用快照 bounds 兜底种子化 `imageInstances`。
- **预防:** 导入完成即触发重建事件，并提供一次性兜底触发避免丢事件。
- **问题现象:** Multi-generate → Image → Generate 链路中，Generate 未使用上游 Image 节点展示图。
- **根因:** Generate 输入解析对 Image 节点优先回溯上游，忽略 Image 节点本身的当前渲染数据。
- **修复:** 输入解析优先使用 Image 节点的 `imageData/imageUrl/thumbnail`，再回溯上游；解析失败时对 proxy URL 进行带鉴权兜底拉取。
- **预防:** 下游输入解析需以当前节点展示资源为准，再做链路回溯。
- **问题现象:** Generate 读取 OSS 直链时跨域导致图片未被使用。
- **根因:** 前端需要将图片转成 dataURL，跨域拉取失败导致输入为空。
- **修复:** 生成链路允许传递远程 URL，由后端下载转码后处理。
- **预防:** 对跨域资源优先走后端拉取，避免前端 CORS 限制。

## 3D 模型节点
- 三维节点（`frontend/src/components/flow/nodes/ThreeNode.tsx`）选择模型文件后会上传至 OSS，并将 `modelUrl` 持久化为远程引用，避免 `blob:` 等临时 URL 进入 `content.flow`。
- 加载远程模型/图片时默认可通过 `proxifyRemoteAssetUrl` 走 `/api/assets/proxy`，以规避 OSS CORS（受 `VITE_PROXY_ASSETS` 控制）。若 OSS 已配置 CORS 且希望禁用 proxy，请设置 `VITE_PROXY_ASSETS=false` 并配置 `VITE_ASSET_PUBLIC_BASE_URL`（用于把 `projects/...` 这类 key 直接拼成可访问 URL）。
- Three.js 渲染器尺寸以容器 `clientWidth/clientHeight` 为准，并使用 `renderer.setSize(w, h, false)` 仅更新绘制缓冲（不改写 canvas 的样式尺寸），避免节点 resize 时 canvas 未铺满可视区域。

## 依赖
- `reactflow`
