# Tanva Server (NestJS)

NestJS backend for authentication, users, OSS presign, and future AI proxy.

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

- `GET /api/health`
- `POST /api/auth/register` {email, password, name?}
- `POST /api/auth/login` {email, password} (sets HttpOnly cookies)
- `POST /api/auth/refresh` (uses refresh cookie)
- `POST /api/auth/logout`
- `GET /api/users/me`
- `POST /api/uploads/presign` {dir?, maxSize?}
- `GET /api/projects/:id/content`
- `PUT /api/projects/:id/content` {content, version?}

Swagger: `GET /api/docs`

## Notes

- Cookies: `access_token`, `refresh_token` (HttpOnly)
- OSS direct upload: Use `presign` response to POST to `https://<bucket>.<region>.aliyuncs.com` with returned fields and your file.
- Next: add Project/Asset models and AI proxy endpoints.
