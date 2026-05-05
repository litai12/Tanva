# lt-dev9 -> lt-dev10 选择性迁移状态

## 目标

在 `lt-dev10` 保留 `main` 画布性能底座的前提下，选择性迁移 `lt-dev9` 中清晰、独立、低风险的能力。不要整分支 merge。

## 基本原则

| 原则 | 说明 |
|---|---|
| 保护性能底座 | 不把 `lt-dev9` 中可能拖慢画布的实现整体搬回。 |
| 低风险优先 | 优先迁移节点 UI、运行态、句柄兼容、文案、轻量后端透传。 |
| 设计 JSON 约束 | `Project.contentJson` / `PublicTemplate.templateData` 只允许保存远程 URL / key / path；禁止 `data:`、`blob:`、裸 base64。 |
| 保存链路谨慎 | `paperSaveService`、`DrawingController`、`objectUrlRegistry`、`imagePreviewAssetService`、项目预览资产和持久化链路默认不动。 |
| 不回滚用户改动 | 工作区可能已有用户或其他任务改动，继续迁移时只做局部增量。 |

## 已完成改动

| 优先级 | 模块 | 已完成内容 | 主要文件/范围 | 验证 |
|---|---|---|---|---|
| P0 | Canvas 性能 | 缩放/平移走 guarded `setViewport`，高频 viewport 更新 RAF 合并，非激活图片覆盖层降订阅，低缩放网格降负载。 | `frontend/src/components/canvas/*`、`frontend/src/stores/*` | 已 build |
| P0 | Flow 进度稳定 | `GenerationProgressBar` 支持 `runKey/startedAt`；运行态 `progressStartedAt` 只作为 UI 状态，复制/模板/非运行时清理。 | `FlowOverlay.tsx`、`GenerationProgressBar.tsx`、多类生成/视频节点 | 已 build |
| P0 | Flow 分组停止 | `NodeGroupNode` 运行时按钮切换为停止；当前子节点结束后跳过后续队列；group 状态绕过普通节点缓存。 | `FlowOverlay.tsx`、`NodeGroupNode.tsx` | 已 build |
| P0 | AI Chat 会话边界 | 项目内会话只从 `Project.content.aiChatSessions` / `aiChatActiveSessionId` 水合；全局 IndexedDB/localStorage 会话只用于无项目场景，避免历史串入项目。 | `contextManager.ts`、`aiChatStore.ts` | 已 build |
| P1 | Flow Text Chat | `TextChatNode` 支持 Skill 预设（Custom / Shot Split / Prompt Optimize / CN-EN Convert）、上游乐观 patch 读取、节点本地 Fast/Pro/Ultra；节点底部联网搜索和状态行已移除；运行禁用 web search，并移除动态 resize / node internals 同步。 | `TextChatNode.tsx`、`FlowOverlay.tsx`、`types.ts` | 已 build |
| P1 | Flow Prompt/Storyboard | `PromptOptimizeNode` 运行前读取最新上游文本；`StoryboardSplitNode` 支持自定义拆分格式并按解析结果生成输出端口。 | `PromptOptimizeNode.tsx`、`StoryboardSplitNode.tsx` | 已 build |
| P1 | Flow 图像参考上限 | Fast=3、Pro=11、Ultra=14 统一进入预览、连接接纳与运行请求；`GeneratePro4` 补齐节点本地模型切换和积分预览。 | `flowModelProvider.ts`、`Generate*Node.tsx`、`FlowOverlay.tsx` | 已 build |
| P1 | Flow Image Split 兼容 | 下游统一解析 `imageN/imgN` 句柄；支持 Image Split / Image(crop) 裁切输入；Image Grid 接收 split 输出；生成节点补历史隐藏句柄。 | `imageSplitHandles.ts`、`FlowOverlay.tsx`、`GenerateNode.tsx`、`ImageGridNode.tsx` 等 | 已 build |
| P1 | Analysis / Image Chat | Analysis 节点支持多图、文本 prompt 追加、Skill 预设（Analysis / Prompt / JSON）；Image Chat 保留英文 chrome，中文环境只本地化提示/占位文案。 | `AnalyzeNode.tsx`、`AnalysisOutputNode.tsx`、后端 analyze DTO/provider | 已 build |
| P1 | Video Analysis | 默认 prompt 跟随语言；请求显式携带 Banana route/channel；按钮、标题、占位和积分样式与其他运行节点对齐。 | `VideoAnalyzeNode.tsx`、`FlowOverlay.tsx` | 已 build |
| P1 | 后端文本/路线 | 非 Gemini `/api/ai/text-chat` 透传 `webSearchResult/metadata`；积分请求保留显式 `channelHint`；新增当天 Banana normal/stable 成功率接口。 | `backend/src/ai/ai.controller.ts`、`bananaRouteStatsApi.ts` | 前后端 build |
| P1 | 顶部路线切换 | 工作区右上角 Nano Banana/Gemini/GPT-Image-2 普通/尊享路线快捷切换，显示当日成功率；尊享路线恢复 amber Crown 样式。 | `FloatingHeader.tsx` | 已 build |
| P1 | Canvas 精确改图/高清放大 | Shift 局部修改传递裁剪 bounds、像素尺寸和比例；`precise-edit/lockToBounds` 原位占位；高清放大改为发送到画布而不是下载。 | `DrawingController.tsx`、`aiChatStore.ts`、`useQuickImageUpload.ts`、`ImageContainer.tsx` | 已 build |
| P1 | Canvas 扩图 UI | 图片扩图按钮使用独立 `Expand` 图标，扩图 prompt/合成蒙版改为红色蒙版语义，扩图选择结束后释放操作锁，并跳过非激活图片 overlay 渲染。 | `ImageContainer.tsx` | 已 build |
| P1 | Global History 媒体 | 全局历史支持图片/视频统一展示、封面/播放/详情播放；AI Chat Seedance 和 Flow 视频成功输出写入远程视频历史；库面板历史视频可按视频资产发送/拖拽到画板。 | `historyMedia.ts`、`GlobalImageHistoryPage.tsx`、`GlobalImageDetailModal.tsx`、`imageHistoryService.ts`、`LibraryPanel.tsx`、`DrawingController.tsx` | 已 build |
| P1 | AI Chat 文本上下文策略 | 普通 Text 请求默认只发送当前输入；只有命中继续/调整/再试等迭代意图时才拼接会话历史，避免无关历史污染当前问题；Flow Text Chat 不受影响。 | `aiChatStore.ts` | 已 build |
| P1 | Flow 节点纯 UI 小补齐 | `TextChatNode` 运行按钮积分 tooltip 与其他 Flow 节点统一为本地化的“消耗/积分”文案；节点面板/Quick Connect 按 `lt-dev9` 规则隐藏 `generateRef` 与 `sora2Video`；剩余 Flow 节点差异已筛过，涉及保存/预览资产链路的项暂不迁移。 | `TextChatNode.tsx`、`FlowOverlay.tsx` | 已 build |
| P2 | 视频节点体验 | 视频节点运行进度改走共享进度条；`VideoToGif` 显示积分；原生视频控件隔离拖拽/滚轮事件；HappyHorse 支持 taskId 轮询恢复。 | `GenericVideoNode.tsx`、`VideoNode.tsx`、`VideoToGifNode.tsx`、`HappyhorseR2VNode.tsx` | 已 build |
| P2 | Project Manager | 项目管理弹窗每页 12 项；当前页懒加载内容并从 `assets` / Flow 节点抽取图片宫格；重命名/删除改为悬浮 icon。 | `ProjectManagerModal.tsx` | 已 build |
| P2 | Canvas 箭头工具 | 新增箭头绘制模式，工具栏入口、绘制 hook、交互控制、图层类型/icon 已接入；不改变设计 JSON 规则。 | `toolStore.ts`、`ToolBar.tsx`、`useDrawingTools.ts`、`LayerPanel.tsx` | 已 build |
| P2 | 缓存/转存 | Provider 视频 OSS 转存缓存增加 1 小时 TTL 与 500 条上限。 | `video-provider.service.ts` | 后端 build |
| P2 | Global History / Library 媒体体验 | 库面板全局历史/项目库复用共享媒体 helper：图片/视频标签、封面、播放入口、详情播放与下载文件名统一；视频发送/拖拽到画板走 `canvas:insert-video`，避免误走图片上传链路。 | `LibraryPanel.tsx`、`DrawingController.tsx`、`historyMedia.ts` | 已 build |
| P2 | Video Analyze route-aware billing/providerOptions | 已对照 `lt-dev9`：前端 `VideoAnalyzeNode` 无差异；后端保留 `providerOptions.banana.imageRoute`、`bananaImageRoute`、`channelHint` 的路线解析与 Fast/Pro/Ultra 计费矩阵，当前实现为共享 helper 版本，无需额外迁移。 | `VideoAnalyzeNode.tsx`、`credits.service.ts`、`ai.controller.ts` | diff 对照 |
| P2 | 文档同步 | `frontend/docs/06-变更日志.md`、`helloagents/CHANGELOG.md`、`helloagents/project.md` 与模块 wiki 已按迁移更新。 | `frontend/docs/`、`helloagents/` | `git diff --check` |

## 未完成 / 后续候选

P2 候选已清空；以下为暂缓项，需单独设计和回归。

| 优先级 | 候选项 | 当前建议 | 风险/注意点 |
|---|---|---|---|
| P3 | `nodeConfigService` 定价/默认节点配置 | 暂缓，除非明确要改线上节点配置策略。 | 可能影响计费、节点可见性、后台配置优先级。 |
| P3 | Banana web-search 旧后端 route | 暂缓。 | 后端/API 耦合高，且当前文本链路已有 route-aware 计费约束。 |
| P3 | `imagePreviewAssetService` 远程缩略图转存 | 暂缓。 | 容易碰项目预览资产和保存链路，可能引入 data/blob 持久化风险。 |
| P3 | `objectUrlRegistry` 与 AI Chat object URL 生命周期大改 | 暂缓。 | 横跨运行时预览、释放、刷新恢复，容易产生裂图或过早 revoke。 |
| P3 | `paperSaveService` / 保存 / 项目预览资产链路 | 默认不迁移。 | 高风险核心保存链路，必须单独设计和回归。 |
| P3 | `projectContentStore` dirty 判等优化 | 暂缓。 | 会影响自动保存触发边界，需配合项目保存回归。 |

## 验证记录

| 检查 | 最近结果 |
|---|---|
| `git diff --check` | 通过 |
| `cd frontend && npm run build` | 通过，仅现有 Vite dynamic import / chunk size 警告 |
| `cd backend && npm run build` | 最近涉及后端改动时通过 |
| `cd frontend && npm run lint` | 未作为迁移阻断项；仓库存在既有 ESLint 债务 |
| `ai-metadata-sync` | 未跑通，本地脚本缺失：`/Users/litai/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs` |

## 继续迁移时的建议命令

```bash
git status --short --branch
git diff --name-status lt-dev10..lt-dev9 -- \
  frontend/src/components/flow \
  frontend/src/services \
  frontend/src/stores \
  frontend/src/utils
```
