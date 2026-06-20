# 视频合成节点（Video Compose Node）— 设计 spec

**日期**: 2026-06-20
**来源**: 从 `/Users/libiqiang/workspace/TapCanvas-pro` 复刻视频合成节点到 Tanva 画布
**范围**: 仅本子项目（视频合成）。导演台为下一个独立 spec。

## 目标

在 Tanva 的 ReactFlow 画布里新增一个「视频合成」节点：把上游连接的 2 个及以上视频节点，
按顺序在**浏览器端**裁剪 + 拼接为一个 MP4，可选混入上游音频节点的配音/BGM 轨；
提供全屏时间轴编辑器（缩略图、拖拽裁剪、分割、入/出点、撤销重做、缩放、磁力吸附、播放预览）。

## 方案选型

**A. 独立节点组件（采纳）** —— 把 `videoCompose` 做成 Tanva 自己的 ReactFlow 节点类型，
结构对齐现有 `VideoNode`/`Sora2VideoNode`。纯逻辑模块近乎原样移植，仅重写两个 UI 组件。
- B. 引入源项目 taskNode/feature 抽象层 —— 否决（等于重构画布，违反 YAGNI）。
- C. 后端 ffmpeg 合成 —— 否决（源项目就是纯浏览器 WebAV，Tanva 无合成服务）。

## 架构

全部前端，后端零改动。合成在浏览器内用 `@webav/av-cliper`：
拉取各上游视频字节 → `MP4Clip` 裁剪 → `Combinator` 按序拼接 + 从 0 时刻混入音频轨 →
输出 MP4 `Blob`。结果先用 `blob:` URL **秒回写**画布（立即可见），后台 `uploadToOSS` 转存，
成功后把临时 URL 换成持久 OSS URL（按 blob 精确匹配再换，防覆盖期间改动）。

## 新增文件 `frontend/src/components/flow/nodes/videoCompose/`

| 文件 | 来源 | 处理 |
|------|------|------|
| `composeVideosCore.ts` | 原样移植 | 纯逻辑，零依赖 React/xyflow |
| `useVideoCompose.ts` | 原样移植 | React hook（composing/progress/error/abort） |
| `composeWriteback.ts` | 适配 | Tanva 单 `videoUrl` 形状：立即写 `{videoUrl:blobUrl,status:'ready'}`；上传成功后若 `videoUrl===blobUrl` 换持久 URL |
| `reliableClipFetch.ts` | 适配 | 代理候选改 `/api/assets/proxy?url=`，保留退避重试 + HTML 伪 200 检测 |
| `collectUpstreamComposeSources.ts` | 重写 | 按 Tanva `node.type ∈ VIDEO_SOURCE_NODE_TYPES` 读 `videoUrl`；音频按 `type ∈ {audioUpload,minimaxSpeech,tencentSpeech,minimaxMusic}` 读 `audioUrl`（音量默认 1，`minimaxMusic` 循环铺底） |
| `VideoComposeEditorModal.tsx` | 重写 UI | 全屏时间轴编辑器，逻辑照搬，组件换 lucide + 原生/Tailwind |
| `VideoComposeContent.tsx` | 重写 UI | 节点体：空态/就绪/已合成（预览+下载+重新合成） |
| `VideoComposeNode.tsx` | 新增 | ReactFlow 节点壳：`useStore` 读上游、持状态、Handle、回写+上传 |

## 接入改动 `frontend/src/components/flow/FlowOverlay.tsx`

1. `rawNodeTypes` (~1024)：`videoCompose: VideoComposeNode`
2. `NODE_CREDITS_MAP` (~1692)：`videoCompose: 0`（客户端，不消耗积分）
3. `NODE_PALETTE_ITEMS` (~1747)：`{ key:"videoCompose", zh:"视频合成", en:"Video Compose", category:"video" }`
4. `NODE_PANEL_GROUP_BY_TYPE` (~1859)：`videoCompose: "video"`
5. `FLOW_NODE_DEFAULT_SIZE` (~1927)：`videoCompose: { w: 320, h: 360 }`
6. `FALLBACK_SOURCE_HANDLES_BY_NODE_TYPE` (~2265)：`videoCompose: ["video"]`
7. `FALLBACK_TARGET_HANDLES_BY_NODE_TYPE` (~2316)：`videoCompose: ["video", "audio"]`
8. `VIDEO_SOURCE_NODE_TYPES` (~1334)：追加 `"videoCompose"`（其输出也是视频）
9. `isValidConnection` (~11806)：新增 `targetNode.type === "videoCompose"` 分支：
   - `targetHandle==="video"`：`sourceHandle ∈ {video,video-out}` 且 `VIDEO_SOURCE_NODE_TYPES.includes(source.type)`
   - `targetHandle==="audio"`：`sourceHandle==="audio"` 且 `source.type ∈ {audioUpload,minimaxSpeech,tencentSpeech,minimaxMusic}`

注：`onConnect`（~13180）**不**给 videoCompose 加单边去重 —— video/audio 两个目标 handle 都允许多条入边。

## Handle 设计

- 目标 `id="video"`（接多条视频边）、目标 `id="audio"`（接音频边）、源 `id="video"`（合成产物输出）。
- 边颜色复用 `getEdgeHandleKind`：`video`→紫、`audio`→粉，无需新增。

## 依赖

`frontend/package.json` 新增 `@webav/av-cliper@^1.2.7`，`npm install`。需 WebCodecs（Chrome 系）。

## 风险/注意

- WebAV 需跨域读字节 → 统一走 `/api/assets/proxy` 同源拉取；代理对非托管/三方直链返回非 200 时回退直连。
- ReactFlow v11 导入用 `reactflow`（非 `@xyflow/react`）。
- fiber/drei 版本差异不影响本功能（不碰 3D）。
- 节点组件沿用现有 `@ts-nocheck` 约定；纯 `.ts` 模块保持有类型。

## 验证

前端无测试框架。验证 = `tsc -b` 通过 + 手动画布联调：连 2 个视频节点 → 打开编辑器 →
裁剪/分割 → 合成 → 预览 → 下载 → 确认 OSS 转存替换链接。
