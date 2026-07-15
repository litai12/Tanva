# 导演台全量迁移设计（TapCanvas → Tanva）

日期：2026-07-15　分支：`feature/director-console-full-port`

## 目标
把 TapCanvas-pro 当前的**全功能导演台**（时间轴 + 骨骼动画 + 视频输出，小T 可驱动）迁移到 Tanva，替换掉 2026-06-20 的静态出图旧版。

## 已定范围（用户确认）
1. **全量对齐**：骨骼动画/关键帧、分层角色运动 + 地面路径、群演、相机录制/路径、多镜头时间轴、离屏渲染出 mp4 → 视频节点。
2. **前端为主**的后端：薄 claim/report 租约 + 前端建输出节点；场景校验放客户端；小T 走 `flow_patch`。
3. **小T 已在 new-api facade 侧宣告导演台工具**：Tanva 只做画布侧接收 + 渲染，不加 Tanva 后端 agent 工具定义、不改 `agentCanvasProtocol` 能力清单。
4. **关键约束：Tanva 中 prompt 节点与 图片/视频节点分开**。导演台产出**纯 image 节点 / 纯 video 节点**（`data.videoUrl` 裸节点），不得把 prompt 塞进输出节点。喂 seedance：视频走连边，prompt 由独立 prompt 节点提供。（TapCanvas 用 combined taskNode，需改成分离式。）

## 版本适配基线
- Tanva：React 19 / R3F fiber 9 / drei 10 / three r180；reactflow 11。
- TapCanvas 源：React 18 / fiber 8 / drei 9 / three r183；xyflow 12。
- 需做 **v8→v9 + React18→19 + xyflow12→rf11** 适配。旧版移植已趟过同一跳，其已适配的 `scene/*.tsx`、`DirectorConsoleNode.tsx` 作参照 diff。

## 分层与移植性质
- **A 纯逻辑层（1:1）**：`state/` 全 39 文件、`scene/{clipAnimation,panoramaAdapt,waveClip}.ts`、`types.ts`、`assets.ts` + 全部 `*.test.ts`。纯 TS 采样数学，拷贝 + 改 import。正常受 tsc 检查。
- **B R3F 场景层（v8→v9）**：`scene/{Viewport,CharacterObject,CameraRig}.tsx`。以旧版已适配版为参照。加入离屏 clip 逐帧渲染 `captureClipFrames`。
- **C 面板层**：`panels/` 全部（新增 MotionPanel、TimelinePanel、AspectFrameOverlay）。裸 div + inline style，近原样。
- **D Modal 控制器**：`DirectorConsoleModal.tsx`。适配 store 写回（rf11 updateNodeData）+ 小T 场景引用 diff 桥（`storeData.scene !== ref`）。
- **E 节点/注册**：`DirectorConsoleNode.tsx` rf11 handle API。FlowOverlay 注册已存在。

## 小T 驱动链路（前端为主）
```
小T 工具 → new-api facade（已宣告）→ flow_patch → applyAgentPatch
  → flow:updateNodeData → 导演台 node.data.scene / data.pendingCapture{mode,animation}
  → DirectorCaptureRunner 认领租约 → 离屏渲染 → 【前端】建输出节点 → 回报后端仅记租约
```
手动截图：Modal 直接写自身 node `pendingCapture`。两路在 Runner 汇合。
`updateNodeData`/`agent-add-node`/`agent-connect-edge` 均泛型透传，收端无需登记节点类型。

## F 采集 Runner —— 出图（已通）+ 出视频（新增）
- 出图：沿用 `triggerQuickImageUpload` + `uploadCanvasImageBlob`（imageUploadService，纯 image 节点）。
- 出视频：离屏 clip 渲染 → 逐帧 → mp4 编码 → 上传 → 建**纯 video 节点** → 连边。
  - 编码：新增依赖 `mp4-muxer` + `@types/dom-webcodecs`（dev），移植 `utils/clipEncode.ts`（裸 WebCodecs→mp4-muxer）。放弃 ffmpeg-wasm 兜底；不支持 WebCodecs 时优雅报错。不用 av-cliper（它合成已有片段，不吃裸帧）。
  - 上传：`ossUploadService.uploadToOSS(File,{contentType:'video/mp4',dir})` → `/api/uploads/video` → `{url}`（视频无 assetId，seedance v2v 也不需要）。
  - 建节点 + 连边：`flow:agent-add-node`（type `video`，`data.videoUrl=url`）→ `flow:agent-connect-edge`（`sourceHandle:'video'` → seedance `targetHandle:'video'`）。seedance 上游解析器自动读 `data.videoUrl`。
  - `sendToCanvas.ts` 的 `sendClips*`/`sendShots*` 改为分离式纯节点（不建 combined taskNode）。

## G 后端（极薄）
`director-capture` claim/report 只扩：report 接受 `videoUrl`（+ 记 `mode`）。zod 校验/构图守卫/服务端建节点按方案二留前端。构图守卫（视锥/遮挡）作客户端可选预检，v1 可先跳过。后端常量副本无需同步。

## 类型策略
R3F 密集 5 文件（Viewport/CharacterObject/CameraRig/Modal/Runner）沿用现有 `@ts-nocheck` 惯例保 `tsc -b` 绿，后续收紧。纯逻辑层/panels 不加 nocheck。

## 依赖新增
`mp4-muxer`（dep）、`@types/dom-webcodecs`（devDep）。GLB 资产已在 `frontend/public/director/`。

## 实现分期
1. 纯逻辑层 A + types/assets + 测试，独立编译验证。
2. R3F 场景层 B（v8→v9）+ 离屏 clip 渲染。
3. 面板 C + Modal D + 小T 场景 diff 桥。
4. 视频输出 F：clipEncode 依赖 + Runner clip 模式 + ossUpload + 建 video 节点连边（分离式）。
5. 后端 report 扩 videoUrl + 端到端联调（出图/出视频/小T 驱动）。

## 验收
- `tsc -b` 绿；纯逻辑层单测通过。
- 手动：加导演台节点 → 编辑场景 → 出图落纯 image 节点；出视频落纯 video 节点并可连 seedance v2v。
- 小T：flow_patch 改场景实时生效；pendingCapture 触发渲染并产出分离式输出节点。
