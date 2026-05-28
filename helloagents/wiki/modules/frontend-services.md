# 前端模块：服务层（frontend-services）

## 作用
- 封装与后端交互的 HTTP 调用、AI 相关请求、上传/素材访问等逻辑，降低 UI 与 API 的耦合。

## 关键目录
- `frontend/src/services/`：API client、具体业务服务（以文件实现为准）

## 约定
- 后端 API 前缀 `/api`，开发环境下由 Vite proxy 转发到 `http://localhost:4000`（见 `frontend/vite.config.ts`）。
- 前端所有网络请求统一使用 `fetchWithAuth`（`frontend/src/services/authFetch.ts`），默认携带登录态并在 401/403 时触发退出；对第三方/公开资源可通过 `auth: "omit"` 与 `credentials: "omit"` 控制鉴权与凭据。
- 静态资源默认直连 OSS/CDN（`VITE_ASSET_PUBLIC_BASE_URL` 拼接 `projects/...` 等 key），仅在需要代理时显式开启 `VITE_PROXY_ASSETS=true`。
- 项目内容保存是整包 JSON PUT，属于服务器压力热点；自动保存最小持久化间隔保持 60s，保存后的项目缩略图刷新 cooldown 保持 5 分钟，避免 100 人级在线编辑时产生 OSS/DB/遥测写入放大。
- AI/视频等影响积分的 POST 请求成功后会触发全局 `refresh-credits`，但事件源头需要做短窗口合并，避免批量生成时重复拉取 `/api/credits/balance` 和签到状态。
