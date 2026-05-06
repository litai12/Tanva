# 前端模块：状态管理（frontend-stores）

## 作用
- 使用 Zustand 管理全局状态，例如认证态、项目列表、工作区状态等。

## 关键目录
- `frontend/src/stores/`：各类 store 定义（以文件实现为准）

## 交互要点
- `ProtectedRoute` 在首次挂载时触发 `authStore.init()`，避免无意义的“每次打开页面就请求一次 /api/auth/me”。
- AI 会话状态由 `aiChatStore` 管理，持久化字段为 `Project.contentJson.aiChatSessions/aiChatActiveSessionId`。
- AI Chat 普通 Text 请求默认只把当前输入发送到 `/api/ai/text-chat`；只有命中“继续/调整/再试”等迭代意图时才通过 `contextManager.buildContextPrompt` 拼接对话历史。Flow Text Chat 节点不走这条 AI Chat 上下文注入路径。
- AI Chat 工具选择兜底会把缓存图上的 `改文字` / `改成` / `替换文字` 等编辑意图路由到 `editImage`，避免尊享路线工具选择不稳定时退成 `chatResponse`。
- AI 图片工具链路（融合/编辑）在源图为远程 URL 时仅对白名单 host 直传 `sourceImageUrls/sourceImageUrl`；非白名单远程图会先尝试在前端读取并上传 OSS，再传可持久化 URL，避免后端 `imageUrl host not allowed`。
- 导入对话 JSON 时采用追加策略并重映射 `sessionId`，避免覆盖当前会话。
- `projectContentStore.updatePartial(..., { markDirty: false })` 会跳过无变化快照；项目 autosave 管理器同步 canvas `zoom/pan` 时使用 160ms 防抖和同值过滤，避免缩放/平移期间把高频视角变化转成 React 内容状态更新。

## 2026-04 theme note
- `aiChatStore` now persists `chatTheme: "white" | "black"` for workspace visual style selection.
- `setChatTheme()` is used by `FloatingHeader` appearance settings and drives workspace-wide class toggling in `Canvas`.
