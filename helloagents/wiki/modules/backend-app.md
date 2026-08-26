# 后端模块：应用启动（backend-app）

## 作用
- 负责 NestJS 应用启动、Fastify 插件注册、全局中间件/管道与 Swagger 配置。
- 提供统一 API 前缀 `/api`，并对开发环境的跨域/代理做兼容。

## 关键文件
- `backend/src/main.ts`：应用入口（FastifyAdapter、CORS、Cookie、Multipart、Swagger、ProxyAgent）
- `backend/src/app.module.ts`：根模块，组合各业务模块；配置 `ConfigModule.forRoot`

## 关键行为
- 请求体限制：`bodyLimit` 200MB（适配较大的项目内容请求）
- OpenObserve 请求遥测默认跳过项目内容保存与上传接口的成功请求体，避免把大 JSON / multipart payload 再序列化一次；如需排查可临时设置 `OPENOBSERVE_LOG_HEAVY_PAYLOAD_REQUESTS=true`
- CORS：支持 `trycloudflare.com` 子域名 + `CORS_ORIGIN` 白名单（逗号分隔）；`CORS_ORIGIN=*` 可放开所有来源（慎用生产），开发环境也可通过开关放开所有来源
- Swagger：`/api/docs`（cookie auth 名为 `access_token`）
- 代理：启动时用 undici `EnvHttpProxyAgent` 读取 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY`
- Prompt Library：认证后的 `/api/prompt-library/official` 代理并清洗 TapCanvas Prompt Library 的媒体卡片数据；相同 URL 的并发请求合并，成功响应短缓存 60 秒（最多 100 项），超时/瞬时失败自动再试一次，最终不可用才返回 502。`mine` 与 `favorites` 子路由负责当前账号自定义提示词和常用状态的 CRUD，不缓存伪造样例。

## 配置项（节选）
- `PORT`（默认 4000）
- `HOST`（默认 `0.0.0.0`）
- `CORS_ORIGIN`（可选；支持 `*` 放开所有来源）
- `CORS_DEV_ALLOW_ALL`（开发环境放开 CORS，`NODE_ENV=development` 且为 true 时生效）
- Cookie secret：`COOKIE_SECRET`（缺省为 dev 值，仅用于开发兜底）
- `TAPCANVAS_PROMPT_LIBRARY_API_URL`（官方提示词上游；默认 `https://tc.tanvas.cn/api/prompt-library`，本地联调时可覆盖为 `http://localhost:5175/api/prompt-library`）
