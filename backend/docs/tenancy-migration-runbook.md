# 租户基座 — 数据库迁移 Runbook

> 适用：把单租户库改造成多租户基座。本仓库的目标库（Sealos 远程）已按本文步骤应用完毕；
> 本文供**其它环境（staging/新部署）复刻**与**回滚参考**。

## 为什么不用 `prisma migrate dev`

目标库的本地迁移历史与 DB 的 `_prisma_migrations` 已**漂移**（本地有未应用项、DB 有本地缺失项）。
`prisma migrate dev` 检测到漂移会提示 `migrate reset`（**DROP 全库**），在共享/生产库上绝不可触发。
本基座的全部 DDL 已收敛为一个标准迁移文件：
**`prisma/migrations/20260608120000_tenancy_foundation/migration.sql`**
（建 Tenant/TenantDomain + 主站种子 + 域名 + 31 表加 tenantId + User 复合唯一）。
本仓库目标库当初用 `prisma db execute` 增量应用，再用 `prisma migrate resolve --applied`
把该迁移登记为已应用，故迁移历史与 DB 一致。

## 前置

1. **备份**：对目标库做快照/逻辑备份（正式环境用 `pg_dump`）。
2. 确认主站域名（本仓库 = `tanvas.cn`，来自 `APP_BASE_URL`；migration.sql 内种子的 host 也是它，
   新环境按需改）。
3. `cd backend`。

## 步骤

### 方式一（新环境/干净库，推荐）
```bash
npx prisma migrate deploy   # 会执行含 tenancy_foundation 在内的全部迁移
npx prisma generate
```
> ⚠ 既有漂移：本仓库本地迁移历史与某些环境的 `_prisma_migrations` 存在历史漂移
> （3 个 DB-only 迁移、1 个本地未应用项，开工前即存在，与本基座无关）。对**已运行的老库**
> 直接 `migrate deploy` 前需先核对 `prisma migrate status`，必要时对个别迁移用 `migrate resolve`。

### 方式二（漂移库，无法 migrate deploy 时）
直接对库执行迁移 SQL（纯 `CREATE/ALTER/CREATE INDEX` + 幂等 `IF NOT EXISTS`/`ON CONFLICT`）：
```bash
npx prisma db execute --file prisma/migrations/20260608120000_tenancy_foundation/migration.sql
npx prisma migrate resolve --applied 20260608120000_tenancy_foundation   # 登记已应用
npx prisma generate
```
要点：
- 31 张业务表 `ADD COLUMN ... tenantId TEXT NOT NULL DEFAULT 'default'`（PG11+ 常量默认不重写全表，存量自动回填）。
- `User` 建 5 个复合唯一并删旧单列唯一；迁移时数据全属主站，复合唯一等价旧全局唯一，不冲突。
- 大表/生产：把 `CREATE UNIQUE INDEX` 改 `CONCURRENTLY` 并拆为无事务执行，避免长写锁。

### 阶段 C — 同步 schema 与客户端
schema.prisma 已含 `Tenant`/`TenantDomain` 与各表 `tenantId`、User 复合唯一。
```bash
npx prisma validate && npx prisma generate
```

### 阶段 D — 校验
```bash
# tenantId 回填无 NULL（示例查 User/Project）
npx prisma db execute --stdin <<< 'SELECT count(*) FROM "User" WHERE "tenantId" IS NULL;'
# 应用启动 + 注入冒烟见「验证」节
npm run build && npm run test:tenancy && npm run lint:raw-sql
```

## 回滚

- **基座上线初期（仅主站一个租户）回滚是安全的**：删 `tenantId` 列、还原 `User` 单列唯一即可。
- **一旦开站第二个租户并产生跨租户重复手机号/email**，直接还原全局单列唯一会**失败**
  （存在重复值）。此时回滚前必须先归并/清理跨租户重复账号。务必在开第二租户前评估。

## 与运行时开关

- `TENANT_STRICT_HOST`（默认关）：开启后未知 Host 返回 404。开启前须登记全部对外域名并豁免回调/健康路由。
- `TRUST_FORWARDED_HOST`（默认关）：信任 `x-forwarded-host`（仅在可信反代后开启）。

## 关联文档
- 设计：`docs/superpowers/specs/2026-06-08-租户基座-design.md`
- 计划：`docs/superpowers/plans/2026-06-08-租户基座.md`
- 已知缺口/上线前门槛：`backend/docs/tenancy-known-gaps.md`
