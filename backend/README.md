# Tanva Server (NestJS)

NestJS backend with Fastify adapter. Provides authentication (cookie-based JWT), user info, project management with content storage (Aliyun OSS + DB fallback), uploads presign, and health checks.

## Setup

- Copy `server/.env.example` to `server/.env` and fill values.
- Ensure PostgreSQL is available and `DATABASE_URL` is correct.
- Local infra (Postgres + Redis): `docker compose up -d` (from `backend/`, uses `backend/.env` for defaults).
  - Images are pulled from `docker.1ms.run` mirror (see `backend/docker-compose.yml`).
- 配置 Sora 视频服务相关环境变量：
  - `SORA2_API_KEY`：Sora 提供的 API Key（必填）
  - `SORA2_API_ENDPOINT`：可选，默认 `https://api1.147ai.com`
  - `SORA2_HD_MODEL` / `SORA2_SD_MODEL`：可选，覆盖默认模型名称
- 配置 VEO 视频服务相关环境变量：
  - `VEO_API_KEY`：VEO 提供的 API Key（必填；也可复用 `BANANA_API_KEY` / `SORA2_API_KEY`）
  - `VEO_API_ENDPOINT`：可选，默认 `https://api1.147ai.com`

## Install & Run

```bash
cd server
npm install
# Generate Prisma client and DB tables
npx prisma migrate dev --name init
# Dev
npm run dev
# Build & start
npm run build && npm start
```

## API

- `GET /api/health` Health probe
- `GET /api/health/db` DB connectivity probe

Auth (`/api/auth`):
- `POST /api/auth/register` { phone, password, email?, name? }
- `POST /api/auth/login` { phone, password } → sets HttpOnly cookies
- `POST /api/auth/send-sms` { phone } → returns `debugCode` in dev/debug mode (default `336699`, see `SMS_FIXED_CODE`)
- `POST /api/auth/login-sms` { phone, code } → sets cookies
  - New behavior: if ALI credentials are provided and `REDIS_URL` is configured, server will send real SMS and store codes in Redis.
  - Environment variables:
    - `ALI_ACCESS_KEY_ID`, `ALI_ACCESS_KEY_SECRET`, `ALI_SIGN_NAME`, `ALI_TEMPLATE_CODE` — 阿里云短信配置
    - `REDIS_URL` — 可选，推荐用于生产（跨实例共享验证码）
    - `SMS_DEBUG` — 可选，true 时 `send-sms` 会返回 `debugCode`（便于本地调试）
    - `SMS_CODE_TTL` — 验证码有效期（秒，默认 300）
    - `SMS_FIXED_CODE` — 开发/调试固定验证码（默认 336699）
  - Dev invite code: `DEV_INVITE_CODE` can be used as a fixed code in `register` without creating DB invitation code records.
- `GET /api/auth/me` (Cookie `access_token` required)
- `POST /api/auth/refresh` (Cookie `refresh_token` required) → rotates refresh token
- `POST /api/auth/logout` (Cookie `refresh_token` required) → clears cookies

Users (`/api/users`):
- `GET /api/users/me` (Cookie `access_token` required)

Uploads (`/api/uploads`):
- `POST /api/uploads/presign` { dir?, maxSize? } (Cookie `access_token` required)

Projects (`/api/projects`): (Cookie `access_token` required)
- `GET /api/projects` List my projects
- `POST /api/projects` { name? } Create project
- `GET /api/projects/:id` Get project
- `PUT /api/projects/:id` { name } Rename
- `DELETE /api/projects/:id` Remove
- `GET /api/projects/:id/content` Get content (OSS with DB fallback)
- `PUT /api/projects/:id/content` { content, version? } Update content

Swagger UI: `GET /api/docs`

## Notes

- Cookies: `access_token`, `refresh_token` (HttpOnly). `COOKIE_DOMAIN` should not be set to `localhost` in dev.
- CORS: origins from `CORS_ORIGIN` (comma-separated) with `credentials: true`.
- OSS direct upload: Use `presign` response to POST to `https://<bucket>.<region>.aliyuncs.com` (or CDN host if configured) with returned fields and your file.
- Project content is written to OSS when possible; DB field `contentJson` stores latest snapshot as fallback; `contentVersion` increments on updates.
