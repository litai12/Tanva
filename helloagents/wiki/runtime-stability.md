# Runtime Stability Hardening (2026-03-20)

## Scope
- Frontend: React + Vite runtime guards.
- Backend: NestJS telemetry intake endpoint.
- Deployment: Docker build consistency and nginx cache policy alignment.

## Frontend changes
- Added startup runtime bootstrap in `frontend/src/bootstrap/runtimeStability.ts`.
- Added storage schema guard keyed by `VITE_STORAGE_SCHEMA_VERSION` to clear stale persisted client state during breaking releases.
- Added production version polling against `/version.json`, with reload flow on mismatch.
- Added global error capture for:
  - `window.onerror`
  - `unhandledrejection`
  - static resource load errors
- Added structured frontend error reporting to backend endpoint `/api/telemetry/frontend-error`.
- Autosave keeps 5s debounce, plus a 15s minimum persisted save interval to avoid write amplification under burst edits.

## Backend changes
- Added `TelemetryModule` with controller endpoint:
  - `POST /api/telemetry/frontend-error`
- Logged structured runtime failure payloads with app/build context for release triage.
- Added per-project serialized save execution and duplicate-content hash short-circuit in ProjectsService.updateContent to reduce concurrent save amplification without dropping real changes.

## Deployment changes
- Frontend Docker builder now installs full dependencies (`npm ci`) and accepts build args:
  - `APP_VERSION`
  - `STORAGE_SCHEMA_VERSION`
- nginx cache policy updated:
  - `index.html` => no-store/no-cache
  - `version.json` => no-store/no-cache
  - hashed static assets => long cache + immutable

## Verification status
- Backend build: passed (`npm run build` in `backend/`).
- Frontend type check/build entry: reached Vite gate, blocked by local Node version (`20.18.1`) requiring `20.19+`.




- Added Object.hasOwn polyfill at app bootstrap to prevent legacy Edge runtime crash in bundled dependencies.

## Backend DB Pressure Hardening (2026-03-21)

- Added anti-overlap guards for credits scheduler jobs to avoid concurrent runs fighting for Prisma pool connections.
- Split cron responsibilities:
  - pending timeout auto-refund keeps `EVERY_5_MINUTES`.
  - daily credit anomaly detection moved to `EVERY_HOUR`.
- Added explicit Prisma pool-timeout detection in AI `withCredits` path and map it to `503 ServiceUnavailable` (`数据库繁忙，请稍后重试`) instead of generic 500.
- Tuned stale-pending auto-refund default batch size from `200` to `100` to lower per-run DB burst pressure.
- Added Prisma index for stale pending scan:
  - `ApiUsageRecord @@index([responseStatus, serviceType, createdAt])`
