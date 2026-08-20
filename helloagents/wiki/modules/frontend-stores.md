# 前端模块：状态管理（frontend-stores）

## 作用
- 使用 Zustand 管理全局状态，例如认证态、项目列表、工作区状态等。

## 关键目录
- `frontend/src/stores/`：各类 store 定义（以文件实现为准）

## 交互要点
- `ProtectedRoute` 在首次挂载时触发 `authStore.init()`，避免无意义的“每次打开页面就请求一次 /api/auth/me”。
- AI 会话状态由 `aiChatStore` 管理，持久化字段为 `Project.contentJson.aiChatSessions/aiChatActiveSessionId`。
- `aiChatStore` 的普通 Text、Flow Text Chat、工具选择和 PDF 分析默认使用 `gpt-5.4`；HTML PPT、Paper.js、图像转矢量与普通 Agent trace/research 使用 `gpt-5.6-luna`。提示词优化独立支持 Luna/Terra/DeepSeek V4 Flash 三模型，不再读取全局图片 provider 推导模型。小T偏好 v8 仅接受对应三种 facade ID，旧 5.4/5.5 或未知值迁移到 Luna。图片识别继续使用 Gemini 三档并只提交远程 URL；视频分析由节点的 `analysisModel` 独立持久化。
- AI Chat 普通 Text 请求默认只把当前输入发送到 `/api/ai/text-chat`；命中“继续/调整/再试”等迭代意图，或“刚才/之前/上文/上一条/这个/那个/这两个/previous/last”等上下文指代时，才通过 `contextManager.buildContextPrompt` 拼接对话历史。迭代计数与上下文依赖检测独立，Flow Text Chat 节点不走这条 AI Chat 上下文注入路径。
- AI Chat Auto/Generate 的多图输出数量默认来自 `autoModeMultiplier`，但会先解析本次输入里的明确输出数量（如“画两张”“生成 3 张”“多张方案”）并覆盖默认倍数；“用两张参考图/把两张图融合”等输入素材数量不应触发输出倍数。明确数量触发并行时，每个 slot 会使用拆分后的单张 prompt，强调“本次只生成 1 张完整图片”，避免把总张数画成单图拼图或同图多主体。
- 小T模式不使用上述自然语言覆盖逻辑：`autoModeMultiplier` 直接写入 `imageOutputCount`，同时由 `XiaotImagePatchContract` 限制实际落板的单输出图片节点、prompt、连线和 `runNode`。`gptImage2` 的宿主能力声明包含 `text/img` 输入与单个 `img:image` 输出，用于节点选择与连线，但 `runNode` tool call 只代表命令到达 Tanva。`agentPatchApplier` 为每轮建立结构化执行回执，严格串行等待节点创建、真实连线和节点运行；`runNode` 必须由 Flow 返回成功/失败和远程资产 URL，队列完成后才自动布局并聚焦首个图片生成节点。
- 前端在请求边界先把当前 Flow 投影为节点数量/类型摘要、选中节点和由本轮文字明确命中的最多 8 个节点；完整快照不离开浏览器，未命中的节点正文、媒体 URL 和连线不会发送给 Tanva 后端或小T上游。纯问候由后端本地即时完成，前端仍消费同一套 `run_started → assistant_delta → final → done` 事件，不需要分叉 UI。
- 小T画布任务的聊天占位文案只在运行中显示；终帧正文兼容读取 `message` 与 `data.text`，并继续通过 AI Chat 的 Markdown 渲染器展示。只要本轮存在图片生成节点，必须等每个预期图片节点产生真实 HTTP(S) URL 后才显示“已完成”，并将这些 URL 作为 `media` 卡写入同一消息；facade 的等待文案或命令发出不能覆盖宿主事实。节点执行失败、连线失败或成功节点缺少真实 URL 时消息显式进入失败终态并保留画布节点状态。前端 SSE 客户端必须收到真实 `done` 才允许返回成功；`verifyXiaotTurnDelivery` 会拒绝上游 `error`（即使已有部分正文）以及正文、patch、宿主工具和 UI 卡全部为空的回合，因此传输层关闭或部分内容不再自动生成“任务已完成”。
- `aiChatStore` 收到 `create_presentation` / `edit_presentation` 时在当前小T回合内执行浏览器宿主工具：消息内临时图片先上传为远程 URL，再创建/定位 `htmlPpt`、连接选中素材并等待节点 `flow:run-node` 的真实成功/失败回执。成功后写入 `artifactKind=presentation` 成品卡和真实节点 ID，卡片可聚焦画布并派发 HTML/PPTX 导出事件；宿主工具回合不会被上游的等待正文覆盖成假完成。
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
