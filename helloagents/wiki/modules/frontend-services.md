# 前端模块：服务层（frontend-services）

## 作用
- 封装与后端交互的 HTTP 调用、AI 相关请求、上传/素材访问等逻辑，降低 UI 与 API 的耦合。

## 关键目录
- `frontend/src/services/`：API client、具体业务服务（以文件实现为准）

## 约定
- 后端 API 前缀 `/api`，开发环境下由 Vite proxy 转发到 `http://localhost:4000`（见 `frontend/vite.config.ts`）。
- 前端所有网络请求统一使用 `fetchWithAuth`（`frontend/src/services/authFetch.ts`），默认携带登录态并在 401/403 时触发退出；对第三方/公开资源可通过 `auth: "omit"` 与 `credentials: "omit"` 控制鉴权与凭据。
- 静态资源默认直连 OSS/CDN（`VITE_ASSET_PUBLIC_BASE_URL` 拼接 `projects/...` 等 key），仅在需要代理时显式开启 `VITE_PROXY_ASSETS=true`。
- 管理后台深度拨测调用优先使用 `api-health/e2e-by-node/:nodeKey`（`frontend/src/services/adminApi.ts` 的 `streamE2ETest`），仅在缺少 `nodeKey` 时回退到 `e2e-by-id/:id` 或 `e2e/:provider`。
- 管理后台 API 节点配置 DTO（`ApiConfig` / `CreateApiConfigDto` / `UpdateApiConfigDto`）已支持 `modelName`，用于“一模型一监控”场景下精确传参与展示。
- 管理后台单节点连通性检测已切换到 `api-health/check-by-node/:nodeKey`；`ApiHealthNode` 新增 `bindingStrategy` 并支持 `setApiHealthNodeBinding(nodeKey, configId)` 显式锁定/解除通道绑定。
