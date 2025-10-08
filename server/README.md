# Tanva Server (NestJS)

NestJS backend with Fastify adapter. Provides authentication (cookie-based JWT), user info, project management with content storage (Aliyun OSS + DB fallback), uploads presign, and health checks.

## Setup

- Copy `server/.env.example` to `server/.env` and fill values.
- Ensure PostgreSQL is available and `DATABASE_URL` is correct.

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
- `POST /api/auth/send-sms` { phone } → returns fixed code `336699` in dev
- `POST /api/auth/login-sms` { phone, code } → sets cookies
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
