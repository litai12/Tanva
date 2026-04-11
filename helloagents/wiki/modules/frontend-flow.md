# 前端模块：Flow（frontend-flow）

## 作用
- 提供流程/节点编排能力（ReactFlow），并与画布/素材/生成等能力联动。

## 关键目录（节选）
- `frontend/src/components/flow/FlowOverlay.tsx`：Flow 主入口（体量较大）
- `frontend/src/components/flow/nodes/`：节点实现（含进度条、生成节点等）
- `frontend/src/components/flow/types.ts`：类型定义
- `frontend/src/components/flow/utils/`：辅助逻辑
- `frontend/src/components/flow/PersonalLibraryPanel.tsx`：个人库面板（与后端 personal-library 相关）

## 双语适配补充
- `FlowOverlay` 的添加面板中，`Templates`/`Custom` 相关空态文案、模板占位文案、模板分类筛选标签已统一走双语文案；并对分类值 `其他/Other` 做显示层映射，避免英文模式下出现中文分类芯片。

## 节点可见性补充
- `FlowOverlay` 使用统一隐藏集合控制节点可见性；当前 `sora2Video`（Sora 2）、`sora2Character`（Sora2 Character）与 `nano2`（Nano2）在节点添加面板与 Quick Connect 候选中默认隐藏。
- 节点添加面板分组不能直接把 `category: "input"` 视为“文字类节点”；输入节点仍需继续按 `nodeKey`/解析后的节点类型细分到 `text / image / video / audio`，否则 `video` 这类输入节点会被误归到文字分组。
- `Vidu` 视频能力已收拢为单一 `viduVideo` 入口；节点内模型只展示 `Q2 / Q3` 两档，面板不再额外展示多个同品牌 Vidu 节点。运行时仅支持 `vidu-q2 / vidu-q3` 两个后端模型，并根据 `viduModel` 自动切换 provider、时长与参考图上限。
- `Seedance 2.0` 节点已从“手动模式切换”收敛为“最大输入能力 + 自动推导模式”：节点始终展示 `text / 9 个图片槽位 / 尾帧 / video / audio` 句柄，运行时按已连接输入自动推导为 `文生视频 / 首帧 / 首尾帧 / 多图参考 / 视频参考 / 图片+音频 / 图片+视频 / 视频+音频 / 图片+视频+音频`，并通过 `video_mode` 下发到上游请求。
- `Seedance 2.0` 多图输入统一走 `image-slot-*` 句柄，最多支持 `1-9` 张参考图；旧流程中的 `smart_frames` 会在前端自动按 `reference_images` 兼容处理，不再单独展示“智能多帧”模式。
- 模型管理删除模型后，Flow 节点添加面板不应继续展示对应模型节点：
  - 后端公开节点接口只会从“节点管理”里读取节点配置，再按 `model_provider_mapping_v2.models[]` 过滤带 `metadata.modelKeys` 的模型节点。
  - 前端在有后端节点配置时，不再把这类默认模型节点作为 fallback 自动补回面板；后端不可用时的本地 fallback 也不再硬编码这些模型派生视频节点。
- 管理后台“节点管理”支持“从模型管理导入”：
  - 导入入口会读取当前动态 `model_provider_mapping_v2`，并基于选中的模型自动创建一条显式 `NodeConfig`。
  - 导入只负责加速创建；画布节点仍只认节点管理中的显式配置，不会被模型管理 JSON 直接派生。
- 管理后台“系统设置”同时提供两种模型管理入口：
  - `统一模型管理`：直接编辑完整 `model_provider_mapping_v2` JSON，包括模型/厂商启停、默认线路、厂商积分与 `metadata.specPricing` 规格积分规则；默认会带出当前平台已接入的图片模型（Nano Banana / Gemini 系列）与视频模型，左侧列表支持按关键字和任务类型筛选，图片模型的规格积分编辑会按模型能力维度展示，例如文生图仅显示尺寸/质量/出图数，图像编辑与参考图生成会额外显示参考图数量，图像分析则收敛为分析单价。
  - `视频模型管理`：仅用于快速切换 sora2 / seedance / kling / vidu 的默认供应商路线。
- `Vidu` 节点内的模型下拉也受模型管理约束：
  - 后端会把 `viduVideo.metadata.supportedModels` 裁剪为当前仍启用的 `vidu-q2 / vidu-q3` 子集；前端从模型管理导入节点配置时也只会写入 `q2 / q3`。
  - 若画布上已有旧节点指向已删除子模型，前端会自动回退到第一个仍可用的 `viduModel`。
- 模型管理里的线路价格会覆盖节点管理价格：
  - 公开节点配置接口会把 `model_provider_mapping_v2` 中默认 vendor 的 `creditsPerCall` 动态回填到对应 Flow 节点。
  - 画布上的模型管理视频节点支持切换 `vendorKey` 线路；切换后运行按钮旁的积分徽标会即时回显该线路价格，并把 `managedModelKey/vendorKey/platformKey` 一起传给后端。
- 统一模型管理已开始从旧 `specPricing` 过渡到正式 `pricing`：
  - 管理台厂商卡片现在支持默认积分、默认价格(元)以及规格规则的积分/价格维护。
  - 后端公开节点接口会优先读取 vendor `pricing.defaults`，旧 `creditsPerCall` 仍作为兼容回退。

## 音频节点
- `minimaxSpeech`：文本转语音节点，输出 `audio` 句柄。
- `minimaxMusic`：音乐生成节点，支持 `prompt`、`lyrics`、`isInstrumental`、`lyricsOptimizer`，调用 `/api/ai/minimax-music`，输出 `audio` 句柄，可连接 `wan26` / `audioUpload` / Kling 音频输入。

## 规范
### 需求: 视频转 GIF 节点
**模块:** Flow 视频工具节点
支持在 Flow 中将视频节点输出转换为 GIF，并以远程 URL 持久化输出（不落库 base64/blob）。

#### 场景: 视频节点 -> Video to GIF（终端下载）
连接视频输入后，严格按输入视频时长转换（无需手动设置时长），可选调整 FPS/宽度并执行转换。
- 结果返回可访问的 GIF URL
- 节点仅保留输入句柄，不再提供右侧输出句柄
- 不再提供“无限循环”选项（固定为非无限循环）
- 生成成功后可在节点右上角直接下载 GIF（不再在节点底部展示“打开原图”链接）
- 后端已接入积分系统：每次转换预扣 30 积分，转换失败自动退款并写入积分流水

### 需求: 图片节点缩放后刷新尺寸一致
**模块:** Flow 图片节点
图片节点在画布放大后刷新页面，内部渲染尺寸应保持一致，不随缩放倍数被重复放大。

#### 场景: 放大后刷新
画布滚轮放大后刷新页面。
- 图片节点内部渲染尺寸与缩放前一致

### 需求: Image 节点标题可双击重命名
**模块:** Flow 图片节点
Image 节点标题支持双击进入编辑态，方便在流程中快速区分多个图片输入节点。

#### 场景: 双击标题重命名
用户双击节点标题（默认 `Image`）后可直接输入新名称。
- `Enter` 或失焦保存并回写 `data.label`
- `Escape` 取消本次编辑

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
- `frontend/src/components/flow/MiniMapImageOverlay.tsx` 已清理残余中文注释（无功能改动），用于保持双语扫描基线准确。

### 需求: 可连接节点首项固定基础节点
**模块:** Flow Quick Connect
自动选择可连接节点时，首项必须固定为当前输入类型的基础节点，避免高频使用排序把基础入口挤出前列。

#### 场景: Prompt / Image 自动连接
从文本输出触发自动连接时，首项为 `textPrompt`；从图片输出触发自动连接时，首项为 `image`。
- 其余候选节点仍按使用频率排序

### 需求: 连线颜色模式可切换
**模块:** Flow Overlay / Flow 设置
支持在工具栏切换连线颜色显示策略，兼顾统一视觉与类型识别。

#### 场景: 标准色 / 跟随句柄
用户可在「设置 -> 视图外观」中切换连线颜色模式（Flow 工具栏也可快捷切换）。
- `标准色`：全部连线使用统一灰色
- `跟随句柄`：连线颜色跟随句柄类型（文本/图片/视频/多图/音频）

### 需求: 节点拖拽自动对齐
**模块:** Flow Overlay
Flow 节点拖拽支持与其他节点进行边缘/中心吸附，并显示对齐参考线（复用画布图片自动对齐的同款算法与全局开关）。

#### 场景: 拖拽节点接近其他节点
用户拖动一个或多个节点靠近其他节点时。
- 在吸附阈值内自动贴齐（left/right/top/bottom/center）
- 显示红/粉色参考线提示当前对齐关系
- 结束拖拽后自动清理参考线

### 需求: Multi Generate 固定 4 张
**模块:** Flow 生成节点（`generate4`）
`Multi Generate` 节点固定输出 4 张图，不再暴露可编辑的数量配置，避免 UI 配置与实际执行次数分叉。

#### 场景: 运行 Multi Generate
用户点击运行 `Multi Generate` 节点。
- 节点执行始终按 4 轮生成
- 节点面板不再显示 `Count/数量` 输入框
- 新建节点默认数据只保留 `status/images`，不再持久化 `count`

## 图片与内存
- **原则**：不要在 `content.flow`（项目内容 JSON）里持久化大体积 base64；这会导致序列化/对比/自动保存时产生巨型临时字符串并推高内存。
- **Flow 图片资产**：`frontend/src/services/flowImageAssetStore.ts` 的 `flow-asset:<id>` 仅用于运行期/本地缓存；**保存到后端前必须替换为远程 URL/OSS key**（否则会被阻止保存/或被后端清洗丢弃）。当前通过 `frontend/src/services/flowSaveService.ts` 在保存链路里自动补传并替换（优先覆盖 `Image Split` 的输入图引用）。
- **Image Split 持久化（方案A）**：运行时可用 `inputImageUrl=flow-asset:` 做分割/下游裁切；保存到后端前会补传并替换为 `inputImageUrl`（远程 URL/OSS key）+ `splitRects[]`（裁切矩形）+ `sourceWidth/sourceHeight`，切片图片本身不落库。渲染/下游（例如 `Image Grid`）按需从原图裁切。
- **Image Split 分割模式**：节点支持 `智能分割` 与 `自定义网格` 两种模式。`智能分割` 保持原行为（连通域检测，失败时按 `cols=ceil(sqrt(count))` 回退网格）；`自定义网格` 通过 `列 × 行`（例如 `4 × 2`）固定切片布局，输出端口数自动同步为 `cols*rows`，并限制总数不超过 `50`。
- **裁切输出尺寸**：下游按 `splitRects[].width/height`（源坐标系）作为输出尺寸；当 base 图像只加载到缩略图（`naturalW < sourceWidth`）时，仍会输出正确尺寸（避免 1024 误变 200）。
- **Image 节点裁切透传**：`Image`/`ImagePro` 节点带 `crop` 时，下游聚合（如 `Image Grid`）会优先按 `crop` 裁切再拼合，避免回退到整图；节点连接链路中也支持读取上游 `Image` 的 `crop` 进行裁剪预览。
- **Generate 输入预览一致性**：`Generate` 节点顶部输入缩略图会识别 `Image/ImagePro.crop` 与 `ImageSplit.splitRects`，按裁切区域渲染缩略图；避免预览显示整图但实际运行已按裁切传参的认知偏差。
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
- **问题现象:** `Analysis` 节点在生产环境偶发“图片加载失败/缺少图片输入”，本地难复现。
- **根因:** 输入解析只尝试首个候选字段（常为失效 `imageData` 临时引用）而未回退到 `imageUrl`；同时远程 URL 在 `VITE_PROXY_ASSETS=false` 下可能仅走浏览器直连，受 CDN CORS 差异影响。
- **修复:** `AnalyzeNode` 改为多候选顺序回退（`imageData → imageUrl → output/thumbnail`），裁切链路支持多 baseRef 回退；`resolveImageToDataUrl/resolveImageToBlob` 对白名单远程 URL 增加“强制 `/api/assets/proxy`”候选兜底；移除分析缩略图预览中对 `crossOrigin=anonymous` 的硬依赖。
- **预防:** 分析/生成等下游取图统一采用“多候选 + 代理兜底”策略，避免运行时临时引用失效与跨域环境差异放大。
- **问题现象:** `ViewAngle` 节点偶发报错“缺少图片输入”，但上游 `Image` 节点画面可见。
- **根因:** 输入解析在多个候选字段（`imageData/imageUrl/thumbnail`）中只尝试第一个值；当首个值是失效临时引用（如旧 `blob:`）时，未回退到后续有效 `imageUrl`。
- **修复:** 在 `FlowOverlay.runNode` 解析链路新增“候选图片逐个回退”逻辑，`resolveNodeImageToDataUrl` 在 `image/imageGrid/imageCompress/videoFrameExtract/generate4` 等分支均改为按候选顺序逐一解析，直到成功。
- **预防:** 下游取图不应单点依赖某一个字段；应以“多候选 + 可恢复失败”方式解析，避免临时态残留引发误判。
- **问题现象:** 线上生成/上传图片后刷新，偶发出现可选中但不显示的“幽灵图”。
- **根因:** 上传开始时先写入预分配 OSS key（`imageUrl`），失败后未回滚；保存链路会清理 `blob:/data:` 预览，导致刷新后只剩不存在的 key。
- **修复:** `ImageNode` 上传失败时回滚预分配 key（仅在当前节点仍使用该 key 时生效），并保留可重试的运行时预览；保存校验新增“`uploading=true` 且携带图片数据”的 Flow 节点阻断，避免上传未完成时落库不稳定引用。
- **预防:** 上传中引用不得视作可持久化来源；仅在上传成功并拿到可验证的远程引用后写入 `imageUrl`。

## 3D 模型节点
- 三维节点（`frontend/src/components/flow/nodes/ThreeNode.tsx`）选择模型文件后会上传至 OSS，并将 `modelUrl` 持久化为远程引用，避免 `blob:` 等临时 URL 进入 `content.flow`。
- 加载远程模型/图片时默认可通过 `proxifyRemoteAssetUrl` 走 `/api/assets/proxy`，以规避 OSS CORS（受 `VITE_PROXY_ASSETS` 控制）。若 OSS 已配置 CORS 且希望禁用 proxy，请设置 `VITE_PROXY_ASSETS=false` 并配置 `VITE_ASSET_PUBLIC_BASE_URL`（用于把 `projects/...` 这类 key 直接拼成可访问 URL）。
- Three.js 渲染器尺寸以容器 `clientWidth/clientHeight` 为准，并使用 `renderer.setSize(w, h, false)` 仅更新绘制缓冲（不改写 canvas 的样式尺寸），避免节点 resize 时 canvas 未铺满可视区域。
- `ThreeNode` 的 Path Tracing 模式不能只依赖 `scene.background`；需要可采样的 `scene.environment` 才能避免射线打空后回落到黑底。当前使用代码生成的 equirect 渐变环境图，并为普通栅格渲染额外生成 PMREM 版本；PT 使用原始 equirect 环境，栅格使用 PMREM，配合偏白背景和柔和主光模拟克制的白天效果。

## 依赖
- `reactflow`

## 语音节点补充
- 新增 `TencentSpeechNode`（`frontend/src/components/flow/nodes/TencentSpeechNode.tsx`），对应节点类型 `tencentSpeech`。
- 新增系统音色数据源 `frontend/src/components/flow/nodes/tencentSystemVoices.ts`（252 条，来源腾讯云文档 `https://cloud.tencent.com/document/product/862/129151`），用于节点内可检索下拉选择。
- 该节点对接后端 `POST /api/ai/tencent-speech`，参数按腾讯 MPS AI 配音文档映射：
  - `text + voiceId` 模式：前端通过 `text` 句柄接入 Prompt 节点文本，并可填写 `voiceId`；后端会优先自动生成 `speaker.json` 并上传 OSS，再发起配音任务（适用于无原音轨视频）。
  - `text` 模式（回退）：若未提供 `voiceId`（且未配置默认音色），后端自动切分为 SRT 并上传 OSS，再自动发起配音任务。
  - 输入视频预处理：后端在提交腾讯任务前会探测输入视频音轨；若检测到无音轨（`AudioStreamSet` 为空），会自动补一条静音音轨并上传 OSS，再用补轨后的视频地址提交（默认开启，可用 `TENCENT_MPS_AUTO_INJECT_SILENT_AUDIO` 关闭）。
  - 跨语种 `srcLang -> dstLang`：当两者不同且使用 `text` 模式时，后端会先做自动翻译，再生成目标字幕/目标配音文本（可通过 `TENCENT_MPS_ENABLE_AUTO_TRANSLATE` 配置开关）。
  - `speakerUrl` 模式：传 `speakerUrl`。
  - `subtitleUrls` 模式：传 `srcSubtitleUrl + dstSubtitleUrl`（前端简化单目标语言），并可附带 `srcLang/dstLang`。
  - 字幕样式：`embedSubtitle/font/fontSize/marginV/outputPattern`。
- 节点音色交互：
  - 高级设置中提供“系统音色”搜索 + 下拉，默认按 `srcLang` 过滤（无匹配时回退全量）。
  - 下拉选中音色后会自动同步 `speakerGender`（男/女）。
  - 仍保留 `voiceId` 手动输入框，可覆盖下拉结果（兼容自定义/新增音色）。
- 连接规则：
  - 输入：左侧 `video` 句柄（必须连接视频节点，不支持手填 URL）。
  - 输出：右侧 `audio` 与 `video` 双句柄。
  - `audio` 句柄优先输出音频 URL，若上游仅返回视频 URL 则回退视频 URL；`video` 句柄输出配音后视频，支持继续串到视频分析/抽帧/视频融合等下游节点。

## 2026-04 monochrome theme note
- `FlowOverlay` now reads `chatTheme` and applies `tanva-flow-theme-mono-dark` in black theme mode.
- Black theme monochrome overrides map media placeholders/waiting states to `Elevated #161616` to avoid white empty areas in image/video result regions.
- Video-node history panels/items are normalized to elevated dark surfaces with secondary text color (`#888888`) under monochrome theme.
- Video history containers in `GenericVideoNode` / `KlingO1VideoNode` / `Wan26Node` / `Wan2R2VNode` / `Sora2VideoNode` use shared hooks: `tanva-video-history` and `tanva-video-history-item`.
