# 前端模块：Flow（frontend-flow�? 

## 2026-05-12 Update
- `Seedream` 节点新增 `modelVersion`（`5.0/4.5`）本地状态与下拉选择，仅在豆包通道展示。
- 节点会调用 `GET /api/ai/seedream5/provider` 获取当前通道；当通道为观猹时隐藏模型下拉并强制回落 `modelVersion=5.0`。
- Flow 运行 `seedream5` 时会把 `modelVersion` 映射到对应 Model ID（`doubao-seedream-5-0-260128` / `doubao-seedream-4-5-251128`）并随请求发送。

## 2026-05-07 Update
- Image 节点本地上传成功后会主动断开当前图片输入连线，并清理旧 `crop`；避免节点仍按上游连接/旧裁剪预览显示，导致 `imageUrl` 已是新图但画面还是旧图。
- `批量连接输出` 的预览线源点兜底改为按每个源节点自己的输出端口列表计算；当真实 DOM 句柄暂不可读时，单输出节点仍回到右侧输出句柄中心，多输出节点按本节点端口顺序分布，避免用整批连线序号导致源点偏移。
- Flow 覆盖层内的滚轮缩放/平移现在也会通过 RAF 合并写入 canvas viewport，避免在触控板/滚轮高频事件下每个 wheel tick 都同步触发 Canvas store、Paper view 与 ReactFlow viewport 更新。

## 2026-05-06 Update
- Canvas → Flow 视口同步现在会优先以当前选中 Flow 节点为锚点，把 ReactFlow 的 `x/y` 平移值对齐到物理像素，减少同一缩放倍率下文字、图标、边框因半像素 transform 整体发虚。
- Flow viewport 不再长期设置 `will-change: transform`，避免浏览器把整层文本/图片持续合成栅格化后出现静止态发虚；视口原点仍保持与 Canvas 同步所需的 `transform-origin: 0 0`。
- Flow 选中连线的红色删除按钮改为 `pointerdown` 即派发 `flow:deleteEdge`，由 `FlowOverlay` 本地受控 `edges` 状态统一删除、清理标签编辑器并触发 `flow:edgesChange`；避免自定义 Edge 直接调用 ReactFlow instance setter 时被受控状态回灌或 click 抑制导致删除无效。
- Flow 连线新增 `Shift` + 点击删除入口：`onEdgeClick` 在检测到 Shift 时直接走 `deleteFlowEdgesByIds()`，复用现有边状态清理、`flow:edgesChange` 通知与历史提交。
- Flow 连线命中热区扩大到 32px：`CustomEdge` 将 `BaseEdge.interactionWidth` 下限设为 `32`，并在 CSS 中让 `.react-flow__edge-interaction` 明确参与 `stroke` 命中检测；按住 Shift 悬停连线时通过 body class 切换红色减号删除光标，提升选中与 Shift 删除的可点性但不改变视觉线宽。
- Flow 连线文字编辑新增手动双击兜底：`onEdgeClick` 会记录同一条 edge 的快速二次点击并打开标签编辑器，同时编辑器定位改用鼠标双击点，避免第一次点击选中连线导致 DOM 重渲染后 ReactFlow 原生 `dblclick` 不触发或输入框位置偏移。
- Flow 连线文字提交修复：输入框 `Enter` 直接按当前编辑器状态写回 `edge.label`，并在 `CustomEdge` 中用 `EdgeLabelRenderer` 渲染已保存 label；输入框会拦截键盘/鼠标事件，避免 Flow 全局快捷键或画布交互抢走提交。
- GPT-Image-2 Flow 节点从隐藏集合恢复展示；节点添加面板与 Quick Connect 会重新显示 `gptImage2`，运行逻辑仍复用 `Nano2Node` 的 GPT-Image-2 分支。
- `Generate`、`Multi Generate`、`Generate Refer` 的 Run 按钮运行态保留 `Run` 文案，只通过禁用灰色态表达运行中，避免按钮显示 `Running...`。
- `analysis` 节点外层名称统一为 `Image Chat`：节点添加面板、前端 fallback、后台导入模板、后端 NodeConfig 兼容输出和回填均保持同名，描述文案为“图像对话与提示词提取”，节点类型仍保留 `analysis`。
- Image Chat 的 Skill 列表新增 `Custom`：选中后展示 IME-safe 的自定义提示词输入框，运行时会把自定义输入与 `text` 句柄连接输入合并后发送。

## 2026-05-05 Update
- `PromptOptimizeNode` 的预览输入框补齐中文输入法 composition 防护：拼音组词期间只更新本地 textarea，候选词确认后再写回 Flow 节点数据，避免旧节点数据重渲染打断 IME 并留下拼音片段。
- Flow 文字输入类 `textarea` 统一补齐 IME-safe draft 处理，覆盖 `TextPrompt`、`TextPromptPro`、`GeneratePro`、`GeneratePro4`、`GenerateReference`、`VideoAnalyze`、`MinimaxMusic`、`KlingO3` 自定义分镜等节点；已存在防护的 `TextChat`、`TextNote`、`StoryboardSplit` 保持原逻辑。
- 画布橡皮擦对 Flow 连线保持点击命中删除：`FlowOverlay` 在橡皮模式下点击到 `.react-flow__edge-path` 会直接删除整条 edge 并保留橡皮模式；拖拽划线删除连线已取消，空白点击仍按原逻辑清掉已选中连线，Flow 节点/句柄交互继续跳过橡皮擦监听，保证正常连线不受影响。
- 画板右键菜单新增 `节点打组 (G)`，通过 `flow:create-group-from-selection` 复用 FlowOverlay 中 `G` 快捷键的 `createGroupFromSelection()` 逻辑。
- Flow 连接新增点击式待连接模式：单击输出句柄会进入鼠标跟随连线，再单击目标输入句柄完成连接；画板右键菜单新增 `批量连接输出`，可把当前选中 Flow 节点的输出端口批量带到鼠标，句柄未渲染时按节点类型兜底生成源端口，待连接期间锁定滚轮/拖拽视口并持续重算源点屏幕位置；批量模式点击目标节点会自动匹配兼容输入句柄，并允许多 Prompt 输出接入 GeneratePro/TextPrompt/TextChat/Analysis 等可共享文本输入。
- `TextChatNode` 对齐 `lt-dev9` 轻量形态：移除节点动态 resize / ResizeObserver / 高频 `updateNodeInternals`，运行时固定 `enableWebSearch: false`，避免继承全局联网搜索状态。
- 节点添加面板与 Quick Connect 隐藏集合补齐 `generateRef`、`sora2Video`，避免隐藏/暂缓节点从快捷入口被创建。
- 节点添加面板滚轮事件会先在面板内消费；反转滚轮模式下，鼠标位于 `.tanva-add-panel` 内时优先滚动节点列表，不再把滚轮传给背后的 Flow 画布缩放/平移。
- Flow 低细节模式恢复为 Zustand 外部订阅 `canvas.zoom`，只在进入/退出阈值时更新 React 状态；画布缩放中且节点数较多时也会临时进入低细节模式，FPS overlay 重新标记 `Zoom` 模式。
- FPS overlay 开关迁移到「设置 -> 高级 -> 帧检测」，不再开发环境默认自动打开；检测模式新增 `Canvas`，覆盖空格/中键拖动画布与滚轮/触控板平移。
- `ImageNode` 裁切预览复用共享图片加载缓存，并把尺寸观测更新合并到 RAF；`ViewAngleNode` 的 Three.js 预览尺寸同步也改为 RAF 合并，避免 ResizeObserver 高频直接触发渲染。
- `FlowOverlay` 的节点组 Alt 拖拽复制现在只在复制开始时扩展选中组的 `childNodeIds`，为组内子节点建立克隆 `idMap`，并重写克隆组的 `childNodeIds` 与内部边 `sourceHandle/targetHandle`，避免只复制组壳或复制后组内连线断开。
- 节点组 P0 迁移继续补齐：Delete/Backspace 与右键删除会把 `nodeGroup` 的 `childNodeIds` 和相关边一起移除；普通拖拽在 dragStart 缓存组内子节点位置并按快照派发子节点位移，避免拖拽中每帧重建节点映射；Flow 复制/粘贴会扩展组选区并在粘贴时重映射 `childNodeIds`。
- Flow 节点右上角发送到画布时会先把源节点解析到所属 `nodeGroup`；组内节点发送图片会以组节点底部作为 `anchorClient`，多图发送也强制使用该锚点，避免落到子节点正下方或被智能定位改写。

## 2026-05-04 Update
- `GenerationProgressBar` accepts `runKey`/`startedAt`; flow generation and video nodes pass their node id as `runKey` so simulated progress is calculated from a stable run start instead of resetting on rerender.
- `FlowOverlay` maintains `progressStartedAt` as transient runtime state for running nodes and strips it from Flow copy/template export paths so it does not persist into design JSON.
- `NodeGroupNode` supports a stop state: when a group is running, the footer button switches from Play to Square and calls `FlowOverlay.stopGroupRun`; `FlowOverlay` marks the group as stopping and skips remaining queued child nodes after the current child run resolves.
- Group nodes bypass the generic `nodesWithHandlers` cache so `groupRunning/groupStopping` and injected callbacks stay current while preserving the cache for normal nodes.
- Global History has a shared `historyMedia.ts` helper for image/video detection, labels, media URLs, video thumbnails, and download names. The history page and detail modal now render video records with thumbnails/playback; AI Chat Seedance video success records remote video URL metadata through `recordVideoHistoryEntry`.
- Image Split downstream parsing now uses the shared `imageSplitHandles` helper in Generate/Agent/ImageCompress/ImageGrid/ViewAngle paths, preserving `imageN/imgN` compatibility for crop-based inputs.
- `VideoToGifNode` shows the run credit badge, and `VideoNode` isolates native video controls with `nodrag/nopan/nowheel` plus event capture guards.
- Workspace header has a quick Nano Banana/Gemini/GPT-Image-2 route switch that updates the existing `bananaImageRoute` setting and displays today's normal/stable route success rates.
- Canvas drawing tools include an `arrow` mode exposed in the toolbar; the drawing hook creates a filled Paper path tagged with `data.tool = "arrow"`, and the layer panel maps it to an Arrow layer type/icon.
- `GeneratePro4Node` now uses node-local Fast/Pro/Ultra selection (`modelProvider`) and previews run credits with the connected reference-image count capped by shared `flowModelProvider` limits.
- `TextChatNode` no longer renders the bottom web-search checkbox/status row; `AnalyzeNode` keeps `Image Chat` / `Run` / `Skill` in English while localizing helper and placeholder copy in zh mode.
- `TextChatNode` run-button credit tooltip now uses the same localized `消耗/积分` wording as image/analysis run buttons.

## 2026-04-15 Update
- Analysis node now uses node-local Fast/Pro/Ultra selection (analysisProvider) and does not change global provider state.
- Analysis node requests are forced to Banana normal route, independent from global normal/stable channel toggles.

## 2026-04-16 Update
- Generate / Agent(`generatePro`) node model switch is now node-local (`modelProvider`) and no longer mutates global `aiProvider`.
- Text Chat node now supports node-local Fast/Pro/Ultra model switch via `modelProvider`.
- Switching model in global settings or AI dialog now emits a flow-wide sync event that bulk-updates related flow nodes (`generate`, `generatePro`, `generatePro4`, `analysis`, `textChat`) to the selected tier for quick consistency.
- Analysis node model routing now aligns with Text Chat model mapping (Fast/Pro/Ultra -> text multimodal models) instead of image-generation model mapping.
- Video nodes (`Seedance/Kling/Vidu/Wan/Sora2`) no longer hard-code running progress to `30%`; they now rely on the shared `GenerationProgressBar` simulated ramp (5 minutes to 95%, then 100% on success).
- Image generation nodes (`Generate/GeneratePro/GenerateReference/Midjourney/Nano2/Seedream5/ViewAngle`) now use the same simulated progress strategy with a shorter `60s` ramp to `95%` (then `100%` on success) via `GenerationProgressBar.simulateDurationMs`.

## 2026-04-21 Update
- Fixed legacy edge reconnection on project reopen: historical `sourceHandle` values such as `image` / `image1` / `image-1` are now normalized to current ids (`img` / `img1`) during Flow edge hydration/serialization.
- Added compatibility source handle on `ImageCompressNode` so both `image` and `img` references can reconnect safely, avoiding visual “all edges disconnected�?regressions in older projects after reload.

## 2026-04-17 Update
- Flow 缩放事件在节点输入框场景下调整为“缩放优先”：`TextPrompt/TextPromptPro/Analysis/VideoAnalysis` �?`textarea` 在缩放手势下会放行给 Flow 画布（按 `wheelZoomMode` 计算），避免输入框捕获滚轮后触发浏览器整页缩放；非缩放滚轮仍保留输入区原生滚动�?
- `GlobalZoomCapture` �?`gesturestart/gesturechange` �?Flow 区域不再旁路，可将触控板 pinch（含 Safari 手势事件）映射到画布缩放�?D 视口区域仍保持旁路以避免冲突�?
- Flow 新增低细节渲染模式：当节点数达到阈值且缩放 `<= 40%` 时自动启用（缩放恢复�?`> 45%` 时退出，避免阈值抖动）�?
- 低细节模式下，节点缩略图不再渲染真实图像：`SmartImage` 直接降级为灰色占位块，且部分裁切缩略�?`canvas`（如 `Image/Generate/GeneratePro/Generate4/Analyze/ImageSplit/ImageGrid`）也会改为灰块占位，从而减少缩小时的大量图像重绘与解码压力�?
- 低细节模式下会隐藏所有连线与 MiniMap（含图片叠加层），节点仍保留原始 UI 结构，以兼顾性能与可读性�?
- Flow 节点复制现会同时记录“选中集合外部连线”快照；`Ctrl/Cmd + V` 继续保持仅恢复选中集合内部连线，`Ctrl/Cmd + Shift + V` 新增“保留原连线粘贴”模式（会尝试恢复复制节点与现有外部节点之间的连线）�?
- `GeneratePro / ImagePro / GeneratePro4` 右键菜单“复制节点”入口已切换为写�?Flow 剪贴板（不再直接创建副本），便于统一使用 `Ctrl/Cmd + V` / `Ctrl/Cmd + Shift + V` 控制是否保留原连线�?
- 为兼容部分浏览器�?`Ctrl/Cmd + Shift + V` 不稳定触�?`paste` 事件，Flow 增加了按键层兜底：当内部 Flow 剪贴板有节点数据时会直接执行“保留连线粘贴”�?

## 作用
- 提供流程/节点编排能力（ReactFlow），并与画布/素材/生成等能力联动�?

## 关键目录（节选）
- `frontend/src/components/flow/FlowOverlay.tsx`：Flow 主入口（体量较大�?
- `frontend/src/components/flow/nodes/`：节点实现（含进度条、生成节点等�?
- `frontend/src/components/flow/types.ts`：类型定�?
- `frontend/src/components/flow/utils/`：辅助逻辑
- `frontend/src/components/flow/PersonalLibraryPanel.tsx`：个人库面板（与后端 personal-library 相关�?

## 双语适配补充
- `FlowOverlay` 的添加面板中，`Templates`/`Custom` 相关空态文案、模板占位文案、模板分类筛选标签已统一走双语文案；并对分类�?`其他/Other` 做显示层映射，避免英文模式下出现中文分类芯片�?

## 节点可见性补�?
- `FlowOverlay` 使用统一隐藏集合控制节点可见性；当前 `sora2Video`（Sora 2）、`sora2Character`（Sora2 Character）与 `nano2`（Nano2）在节点添加面板�?Quick Connect 候选中默认隐藏�?
- 节点添加面板分组不能直接�?`category: "input"` 视为“文字类节点”；输入节点仍需继续�?`nodeKey`/解析后的节点类型细分�?`text / image / video / audio`，否�?`video` 这类输入节点会被误归到文字分组�?
- `Vidu` 视频能力已收拢为单一 `viduVideo` 入口；节点内模型只展�?`Q2 / Q3` 两档，面板不再额外展示多个同品牌 Vidu 节点。运行时仅支�?`vidu-q2 / vidu-q3` 两个后端模型，并根据 `viduModel` 自动切换 provider、时长与参考图上限�?
- `Seedance 2.0` 节点已从“手动模式切换”收敛为“最大输入能�?+ 自动推导模式”：节点始终展示 `text / 9 个图片槽�?/ 尾帧 / video / audio` 句柄，运行时按已连接输入自动推导�?`文生视频 / 首帧 / 首尾�?/ 多图参�?/ 视频参�?/ 图片+音频 / 图片+视频 / 视频+音频 / 图片+视频+音频`，并通过 `video_mode` 下发到上游请求�?
- `Seedance 2.0` 多图输入统一�?`image-slot-*` 句柄，最多支�?`1-9` 张参考图；旧流程中的 `smart_frames` 会在前端自动�?`reference_images` 兼容处理，不再单独展示“智能多帧”模式�?
- 腾讯 `Kling O3` 节点的“自定义分镜”面板已改为悬浮式素材上传交互：支持直接上传参考图�?视频（不再要求用户手�?URL），运行时会自动并入请求参数并执行腾讯侧限制校验（视频参�?`3-10s`、参考图 `<=7`，有参考视频时 `<=4`）�?
- 模型管理删除模型后，Flow 节点添加面板不应继续展示对应模型节点�?
  - 后端公开节点接口只会从“节点管理”里读取节点配置，再�?`model_provider_mapping_v2.models[]` 过滤�?`metadata.modelKeys` 的模型节点�?
  - 前端在有后端节点配置时，不再把这类默认模型节点作�?fallback 自动补回面板；后端不可用时的本地 fallback 也不再硬编码这些模型派生视频节点�?
- 管理后台“节点管理”支持“从模型管理导入”：
  - 导入入口会读取当前动�?`model_provider_mapping_v2`，并基于选中的模型自动创建一条显�?`NodeConfig`�?
  - 导入只负责加速创建；画布节点仍只认节点管理中的显式配置，不会被模型管�?JSON 直接派生�?
- 管理后台“系统设置”同时提供两种模型管理入口：
  - `统一模型管理`：直接编辑完�?`model_provider_mapping_v2` JSON，包括模�?厂商启停、默认线路、厂商积分与 `metadata.specPricing` 规格积分规则；默认会带出当前平台已接入的图片模型（Nano Banana / Gemini 系列）与视频模型，左侧列表支持按关键字和任务类型筛选，图片模型的规格积分编辑会按模型能力维度展示，例如文生图仅显示尺寸/质量/出图数，图像编辑与参考图生成会额外显示参考图数量，图像分析则收敛为分析单价�?
  - `视频模型管理`：仅用于快速切�?sora2 / seedance / kling / vidu 的默认供应商路线�?
- `Vidu` 节点内的模型下拉也受模型管理约束�?
  - 后端会把 `viduVideo.metadata.supportedModels` 裁剪为当前仍启用�?`vidu-q2 / vidu-q3` 子集；前端从模型管理导入节点配置时也只会写入 `q2 / q3`�?
  - 若画布上已有旧节点指向已删除子模型，前端会自动回退到第一个仍可用�?`viduModel`�?
- 模型管理里的线路价格会覆盖节点管理价格：
  - 公开节点配置接口会把 `model_provider_mapping_v2` 中默�?vendor �?`creditsPerCall` 动态回填到对应 Flow 节点�?
  - 画布上的模型管理视频节点支持切换 `vendorKey` 线路；切换后运行按钮旁的积分徽标会即时回显该线路价格，并�?`managedModelKey/vendorKey/platformKey` 一起传给后端�?
- 统一模型管理已开始从�?`specPricing` 过渡到正�?`pricing`�?
  - 管理台厂商卡片现在支持默认积分、默认价�?�?以及规格规则的积�?价格维护�?
  - 后端公开节点接口会优先读�?vendor `pricing.defaults`，旧 `creditsPerCall` 仍作为兼容回退�?
- 画布右上角帮助菜单新�?`定价一览`�?
  - 入口位于帮助 icon 下拉，位置在“用户手册”和“更新日志”之间�?
  - 弹层支持查看全部模型定价，或按单个模型聚焦查看�?
  - 线性定价会直接显示公式，例�?`priceYuan = durationSec × 0.8，credits = ceil(priceYuan × 100)`�?

## 音频节点
- `minimaxSpeech`：文本转语音节点，输�?`audio` 句柄�?
- `minimaxMusic`：音乐生成节点，支持 `prompt`、`lyrics`、`isInstrumental`、`lyricsOptimizer`，调�?`/api/ai/minimax-music`，输�?`audio` 句柄，可连接 `wan26` / `audioUpload` / Kling 音频输入�?

## 规范
### 需�? 视频�?GIF 节点
**模块:** Flow 视频工具节点
支持�?Flow 中将视频节点输出转换�?GIF，并以远�?URL 持久化输出（不落�?base64/blob）�?

#### 场景: 视频节点 -> Video to GIF（终端下载）
连接视频输入后，严格按输入视频时长转换（无需手动设置时长），可选调�?FPS/宽度并执行转换�?
- 结果返回可访问的 GIF URL
- 节点仅保留输入句柄，不再提供右侧输出句柄
- 不再提供“无限循环”选项（固定为非无限循环）
- 生成成功后可在节点右上角直接下载 GIF（不再在节点底部展示“打开原图”链接）
- 后端已接入积分系统：每次转换预扣 30 积分，转换失败自动退款并写入积分流水

### 需�? 图片节点缩放后刷新尺寸一�?
**模块:** Flow 图片节点
图片节点在画布放大后刷新页面，内部渲染尺寸应保持一致，不随缩放倍数被重复放大�?

#### 场景: 放大后刷�?
画布滚轮放大后刷新页面�?
- 图片节点内部渲染尺寸与缩放前一�?

### 需�? Image 节点标题可双击重命名
**模块:** Flow 图片节点
Image 节点标题支持双击进入编辑态，方便在流程中快速区分多个图片输入节点�?

#### 场景: 双击标题重命�?
用户双击节点标题（默�?`Image`）后可直接输入新名称�?
- `Enter` 或失焦保存并回写 `data.label`
- `Escape` 取消本次编辑

### 需�? MiniMap 拖拽时常�?
**模块:** Flow 画布
拖动画布或拖动节点过程中，MiniMap 始终可见且不闪烁�?

#### 场景: 拖动画布/节点
在同一页面拖动画布或节点�?
- MiniMap 持续可见

### 需�? MiniMap 刷新后快速展�?
**模块:** Flow Overlay
刷新页面后，MiniMap 应及时展示画布图�?节点概览�?

#### 场景: 刷新�?1s 内展�?
刷新页面进入项目�?
- MiniMap �?1s 内出现图�?节点概览（不等待长延迟）
- `frontend/src/components/flow/MiniMapImageOverlay.tsx` 已清理残余中文注释（无功能改动），用于保持双语扫描基线准确�?

### 需�? 可连接节点首项固定基础节点
**模块:** Flow Quick Connect
自动选择可连接节点时，首项必须固定为当前输入类型的基础节点，避免高频使用排序把基础入口挤出前列�?

#### 场景: Prompt / Image 自动连接
从文本输出触发自动连接时，首项为 `textPrompt`；从图片输出触发自动连接时，首项�?`image`�?
- 其余候选节点仍按使用频率排�?

### 需�? 连线颜色模式可切�?
**模块:** Flow Overlay / Flow 设置
支持在工具栏切换连线颜色显示策略，兼顾统一视觉与类型识别�?

#### 场景: 标准�?/ 跟随句柄
用户可在「设�?-> 视图外观」中切换连线颜色模式（Flow 工具栏也可快捷切换）�?
- `标准色`：全部连线使用统一灰色
- `跟随句柄`：连线颜色跟随句柄类型（文本/图片/视频/多图/音频�?

### 需�? 节点拖拽自动对齐
**模块:** Flow Overlay
Flow 节点拖拽支持与其他节点进行边�?中心吸附，并显示对齐参考线（复用画布图片自动对齐的同款算法与全局开关）�?

#### 场景: 拖拽节点接近其他节点
用户拖动一个或多个节点靠近其他节点时�?
- 在吸附阈值内自动贴齐（left/right/top/bottom/center�?
- 显示�?粉色参考线提示当前对齐关系
- 结束拖拽后自动清理参考线

### 需�? Multi Generate 固定 4 �?
**模块:** Flow 生成节点（`generate4`�?
`Multi Generate` 节点固定输出 4 张图，不再暴露可编辑的数量配置，避免 UI 配置与实际执行次数分叉�?

#### 场景: 运行 Multi Generate
用户点击运行 `Multi Generate` 节点�?
- 节点执行始终�?4 轮生�?
- 节点面板不再显示 `Count/数量` 输入�?
- 新建节点默认数据只保�?`status/images`，不再持久化 `count`

## 图片与内�?
- **ImageSplit -> Image passthrough**: Image nodes treat `ImageSplit` outputs as first-class image inputs, including `imageN` and legacy `imgN` source handles plus `targetHandle=image` edges. Chained paths such as `ImageSplit -> Image -> Image` keep the cropped resource available for preview, canvas send, and downstream reads.
- **原则**：不要在 `content.flow`（项目内�?JSON）里持久化大体积 base64；这会导致序列化/对比/自动保存时产生巨型临时字符串并推高内存�?
- **Flow 图片资产**：`frontend/src/services/flowImageAssetStore.ts` �?`flow-asset:<id>` 仅用于运行期/本地缓存�?*保存到后端前必须替换为远�?URL/OSS key**（否则会被阻止保�?或被后端清洗丢弃）。当前通过 `frontend/src/services/flowSaveService.ts` 在保存链路里自动补传并替换（优先覆盖 `Image Split` 的输入图引用）�?
- **Image Split 持久化（方案A�?*：运行时可用 `inputImageUrl=flow-asset:` 做分�?下游裁切；保存到后端前会补传并替换为 `inputImageUrl`（远�?URL/OSS key�? `splitRects[]`（裁切矩形）+ `sourceWidth/sourceHeight`，切片图片本身不落库。渲�?下游（例�?`Image Grid`）按需从原图裁切�?
- **Image Split 分割模式**：节点支�?`智能分割` �?`自定义网格` 两种模式。`智能分割` 保持原行为（连通域检测，失败时按 `cols=ceil(sqrt(count))` 回退网格）；`自定义网格` 通过 `�?× 行`（例�?`4 × 2`）固定切片布局，输出端口数自动同步�?`cols*rows`，并限制总数不超�?`50`�?
- **裁切输出尺寸**：下游按 `splitRects[].width/height`（源坐标系）作为输出尺寸；当 base 图像只加载到缩略图（`naturalW < sourceWidth`）时，仍会输出正确尺寸（避免 1024 误变 200）�?
- **Image 节点裁切透传**：`Image`/`ImagePro` 节点�?`crop` 时，下游聚合（如 `Image Grid`）会优先�?`crop` 裁切再拼合，避免回退到整图；节点连接链路中也支持读取上游 `Image` �?`crop` 进行裁剪预览�?
- **Generate 输入预览一致�?*：`Generate` 节点顶部输入缩略图会识别 `Image/ImagePro.crop` �?`ImageSplit.splitRects`，按裁切区域渲染缩略图；避免预览显示整图但实际运行已按裁切传参的认知偏差�?
- **Image 节点发送到画布**：Image 节点在有图片资源时可一键发送到画布；发送内容以节点当前渲染资源为准（含 `crop`/ImageSplit 裁剪预览），避免回退为整图�?
- **Analysis 裁切继承**：`Analysis` 节点在输入为 `Image/ImagePro` 时会递归向上游查�?`crop`/`ImageSplit`，以确保链路中转后仍使用裁剪结果�?
- **Analysis 断开清空**：断开图片连线后会清理节点内残留的 `imageData/imageUrl`，预览恢复为空状态�?
- **Worker 计算**：`Image Split` 使用 `frontend/src/workers/imageSplitWorker.ts` �?Worker 内解码并计算裁切矩形，避免主线程做像素级扫描�?`toDataURL` 产生的峰值�?

## 缺陷复盘
- **问题现象:** 画布放大后刷新，Image 节点裁剪预览尺寸变大�?
- **根因:** 预览尺寸使用 `getBoundingClientRect`，被 ReactFlow 视口缩放 transform 影响�?
- **修复:** 改用布局尺寸（`offsetWidth/clientWidth`）作为基准，回退时才读取 `getBoundingClientRect`�?
- **预防:** 渲染尺寸计算优先使用布局尺寸，避免受 transform 影响�?
- **问题现象:** 拖动画布/节点�?MiniMap 消失�?
- **根因:** MiniMap �?`isNodeDragging` �?true 时被条件隐藏�?
- **修复:** 去除拖拽态隐藏逻辑，保持仅在专注模式下隐藏�?
- **预防:** 可视性依赖业务模式（如专注模式），避免与交互态绑定�?
- **问题现象:** 刷新�?MiniMap 图片/节点概览延迟 30s 才出现�?
- **根因:** MiniMap 仅依赖轮询读�?`window.tanvaImageInstances`，且缺少实例更新事件通知�?
- **修复:** 增加 `tanva-image-instances-updated` 事件驱动更新，保�?1s 兜底轮询�?
- **预防:** 对画布实例变更提供事件通知，避免单一轮询�?
- **问题现象:** 刷新�?MiniMap 未显示图片占位，需要拖动图片后才出现�?
- **根因:** 反序列化等待 Raster 加载后才触发重建事件，且事件可能早于监听注册导致丢失；重建失败时也未回退到快照数据�?
- **修复:** 反序列化完成立即触发 `paper-project-imported` 并记录导入时间戳兜底触发；恢复路径按 `data.imageId` 匹配并在失败时用快照 bounds 兜底种子�?`imageInstances`�?
- **预防:** 导入完成即触发重建事件，并提供一次性兜底触发避免丢事件�?
- **问题现象:** Multi-generate �?Image �?Generate 链路中，Generate 未使用上�?Image 节点展示图�?
- **根因:** Generate 输入解析�?Image 节点优先回溯上游，忽�?Image 节点本身的当前渲染数据�?
- **修复:** 输入解析优先使用 Image 节点�?`imageData/imageUrl/thumbnail`，再回溯上游；解析失败时�?proxy URL 进行带鉴权兜底拉取�?
- **预防:** 下游输入解析需以当前节点展示资源为准，再做链路回溯�?
- **问题现象:** Generate 读取 OSS 直链时跨域导致图片未被使用�?
- **根因:** 前端需要将图片转成 dataURL，跨域拉取失败导致输入为空�?
- **修复:** 生成链路允许传递远�?URL，由后端下载转码后处理�?
- **预防:** 对跨域资源优先走后端拉取，避免前�?CORS 限制�?
- **问题现象:** `Analysis` 节点在生产环境偶发“图片加载失�?缺少图片输入”，本地难复现�?
- **根因:** 输入解析只尝试首个候选字段（常为失效 `imageData` 临时引用）而未回退�?`imageUrl`；同时远�?URL �?`VITE_PROXY_ASSETS=false` 下可能仅走浏览器直连，受 CDN CORS 差异影响�?
- **修复:** `AnalyzeNode` 改为多候选顺序回退（`imageData �?imageUrl �?output/thumbnail`），裁切链路支持�?baseRef 回退；`resolveImageToDataUrl/resolveImageToBlob` 对白名单远程 URL 增加“强�?`/api/assets/proxy`”候选兜底；移除分析缩略图预览中�?`crossOrigin=anonymous` 的硬依赖�?
- **预防:** 分析/生成等下游取图统一采用“多候�?+ 代理兜底”策略，避免运行时临时引用失效与跨域环境差异放大�?
- **问题现象:** `ViewAngle` 节点偶发报错“缺少图片输入”，但上�?`Image` 节点画面可见�?
- **根因:** 输入解析在多个候选字段（`imageData/imageUrl/thumbnail`）中只尝试第一个值；当首个值是失效临时引用（如�?`blob:`）时，未回退到后续有�?`imageUrl`�?
- **修复:** �?`FlowOverlay.runNode` 解析链路新增“候选图片逐个回退”逻辑，`resolveNodeImageToDataUrl` �?`image/imageGrid/imageCompress/videoFrameExtract/generate4` 等分支均改为按候选顺序逐一解析，直到成功�?
- **预防:** 下游取图不应单点依赖某一个字段；应以“多候�?+ 可恢复失败”方式解析，避免临时态残留引发误判�?
- **问题现象:** 线上生成/上传图片后刷新，偶发出现可选中但不显示的“幽灵图”�?
- **根因:** 上传开始时先写入预分配 OSS key（`imageUrl`），失败后未回滚；保存链路会清理 `blob:/data:` 预览，导致刷新后只剩不存在的 key�?
- **修复:** `ImageNode` 上传失败时回滚预分配 key（仅在当前节点仍使用�?key 时生效），并保留可重试的运行时预览；保存校验新增“`uploading=true` 且携带图片数据”的 Flow 节点阻断，避免上传未完成时落库不稳定引用�?
- **预防:** 上传中引用不得视作可持久化来源；仅在上传成功并拿到可验证的远程引用后写入 `imageUrl`�?

## 3D 模型节点
- 三维节点（`frontend/src/components/flow/nodes/ThreeNode.tsx`）选择模型文件后会上传�?OSS，并�?`modelUrl` 持久化为远程引用，避�?`blob:` 等临�?URL 进入 `content.flow`�?
- 加载远程模型/图片时默认可通过 `proxifyRemoteAssetUrl` �?`/api/assets/proxy`，以规避 OSS CORS（受 `VITE_PROXY_ASSETS` 控制）。若 OSS 已配�?CORS 且希望禁�?proxy，请设置 `VITE_PROXY_ASSETS=false` 并配�?`VITE_ASSET_PUBLIC_BASE_URL`（用于把 `projects/...` 这类 key 直接拼成可访�?URL）�?
- Three.js 渲染器尺寸以容器 `clientWidth/clientHeight` 为准，并使用 `renderer.setSize(w, h, false)` 仅更新绘制缓冲（不改�?canvas 的样式尺寸），避免节�?resize �?canvas 未铺满可视区域�?
- `ThreeNode` �?Path Tracing 模式不能只依�?`scene.background`；需要可采样�?`scene.environment` 才能避免射线打空后回落到黑底。当前使用代码生成的 equirect 渐变环境图，并为普通栅格渲染额外生�?PMREM 版本；PT 使用原始 equirect 环境，栅格使�?PMREM，配合偏白背景和柔和主光模拟克制的白天效果�?

## 依赖
- `reactflow`

## 语音节点补充
- 新增 `TencentSpeechNode`（`frontend/src/components/flow/nodes/TencentSpeechNode.tsx`），对应节点类型 `tencentSpeech`�?
- 新增系统音色数据�?`frontend/src/components/flow/nodes/tencentSystemVoices.ts`�?52 条，来源腾讯云文�?`https://cloud.tencent.com/document/product/862/129151`），用于节点内可检索下拉选择�?
- 该节点对接后�?`POST /api/ai/tencent-speech`，参数按腾讯 MPS AI 配音文档映射�?
  - `text + voiceId` 模式：前端通过 `text` 句柄接入 Prompt 节点文本，并可填�?`voiceId`；后端会优先自动生成 `speaker.json` 并上�?OSS，再发起配音任务（适用于无原音轨视频）�?
  - `text` 模式（回退）：若未提供 `voiceId`（且未配置默认音色），后端自动切分为 SRT 并上�?OSS，再自动发起配音任务�?
  - 输入视频预处理：后端在提交腾讯任务前会探测输入视频音轨；若检测到无音轨（`AudioStreamSet` 为空），会自动补一条静音音轨并上传 OSS，再用补轨后的视频地址提交（默认开启，可用 `TENCENT_MPS_AUTO_INJECT_SILENT_AUDIO` 关闭）�?
  - 跨语�?`srcLang -> dstLang`：当两者不同且使用 `text` 模式时，后端会先做自动翻译，再生成目标字�?目标配音文本（可通过 `TENCENT_MPS_ENABLE_AUTO_TRANSLATE` 配置开关）�?
  - `speakerUrl` 模式：传 `speakerUrl`�?
  - `subtitleUrls` 模式：传 `srcSubtitleUrl + dstSubtitleUrl`（前端简化单目标语言），并可附带 `srcLang/dstLang`�?
  - 字幕样式：`embedSubtitle/font/fontSize/marginV/outputPattern`�?
- 节点音色交互�?
  - 高级设置中提供“系统音色”搜�?+ 下拉，默认按 `srcLang` 过滤（无匹配时回退全量）�?
  - 下拉选中音色后会自动同步 `speakerGender`（男/女）�?
  - 仍保�?`voiceId` 手动输入框，可覆盖下拉结果（兼容自定�?新增音色）�?
- 连接规则�?
  - 输入：左�?`video` 句柄（必须连接视频节点，不支持手�?URL）�?
  - 输出：右�?`audio` �?`video` 双句柄�?
  - `audio` 句柄优先输出音频 URL，若上游仅返回视�?URL 则回退视频 URL；`video` 句柄输出配音后视频，支持继续串到视频分析/抽帧/视频融合等下游节点�?

## 2026-04 monochrome theme note
- `FlowOverlay` now reads `chatTheme` and applies `tanva-flow-theme-mono-dark` in black theme mode.
- Black theme monochrome overrides map media placeholders/waiting states to `Elevated #161616` to avoid white empty areas in image/video result regions.
- Video-node history panels/items are normalized to elevated dark surfaces with secondary text color (`#888888`) under monochrome theme.
- Video history containers in `GenericVideoNode` / `KlingO1VideoNode` / `Wan26Node` / `Wan2R2VNode` / `Sora2VideoNode` use shared hooks: `tanva-video-history` and `tanva-video-history-item`.

## 2026-04-12 Tencent Stable Route Pricing
- `FlowOverlay.tsx` updates `BANANA_STABLE_ROUTE_PRICING` for stable route display and run badges.
- Pricing matrix: Fast `1K=30`; Pro `1K/2K/4K=90/100/170`; Ultra `0.5K/1K/2K/4K=30/50/70/110`.
- Stable route (`bananaImageRoute = stable`) remains Tencent-specific; other routes keep their own pricing logic.

## Tencent Kling2.6 Routing Note (2026-04-13)
- In Tencent route, kling-v2-6 now allows image-2 input in both std and pro modes on the node UI.
- Connection validation in FlowOverlay was aligned: Tencent kling-v2-6 accepts image-2 in std/pro, while non-Tencent routes remain pro-only for image-2.
- Legacy-node fallback: even when `vendorKey/platformKey` is empty, if managed metadata default vendor is `tencent_vod`, image-2 remains enabled for kling-v2-6.
- Tencent route detection for `kling-o3` is now strict: only explicit Tencent vendor/platform keys or metadata default vendor (`tencent_vod`) trigger Tencent-specific Kling request shaping.
- Tencent-specific sound mapping is now shared by both `kling-v2-6` and `kling-v3-0` request paths, so Tencent Kling no longer inherits non-Tencent `pro => sound=on` forcing.

## 2026-04-13 Run Trigger Guard
- Flow `runNode` now has a per-node in-flight guard to block duplicate concurrent runs caused by rapid repeated clicks.
- Video provider request layer now sends `Idempotency-Key` in `generate-video-provider` calls for backend-side dedupe.
- AI backend image/video request layer now sends `Idempotency-Key` for generation APIs to avoid duplicate pre-deduct on retry/race.

## 2026-05-04 Main-Based Flow Performance Migration
- Node palette search filters visible groups by node key, localized names, descriptions, and managed node captions.
- Quick Connect options are constrained to node types currently present in the visible palette and skip hidden/disabled/maintenance nodes.
- Flow store hydration compares serialized node/edge signatures against the local ReactFlow snapshot before applying state, and debounced write-back skips when the project store already matches.
- `TextChatNode` builds text-generation prompts from connected/manual node inputs only; it does not prepend global chat context.
- `AnalyzeNode` uses `analysisSkillId` to switch between Analysis / Prompt / JSON built-in skill prompts; text-handle inputs are appended as extra instructions.
- `TextChatNode` supports node-local Skill presets (`custom`, `shotSplit`, `promptOptimize`, `translate`). Custom mode uses the manual prompt field; preset modes run the built-in instruction and optionally append connected text inputs.
- `StoryboardSplitNode` can split by a custom sample format (`splitFormat`) and auto-derives output handle count from parsed segments, clearing stale `promptN` outputs after re-split.
- Image generation reference previews use shared model-tier limits from `flowModelProvider`: Fast 3, Pro 11, Ultra 14.
- `VideoAnalyzeNode` localizes its default prompt and sends Banana route/channel hints with analysis requests.
- `VideoAnalyzeNode` run-credit preview follows the `lt-dev9` route/tier matrix: normal Fast/Pro/Ultra = `60/90/120`, stable Fast/Pro/Ultra = `80/120/160`.
- `Generate4Node` uses the shared Image Split handle helper for `imageN/imgN` reference inputs.
- `Seedream5Node` can use `thumbnails[]` as its lightweight first-image preview while full-image preview still uses `imageUrls/images`.
- AI Chat text responses preserve backend `metadata` on messages/context; context prompts are constrained to answer the current input directly instead of surfacing internal analysis.

## 2026-05-05 lt-dev9 Selective Migration
- Flow connection admission and `runNode` request assembly now share model-tier reference-image limits (`Fast=3`, `Pro=11`, `Ultra=14`) for `Generate`, `Generate4`, `Agent`, and `GeneratePro4`; `GenerateNode` also keeps hidden legacy handles through `img14`.
- Image Grid connection validation now accepts Image Split `imageN` and `imgN` source handles through the shared `isImageSplitHandle` helper.
- Successful Flow video runs write remote video references to Global History for Wan, HappyHorse, Sora2, provider-video nodes (`Seedance/Kling/Vidu` families), and Tencent Speech video output. This records existing remote URLs only and does not change project/design JSON persistence.

## 2026-04-24 Update
- `gptImage2` node now enables explicit `Resolution` selector (`1K/2K/4K`) and defaults to `1K`.
- `gptImage2` now enforces APIMart 4K ratio constraint in-node: when `resolution=4K`, aspect ratio options are restricted to `16:9 / 9:16 / 2:1 / 1:2 / 21:9 / 9:21`; invalid existing ratio auto-corrects to a supported one.
- `gptImage2` runtime request now carries `official_fallback` and defaults it to `true` (official channel fallback on).
- `gptImage2` runtime request carries `official_fallback`; default fallback is now `false` unless node data/defaultData explicitly sets it.
- `gptImage2` UI now hard-fixes resolution options to `1K/2K/4K` even if metadata payload only provides a partial subset (for compatibility with old node configs).
- `gptImage2` aspect-ratio/resolution dropdowns are now rendered with the same visual style and interaction pattern as video-node dropdown menus (`video-dropdown` + `video-dropdown-menu`).

## 2026-05-12 GPT-Image-2 Async Flow Runtime
- `FlowOverlay` now routes `gptImage2` node runs to async image task APIs instead of the synchronous `generate-image` path.
- Runtime creates a task, polls every 3s, and waits up to 15 minutes before timing out.
- Failed/timeout task messages are surfaced as node errors; credit refund is handled by backend async task status flow.

## 2026-05-12 Seedance Update
- Seedance video node model selector now uses Seedance 2.0 + Seed 2.0 Lite (removed 2.0 Fast UI option), and mode selector now supports eference_images / irst_frame / start_end / smart_frames with mode-specific validation and limit tips.
