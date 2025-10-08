**概述**
- 技术栈：NestJS 10 + Fastify、Prisma(PostgreSQL)、Passport JWT、Aliyun OSS、Swagger。
- 基础信息：全局前缀 `api`，Swagger 文档 `GET /api/docs`，使用 HttpOnly Cookie 存放访问令牌与刷新令牌。

**目录结构（server/src）**
- `main.ts`：应用引导（Fastify 适配、Helmet、Cookie、Multipart、CORS、全局校验、Swagger）。
- `app.module.ts`：聚合模块（Config、Prisma、Users、Auth、Health、Oss、Projects）。
- `auth/*`：登录注册、短信登录、刷新/登出、JWT 与刷新 JWT 策略与守卫。
- `users/*`：用户查询（当前用户）。
- `projects/*`：项目 CRUD 与内容读写（OSS + DB 回退）。
- `oss/*`：阿里云 OSS 直传签名、JSON 读写与公开地址生成。
- `health/*`：健康检查与数据库连通性检查。
- `prisma/*`：PrismaService 以及数据库模型（见 `server/prisma/schema.prisma`）。

**启动与运行**
- 环境配置：复制 `server/.env.example` 为 `server/.env` 并填写变量；确保 PostgreSQL 可用。
- 依赖安装与初始化：
  - `cd server && npm install`
  - `npx prisma migrate dev --name init`
- 本地开发：`npm run dev`
- 构建与启动：`npm run build && npm start`

**全局配置与中间件**
- 适配器：Fastify（`bodyLimit` 20MB，适配较大项目内容）。
- 安全：`@fastify/helmet`（CSP 关闭以便前端调试）。
- Cookie：`@fastify/cookie`（密钥 `COOKIE_SECRET`）。
- 上传：`@fastify/multipart`。
- CORS：来源取自 `CORS_ORIGIN`（逗号分隔），`credentials: true`。
- 校验：全局 `ValidationPipe({ whitelist: true, transform: true })`。
- Swagger：标题 TAI API，启用 Cookie Auth（名称 `access_token`）。

**认证与会话（auth）**
- 令牌形态：
  - 访问令牌：`access_token`（HttpOnly Cookie），默认 TTL `JWT_ACCESS_TTL=900s`。
  - 刷新令牌：`refresh_token`（HttpOnly Cookie），默认 TTL `JWT_REFRESH_TTL=30d`。
- 存储策略：
  - 刷新令牌哈希存储于表 `RefreshToken.tokenHash`，并记录 `ip` 与 `userAgent`。
  - 刷新时“旋转”令牌：校验最近一条未吊销记录后吊销并签发新令牌。
  - 登出：批量吊销该用户下所有未吊销刷新令牌并清空 Cookie。
- Cookie 选项：
  - `httpOnly: true`、`secure`、`sameSite`、`domain`、`path: '/'`；
  - `COOKIE_DOMAIN` 若为 `localhost/127.0.0.1/空` 将自动不设置域（避免本地开发 Cookie 问题）。
- 守卫与策略：
  - `JwtAuthGuard` 使用策略 `jwt`；从 Cookie `access_token` 提取，回退支持 `Authorization: Bearer`。
  - `RefreshAuthGuard` 使用策略 `jwt-refresh`；从 Cookie `refresh_token` 提取。
- 相关接口：
  - `POST /api/auth/register` { phone, password, email?, name? }
  - `POST /api/auth/login` { phone, password }
  - `POST /api/auth/send-sms` { phone }（开发环境固定返回 `336699`）
  - `POST /api/auth/login-sms` { phone, code }
  - `GET /api/auth/me`（需 `access_token`）
  - `POST /api/auth/refresh`（需 `refresh_token`）
  - `POST /api/auth/logout`（需 `refresh_token`）

**用户（users）**
- `GET /api/users/me`：返回当前登录用户的脱敏信息（不含 `passwordHash`）。

**阿里云 OSS 上传与文件（oss）**
- 直传签名：`POST /api/uploads/presign`（需登录）
  - 请求：`{ dir?: string = 'uploads/', maxSize?: number = 10MB }`
  - 响应：`{ host, dir, expire, accessId, policy, signature }`
  - 用法：前端将文件以表单直传至 `https://<bucket>.<region>.aliyuncs.com`（或 `OSS_CDN_HOST`），表单包含上述字段与 `key`/`file` 等。
- JSON 工具：
  - `putJSON(key, data)`：写入 JSON（失败时仅告警，不阻断流程）。
  - `getJSON(key)`：读取 JSON（不存在返回 `null`，其它错误告警并返回 `null`）。
  - `publicUrl(key)`：返回公开访问 URL（优先 `OSS_CDN_HOST`，否则 `<bucket>.<region>.aliyuncs.com`）。

**项目（projects）**
- 数据模型（摘要）：
  - `Project { id, userId, name, ossPrefix, mainKey, contentVersion, contentJson?, createdAt, updatedAt }`
- 接口（均需登录）：
  - `GET /api/projects`：列出我的项目（包含 `mainUrl` 派生字段）。
  - `POST /api/projects` { name? }：创建项目；初始化 `ossPrefix/mainKey` 与初始 JSON；DB 保存 `contentJson` 作为回退。
  - `GET /api/projects/:id`：获取项目信息（含 `mainUrl`）。
  - `PUT /api/projects/:id` { name }：重命名。
  - `DELETE /api/projects/:id`：删除。
  - `GET /api/projects/:id/content`：优先从 OSS 读取内容；若失败/缺失，回退 DB `contentJson`。
  - `PUT /api/projects/:id/content` { content, version? }：写 OSS；无论 OSS 失败与否更新 DB `contentJson` 并 `contentVersion += 1`。

**健康检查（health）**
- `GET /api/health`：服务存活探针。
- `GET /api/health/db`：数据库连通性探针（`SELECT 1`）。

**Prisma 模型（简要）**
- `User { id, email?, phone, passwordHash, name?, avatarUrl?, role, status, lastLoginAt?, createdAt, updatedAt }`
- `RefreshToken { id, userId, tokenHash, userAgent?, ip?, isRevoked, expiresAt, createdAt }`
- `Project { id, userId, name, ossPrefix, mainKey, contentVersion, contentJson?, createdAt, updatedAt }`

**环境变量（摘自 .env.example）**
- 基础：`PORT`, `HOST`
- 数据库：`DATABASE_URL`
- JWT：`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`
- Cookie：`COOKIE_SECRET`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN`, `CORS_ORIGIN`
- OSS：`OSS_REGION`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_CDN_HOST?`, `OSS_ENDPOINT?`

**安全与注意事项**
- Cookie 域在本地开发不可设置为 `localhost`；代码已自动忽略此情况。
- 访问令牌也支持 `Authorization: Bearer <token>` 作为回退；优先从 Cookie 提取。
- 日志中包含用户校验输出（`JwtStrategy` 打印验证结果）；生产可考虑移除/降低日志敏感度。
- OSS 失败不会中断项目创建或内容更新流程，前端仍可通过返回值中的 DB 回退数据正常工作。

**调试示例（cURL）**
- 登录（保存 Cookie）：
  - `curl -i -c cookies.txt -H 'Content-Type: application/json' -d '{"phone":"13800138000","password":"Passw0rd1"}' http://localhost:4000/api/auth/login`
- 获取当前用户：
  - `curl -b cookies.txt http://localhost:4000/api/users/me`
- 刷新令牌：
  - `curl -X POST -b cookies.txt -c cookies.txt http://localhost:4000/api/auth/refresh`

**版本与路线图**
- 版本：0.1.0
- 后续：资产管理、AI 代理接口、更多项目协作能力。

