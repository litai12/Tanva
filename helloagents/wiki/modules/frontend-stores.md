# 前端模块：状态管理（frontend-stores）

## 作用
- 使用 Zustand 管理全局状态，例如认证态、项目列表、工作区状态等。

## 关键目录
- `frontend/src/stores/`：各类 store 定义（以文件实现为准）

## 交互要点
- `ProtectedRoute` 在首次挂载时触发 `authStore.init()`，避免无意义的“每次打开页面就请求一次 /api/auth/me”。
- AI 会话状态由 `aiChatStore` 管理，持久化字段为 `Project.contentJson.aiChatSessions/aiChatActiveSessionId`。
- `aiChatStore` 的非小T模型按任务固定分层：普通 Text、Flow Text Chat、提示词优化、工具选择和 PDF 分析使用 `gpt-5.4`；图像分析、HTML PPT、Paper.js、图像转矢量与普通 Agent trace/research 使用 `gpt-5.6`。文本/分析模式不再显示 Fast/Pro/Ultra/DeepSeek 模型切换；视频分析仍显式选择 Gemini 视频模型，小T模型偏好保持独立。
- AI Chat 普通 Text 请求默认只把当前输入发送到 `/api/ai/text-chat`；命中“继续/调整/再试”等迭代意图，或“刚才/之前/上文/上一条/这个/那个/这两个/previous/last”等上下文指代时，才通过 `contextManager.buildContextPrompt` 拼接对话历史。迭代计数与上下文依赖检测独立，Flow Text Chat 节点不走这条 AI Chat 上下文注入路径。
- AI Chat Auto/Generate 的多图输出数量默认来自 `autoModeMultiplier`，但会先解析本次输入里的明确输出数量（如“画两张”“生成 3 张”“多张方案”）并覆盖默认倍数；“用两张参考图/把两张图融合”等输入素材数量不应触发输出倍数。明确数量触发并行时，每个 slot 会使用拆分后的单张 prompt，强调“本次只生成 1 张完整图片”，避免把总张数画成单图拼图或同图多主体。
- AI Chat 图片生成任务前端轮询上限为 15 分钟；消息写入错误态时会派发画布占位框 remove 事件，画布 `useQuickImageUpload` 还会定时清理过期或孤儿 AI 预测占位框，避免 95% 等待框残留。
- AI Chat 工具选择兜底会把缓存图上的 `改文字` / `改成` / `替换文字` 等编辑意图路由到 `editImage`，避免尊享路线工具选择不稳定时退成 `chatResponse`。
- AI Chat Auto 模式会并行创建 `/api/agent/runs` 规划 trace，并把 SSE 事件归并到当前 AI 占位消息的 `metadata.agentTrace`；上下文依赖命中时会把会话上下文传给 Agent Runtime 并展示“读取会话上下文”步骤。实际工具执行仍走现有 `processUserInput` / `executeProcessFlow` 链路。
- AI Chat 的 Agent trace 支持 `research_result`，前端会从 `metadata.agentTrace.researchResult` 渲染案例卡片、来源链接和图片检索网格；“案例/资料/参考/建筑/教堂”等文本请求会自动为 text-chat 打开联网搜索。
- AI 图片工具链路（融合/编辑）在源图为远程 URL 时仅对白名单 host 直传 `sourceImageUrls/sourceImageUrl`；非白名单远程图会先尝试在前端读取并上传 OSS，再传可持久化 URL，避免后端 `imageUrl host not allowed`。
- 导入对话 JSON 时采用追加策略并重映射 `sessionId`，避免覆盖当前会话。
- `projectContentStore.updatePartial(..., { markDirty: false })` 会跳过无变化快照；项目 autosave 管理器同步 canvas `zoom/pan` 时使用 160ms 防抖和同值过滤，避免缩放/平移期间把高频视角变化转成 React 内容状态更新。
- `projectContentStore.cacheValidationPending` 表示项目内容来自本地缓存且远端版本仍在校验；该状态下自动保存与手动保存都应暂停，直到远端校验通过或云端内容完成刷新。
- `projectContentStore.projectViewReady` 表示当前项目内容已完成首屏 Flow paint 并经过一次 idle/稳定窗口；项目切换或内容 hydrate 会重置为 `false`，由 `FlowOverlay` 确认后置回 `true`，用于控制 `/app` 全屏项目加载层。
- 同项目内的撤销/重做必须走 `projectContentStore.restoreHistorySnapshot()`，只替换内容并递增 `dirtyCounter`；不得复用 `hydrate()`，否则会把云端乐观锁基线 `version`、`lastSavedAt`、stale 保护和保存状态一起回滚/重置。历史回放必须保留当前 `projectViewReady`，避免普通 undo/redo 触发全屏项目加载层。
- `projectStore` 维护本地 `recentProjectIds`（localStorage: `tanva_recent_project_ids`，最多 5 个），在项目加载、创建、打开、删除时同步，用于工作区顶部项目下拉展示最近打开项目；项目管理弹窗仍读取完整 `projects` 列表。顶部快速切换应让下拉先关闭，再异步调用 `open(projectId)`，避免项目加载副作用阻塞菜单关闭反馈。

## 2026-04 theme note
- `aiChatStore` now persists `chatTheme: "white" | "black"` for workspace visual style selection.
- `setChatTheme()` is used by `FloatingHeader` appearance settings and drives workspace-wide class toggling in `Canvas`.
