# 前端模块：服务层（frontend-services）

## 作用
- 封装与后端交互的 HTTP 调用、AI 相关请求、上传/素材访问等逻辑，降低 UI 与 API 的耦合。

## 关键目录
- `frontend/src/services/`：API client、具体业务服务（以文件实现为准）

## 约定
- 后端 API 前缀 `/api`，开发环境下由 Vite proxy 转发到 `http://localhost:4000`（见 `frontend/vite.config.ts`）。
- 前端所有网络请求统一使用 `fetchWithAuth`（`frontend/src/services/authFetch.ts`），默认携带登录态并在 401/403 时触发退出；对第三方/公开资源可通过 `auth: "omit"` 与 `credentials: "omit"` 控制鉴权与凭据。
