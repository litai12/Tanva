# 前端模块：状态管理（frontend-stores）

## 作用
- 使用 Zustand 管理全局状态，例如认证态、项目列表、工作区状态等。

## 关键目录
- `frontend/src/stores/`：各类 store 定义（以文件实现为准）

## 交互要点
- `ProtectedRoute` 在首次挂载时触发 `authStore.init()`，避免无意义的“每次打开页面就请求一次 /api/auth/me”。
- AI 会话状态由 `aiChatStore` 管理，持久化字段为 `Project.contentJson.aiChatSessions/aiChatActiveSessionId`。
- AI 文本对话会保存后端返回的 `metadata`，其中 `webSearchEnabled` 用于消息头的“已联网”状态；构造上下文提示时要求模型直接回答当前输入，避免把内部意图分析/回复策略泄漏为最终回复。
- AI 图片工具链路（融合/编辑）在源图为远程 URL 时仅对白名单 host 直传 `sourceImageUrls/sourceImageUrl`；非白名单远程图会先尝试在前端读取并上传 OSS，再传可持久化 URL，避免后端 `imageUrl host not allowed`。
- 导入对话 JSON 时采用追加策略并重映射 `sessionId`，避免覆盖当前会话。

## 2026-04 theme note
- `aiChatStore` now persists `chatTheme: "white" | "black"` for workspace visual style selection.
- `setChatTheme()` is used by `FloatingHeader` appearance settings and drives workspace-wide class toggling in `Canvas`.
