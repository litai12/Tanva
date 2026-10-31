# 数据库连接池扩容（2026-10-31，101）

## 背景
合作方赛事平台因数据库连接数不足（总连接 200）出现故障。排查 101 是否有同类风险。

## 结论
- PG 服务端不是瓶颈：宿主机 PG（Tanva）与 `hono-api-postgres-1`（TapCanvas）`max_connections` 均为 100，日常仅用约 6 / 17。
- 瓶颈在应用侧 Prisma 连接池：`DATABASE_URL` 未设 `connection_limit`，Prisma 默认池在 101 上实测只有 **5** 个连接，`pool_timeout` 默认 10s。
- 复刻（`backend/scripts/db-pool-loadtest.cjs`，60 并发 × 3s `pg_sleep`）：
  - 默认池：20 成功 / 40 失败（全部 `P2024` 取连接超时），峰值 5 连接，12s。
  - `connection_limit=40&pool_timeout=20`：60/60 成功，峰值 40 连接，6s。
- 10-02 至 10-31 的 PM2 日志中 `P2024` / `too many clients` 均为 0，此前未实际触发。

## 变更（仅服务器配置，无代码发布）
- `/www/wwwroot/tanvas.cn/backend/.env`：`DATABASE_URL` 追加 `&connection_limit=40&pool_timeout=20`（备份 `.env.bak-20261031-pool`）。
- PM2 进程环境里也保存了一份 `DATABASE_URL`（会覆盖 `.env`），因此用新值 `export` 后 `pm2 reload tanvas-api --update-env`，再 `pm2 save`（备份 `/root/.pm2/dump.pm2.bak-20261031-pool`）。
- reload 前确认 `image-tasks` / `video-analysis-tasks` 队列 active=0、wait=0。reload 后 `/api/health` 200，新进程环境含新参数，`P2024` 为 0。

## 注意
- 以后改 `DATABASE_URL` 必须同时更新 PM2 保存的环境（`--update-env` + `pm2 save`），只改 `.env` 不生效。
- 容量预算：PG 100 − 保留 3 = 97；Tanva API 40，余量留给脚本/psql。若改为多实例，`connection_limit × 实例数` 不得超过余量。
- TapCanvas（hono-api 四个容器，同为 Prisma 默认池）未改动。

## 回滚
`cp .env.bak-20261031-pool .env`，以原 URL `export DATABASE_URL=...` 后 `pm2 reload tanvas-api --update-env && pm2 save`。
