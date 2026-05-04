# lt-dev9 → lt-dev10 选择性迁移说明

## 目标

继续把 `lt-dev9` 里适合的功能优化，**选择性**迁移到 `lt-dev10`。不要整分支 merge。`lt-dev10` 是基于 `main` 的画布性能方案作为底座，重点保留 `main` / `lt-dev10` 的流畅度，再把 `lt-dev9` 里相对独立、低风险的功能补回来。

## 仓库与分支

| 项 | 值 |
|----|-----|
| 仓库 | `/Users/litai/Documents/Development/tanvas_2026/Tanva` |
| 当前分支 | `lt-dev10` |

## 重要原则

- 保留 `main` / `lt-dev10` 的画布性能，不要把 `lt-dev9` 里可能拖慢画布的实现整体搬过来。
- 只迁移清晰、独立、低风险的功能。
- **不要碰高风险保存链路**，除非单独评估：
  - `paperSaveService`
  - `DrawingController`
  - `objectUrlRegistry`
  - 项目懒预览 / `imagePreviewAssetService`
  - 设计 JSON 保存/持久化逻辑
- 设计 JSON 只能持久化远程 URL / key / path，不能保存 `data:`、`blob:`、裸 base64。
- 不要 revert 用户已有改动。

## 已完成并提交过的内容

- `fac143d9` — `fix(frontend): harden canvas viewport updates and flow node perf`
- `f44864b1` — `feat(flow): panel search, hydrate skip, Analyze skills, Text Chat prompt`
- `c9682f22` — `feat(flow): Text Chat skills, storyboard formats, ref caps, video analysis`
- `dc470fdf` — `feat(flow): stable progress by runKey and group run stop`
- `df85ec3c` — `feat(global-history): video records, playback UI, AI Chat Seedance write`

## 已完成迁移摘要（一）

### 1. `TextChatNode.tsx`

- 增加 `textChatSkillId`
- 增加技能预设：`custom`、`shotSplit`、`promptOptimize`、`translate`
- 预设模式使用内置 prompt 并追加上游输入
- `custom` 模式使用上游输入 + 手动输入
- 监听 `flow:updateNodeData`，读取上游最新文本
- 保留 `lt-dev10` 的自动高度、resize、Web Search 等现有能力

### 2. `StoryboardSplitNode.tsx`

- 增加 `splitFormat`
- 支持自定义分镜格式，例如 `分镜1`、`#1`、`|**1**|`
- 自动根据解析结果确定输出数量，最多 50
- 重新拆分后清理旧的 `promptN` 字段和多余 prompt 边
- 使用最新上游文本，避免 stale state

### 3. `PromptOptimizeNode.tsx`

- 运行前读取最新上游文本
- 监听上游节点数据更新，避免拿旧 prompt 优化

### 4. 图片参考数量限制

- 文件：`frontend/src/utils/flowModelProvider.ts`
- 增加限制：Fast 3、Pro 11、Ultra 14
- 增加 `getFlowImageReferenceLimit` / `resolveFlowImageReferenceLimit`
- `GenerateNode`、`GenerateProNode`、`Generate4Node` 使用 provider 对应的参考图数量

### 5. `Generate4Node.tsx`

- 修复 hook 顺序问题
- `effectiveProvider` / `maxInputPreviews` 在 `connectedInputImages` 之前声明

### 6. `VideoAnalyzeNode.tsx`

- 默认 prompt 本地化：
  - zh: `分析这个视频，描述场景、动作和关键信息。`
  - en: `Analyze this video and describe the scenes, actions, and key information.`
- 默认 prompt 仍是默认值时跟随语言同步
- 请求里带上 `bananaImageRoute`、`channelHint`、provider route options
- run 时使用 `promptInput`

### 7. `FlowOverlay.tsx`

- 新建 `textChat` 节点默认数据增加 `textChatSkillId: "custom"`

### 8. 类型和文档已同步

- `frontend/src/components/flow/types.ts`
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`

### 涉及文件列表

- `frontend/docs/06-变更日志.md`
- `frontend/src/components/flow/FlowOverlay.tsx`
- `frontend/src/components/flow/nodes/Generate4Node.tsx`
- `frontend/src/components/flow/nodes/GenerateNode.tsx`
- `frontend/src/components/flow/nodes/GenerateProNode.tsx`
- `frontend/src/components/flow/nodes/PromptOptimizeNode.tsx`
- `frontend/src/components/flow/nodes/StoryboardSplitNode.tsx`
- `frontend/src/components/flow/nodes/TextChatNode.tsx`
- `frontend/src/components/flow/nodes/VideoAnalyzeNode.tsx`
- `frontend/src/components/flow/types.ts`
- `frontend/src/utils/flowModelProvider.ts`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`

## 已验证

- `git diff --check` 通过
- `cd frontend && npm run build` 通过
- `ai-metadata-sync` 未跑通：本地脚本缺失  
  `/Users/litai/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs`

## 2026-05-04 继续迁移

### 已完成

- `GenerationProgressBar` 进度稳定性：
  - 支持 `startedAt` / `runKey`
  - 各生成/视频节点传入节点 `id` 作为 `runKey`
  - 模拟进度按同一运行 key 计算，避免节点重渲染后回到起始进度
  - 未新增设计 JSON 持久化字段
- `NodeGroupNode` 组停止按钮：
  - 分组运行中按钮从 Play 切换为 Square
  - 点击后调用 `FlowOverlay.stopGroupRun`
  - 当前子节点完成后不继续运行后续组内节点
  - `groupRunning/groupStopping` 注入绕过普通节点缓存，避免按钮状态滞后

### 本轮涉及文件

- `frontend/src/components/flow/FlowOverlay.tsx`
- `frontend/src/components/flow/nodes/GenerationProgressBar.tsx`
- `frontend/src/components/flow/nodes/NodeGroupNode.tsx`
- `frontend/src/components/flow/nodes/*`（仅补充 `GenerationProgressBar.runKey`）
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`

### 本轮验证

- `git diff --check` 通过
- `cd frontend && npm run build` 通过（仅现有 Vite chunk / dynamic import 警告）
- `cd frontend && npm run lint` 未通过：全仓既有 ESLint 债务仍存在（大量 `no-explicit-any`、未使用变量、旧 `@ts-nocheck`、`frontend/tmp_head_aiChatStore.ts` 二进制解析等），非本轮新增的可构建错误
- `ai-metadata-sync` 未跑通：本地脚本仍缺失  
  `/Users/litai/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs`

## 2026-05-04 继续迁移（二）

### 已完成

- Global History 媒体体验：
  - 新增 `frontend/src/components/global-history/historyMedia.ts`
  - `GlobalImageHistoryPage` 支持图片/视频统一展示、视频封面、播放 icon、视频下载文件名
  - `GlobalImageDetailModal` 支持视频详情与 `<video controls>` 播放
  - `imageHistoryService` 新增 `recordVideoHistoryEntry`，仅写全局历史远程视频 URL + 元数据，不做额外转存
  - AI Chat Seedance 视频生成成功后写入全局历史
- 本轮刻意未迁移：
  - `imagePreviewAssetService` 相关远程缩略图生成/转存
  - `objectUrlRegistry`
  - 保存/画布持久化链路

### 本轮涉及文件

- `frontend/src/components/global-history/historyMedia.ts`
- `frontend/src/components/global-history/GlobalImageHistoryPage.tsx`
- `frontend/src/components/global-history/GlobalImageDetailModal.tsx`
- `frontend/src/services/imageHistoryService.ts`
- `frontend/src/stores/aiChatStore.ts`
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`

### 本轮验证

- `git diff --check` 通过
- `cd frontend && npm run build` 通过（仅现有 Vite chunk / dynamic import 警告）

## 2026-05-04 继续迁移（三）

### 已完成

- Flow 运行态进度补齐：
  - `FlowOverlay` 会给运行中的节点补 `progressStartedAt`
  - 非运行状态会自动清理 `progressStartedAt`
  - Flow 复制、模板实例化、保存模板等导出链路会删除 `progressStartedAt`
  - 该字段只作为运行时 UI 状态使用，不进入设计 JSON 持久化
- 生成/视频/音频节点进度条补齐：
  - `GenerateNode`
  - `GenerateProNode`
  - `GenerateReferenceNode`
  - `MidjourneyNode`
  - `Nano2Node`
  - `Seedream5Node`
  - `ViewAngleNode`
  - `GenericVideoNode`
  - `KlingO3VideoNode`
  - `Sora2VideoNode`
  - `Wan26Node`
  - `Wan27VideoNode`
  - `Wan2R2VNode`
  - `HappyhorseR2VNode`
  - `MinimaxMusicNode`
  - `MinimaxSpeechNode`
  - `TencentSpeechNode`
- Image Split 下游句柄解析统一：
  - `GenerateNode` / `GenerateProNode` 使用 `getImageSplitHandleIndex`
  - `ImageCompressNode` / `ImageGridNode` / `ViewAngleNode` 使用共享 helper 解析 `imageN/imgN`
  - 避免手写正则只认 `imageN` 导致旧兼容句柄或归一化句柄漏解析
- 小 UI/交互迁移：
  - `VideoToGifNode` Run 按钮显示本次积分消耗
  - `VideoNode` 的 `<video controls>` 增加 `nodrag/nopan/nowheel` 与事件隔离，避免拖动/播放控件时触发画布拖拽

### 本轮涉及文件

- `frontend/src/components/flow/FlowOverlay.tsx`
- `frontend/src/components/flow/nodes/GenerateNode.tsx`
- `frontend/src/components/flow/nodes/GenerateProNode.tsx`
- `frontend/src/components/flow/nodes/GenerateReferenceNode.tsx`
- `frontend/src/components/flow/nodes/MidjourneyNode.tsx`
- `frontend/src/components/flow/nodes/Nano2Node.tsx`
- `frontend/src/components/flow/nodes/Seedream5Node.tsx`
- `frontend/src/components/flow/nodes/ViewAngleNode.tsx`
- `frontend/src/components/flow/nodes/GenericVideoNode.tsx`
- `frontend/src/components/flow/nodes/KlingO3VideoNode.tsx`
- `frontend/src/components/flow/nodes/Sora2VideoNode.tsx`
- `frontend/src/components/flow/nodes/Wan26Node.tsx`
- `frontend/src/components/flow/nodes/Wan27VideoNode.tsx`
- `frontend/src/components/flow/nodes/Wan2R2VNode.tsx`
- `frontend/src/components/flow/nodes/HappyhorseR2VNode.tsx`
- `frontend/src/components/flow/nodes/MinimaxMusicNode.tsx`
- `frontend/src/components/flow/nodes/MinimaxSpeechNode.tsx`
- `frontend/src/components/flow/nodes/TencentSpeechNode.tsx`
- `frontend/src/components/flow/nodes/ImageCompressNode.tsx`
- `frontend/src/components/flow/nodes/ImageGridNode.tsx`
- `frontend/src/components/flow/nodes/VideoNode.tsx`
- `frontend/src/components/flow/nodes/VideoToGifNode.tsx`
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`
- `helloagents/wiki/lt-dev9-to-lt-dev10-selective-migration.md`

### 本轮验证

- 已完成并提交为 `7e9e69c4`。
- `git diff --check` 通过
- `cd frontend && npm run build` 通过

## 2026-05-04 继续迁移（四）

### 已完成

- AI Chat 文本回复 metadata 透传：
  - `AITextChatResult` 增加 `metadata`
  - `generateTextResponseViaAPI` 将后端 `/api/ai/text-chat` 返回的 `metadata` 透传给调用方
  - `aiChatStore.generateTextResponse` 将 metadata 合并到消息和 `contextManager` 会话消息
- `contextManager` 提示语小修：
  - 上下文尾部提示改为直接回答当前输入
  - 明确要求不要输出内部意图分析/关键要素拆解/回复策略
  - 未迁移 lt-dev9 的构造期会话恢复变更，避免影响项目内 AI Chat 历史恢复边界
- Flow 低风险 UI/运行体验补齐：
  - `Generate4Node` 使用共享 Image Split 句柄 helper 解析 `imageN/imgN`
  - `Seedream5Node` 节点展示优先使用 `thumbnails[]` 首图，预览仍使用完整图片列表
  - `VideoAnalyzeNode` 标题、按钮、占位文案本地化，并复用运行积分按钮样式
  - `flow.css` 补充 ReactFlow viewport transform hint 和 Video Analyze run 按钮样式

### 本轮刻意未迁移

- `imagePreviewAssetService` 及 Image/ImagePro 上传缩略图远程转存
- `objectUrlRegistry` 和 AI Chat object URL 生命周期大改
- `paperSaveService` / `DrawingController` / 设计 JSON 保存链路
- `GeneratePro4Node` 模型切换大块改动
- `nodeConfigService` 定价/节点默认配置变更
- `toolStore` arrow 工具与画布绘制链路变更
- `projectContentStore` dirty 判等优化（涉及保存触发边界，需单独评估）

### 本轮涉及文件

- `frontend/src/components/flow/flow.css`
- `frontend/src/components/flow/nodes/Generate4Node.tsx`
- `frontend/src/components/flow/nodes/Seedream5Node.tsx`
- `frontend/src/components/flow/nodes/VideoAnalyzeNode.tsx`
- `frontend/src/services/aiBackendAPI.ts`
- `frontend/src/services/contextManager.ts`
- `frontend/src/stores/aiChatStore.ts`
- `frontend/src/types/ai.ts`
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`
- `helloagents/wiki/lt-dev9-to-lt-dev10-selective-migration.md`

### 本轮验证

- `git diff --check` 通过
- `cd frontend && npm run build` 通过（仅现有 Vite dynamic import / chunk size 警告）
- `ai-metadata-sync` 未跑通：本地脚本仍缺失
  `/Users/litai/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs`

## 2026-05-04 继续迁移（五）

### 已完成

- 用户明确点名的路线快捷开关：
  - 右上角顶栏新增 Nano Banana/Gemini/GPT-Image-2 生文/生图路线下拉快捷切换
  - 复用现有 `bananaImageRoute` / `setBananaImageRoute`，与设置面板状态一致
  - 仅迁移前端快捷入口；未迁移 lt-dev9 的 `bananaRouteStatsApi` / 成功率统计轮询，避免引入后端 API 耦合
- 用户明确点名的箭头工具：
  - `DrawMode` 增加 `arrow`
  - 工具栏绘制菜单新增箭头按钮，主按钮可显示当前箭头工具
  - `useDrawingTools` 新增箭头路径几何、开始/更新/完成逻辑
  - `useInteractionController` 将箭头接入点击-点击与拖拽绘制流程
  - `LayerPanel` 识别 `data.tool = "arrow"` 并显示箭头类型/icon
  - 箭头以普通 Paper Path + `data.tool` 运行态/画布图元保存，不改设计 JSON 保存链路

### 本轮刻意未迁移

- `bananaRouteStatsApi` / 后端 banana route 成功率统计
- `paperSaveService` / `DrawingController` / 保存链路重构
- `objectUrlRegistry` / `imagePreviewAssetService`

### 本轮涉及文件

- `frontend/src/components/layout/FloatingHeader.tsx`
- `frontend/src/components/toolbar/ToolBar.tsx`
- `frontend/src/components/canvas/hooks/useDrawingTools.ts`
- `frontend/src/components/canvas/hooks/useInteractionController.ts`
- `frontend/src/components/panels/LayerPanel.tsx`
- `frontend/src/stores/toolStore.ts`
- `frontend/src/i18n/locales/zh-CN.ts`
- `frontend/src/i18n/locales/en-US.ts`
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`
- `helloagents/wiki/lt-dev9-to-lt-dev10-selective-migration.md`

### 本轮验证

- `git diff --check` 通过
- `cd frontend && npm run build` 通过（仅现有 Vite dynamic import / chunk size 警告）
- `ai-metadata-sync` 未跑通：本地脚本仍缺失
  `/Users/litai/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs`

## 2026-05-04 继续迁移（六）

### 已完成

- P0：Banana route 成功率统计与顶部展示：
  - 后端新增 `GET /api/ai/banana-route-success-rates`
  - 按客户端时区统计当天 `normal/stable` 路线的成功/失败/处理中调用数
  - 前端新增 `bananaRouteStatsApi`
  - 右上角路线快捷切换下拉展示今日成功率与信号条
- P1：`GeneratePro4Node` 模型/参考图能力补齐：
  - 节点本地支持 `Fast / Pro / Ultra` 模型切换
  - 缺省时从全局 `aiProvider` 解析并写入 `modelProvider`
  - 运行积分预览按当前节点模型与已连接参考图数量计算
  - 参考图数量按共享 `flowModelProvider` 限制收敛（Fast=3、Pro=11、Ultra=14）
- P1：项目管理弹窗预览宫格：
  - 每页从 6 项扩展到 12 项
  - 仅懒加载当前页项目内容并从 `assets` / Flow 节点数据提取图片引用
  - 卡片预览从单张缩略图改为最多 16 张的宫格预览
  - 重命名/删除改为悬浮 icon 操作
  - 仅读取项目内容，不做缩略图转存，不改保存链路

### 本轮刻意未迁移

- `paperSaveService` / `DrawingController` / 保存链路重构
- `objectUrlRegistry` / `imagePreviewAssetService`
- `nodeConfigService` 定价/节点默认配置变更
- `projectContentStore` dirty 判等优化
- Banana web-search 旧后端 route

### 本轮涉及文件

- `backend/src/ai/ai.controller.ts`
- `frontend/src/services/bananaRouteStatsApi.ts`
- `frontend/src/components/layout/FloatingHeader.tsx`
- `frontend/src/components/flow/nodes/GeneratePro4Node.tsx`
- `frontend/src/components/projects/ProjectManagerModal.tsx`
- `frontend/src/i18n/locales/zh-CN.ts`
- `frontend/src/i18n/locales/en-US.ts`
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/backend-ai.md`
- `helloagents/wiki/modules/frontend-app.md`
- `helloagents/wiki/modules/frontend-flow.md`
- `helloagents/wiki/lt-dev9-to-lt-dev10-selective-migration.md`

### 本轮验证

- `git diff --check` 通过
- `cd frontend && npm run build` 通过（仅现有 Vite dynamic import / chunk size 警告）
- `cd backend && npm run build` 通过

## 建议下一步

1. 检查当前工作区：

   ```bash
   git status --short --branch
   ```

2. 建议先把当前这批已验证的改动提交掉，避免后续迁移混在一起。

3. 继续从 `lt-dev9` 对比挑低风险功能：

   ```bash
   git diff --name-status lt-dev10..lt-dev9 -- \
     frontend/src/components/flow \
     frontend/src/services \
     frontend/src/stores \
     frontend/src/utils
   ```

## 下一轮候选

- 继续筛 `frontend/src/components/flow/nodes/*` 中的纯 UI/运行体验差异：
  - 不改保存结构
  - 不引入新服务依赖
  - 不碰图片预览资产转存
- 可单独评估项目内会话恢复边界，但需要先确认不会影响 AI Chat 历史恢复。
- 可继续检查 Global History / Library 侧的媒体展示补齐，但不迁移缩略图远程转存逻辑。

## 暂时不要迁移

- Banana web-search 旧后端 route（后端/API 耦合较高）
- `nodeConfigService` 中定价/节点默认配置变更（可能影响线上计费与节点可见性）
- `imagePreviewAssetService`
- `objectUrlRegistry`
- `paperSaveService`
- `DrawingController`
- 保存、画布持久化、项目预览资产链路
- 后端积分 / provider route 大改（除非用户明确要求）
