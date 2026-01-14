# 后端模块：应用启动（backend-app）

## 作用
- 负责 NestJS 应用启动、Fastify 插件注册、全局中间件/管道与 Swagger 配置。
- 提供统一 API 前缀 `/api`，并对开发环境的跨域/代理做兼容。

## 关键文件
- `backend/src/main.ts`：应用入口（FastifyAdapter、CORS、Cookie、Multipart、Swagger、ProxyAgent）
- `backend/src/app.module.ts`：根模块，组合各业务模块；配置 `ConfigModule.forRoot`

## 关键行为
- 请求体限制：`bodyLimit` 200MB（适配较大的项目内容请求）
- CORS：支持 `trycloudflare.com` 子域名 + `CORS_ORIGIN` 白名单（逗号分隔）
- Swagger：`/api/docs`（cookie auth 名为 `access_token`）
- 代理：启动时用 undici `EnvHttpProxyAgent` 读取 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY`

## 配置项（节选）
- `PORT`（默认 4000）
- `HOST`（默认 `0.0.0.0`）
- `CORS_ORIGIN`（可选）
- Cookie secret：`COOKIE_SECRET`（缺省为 dev 值，仅用于开发兜底）

