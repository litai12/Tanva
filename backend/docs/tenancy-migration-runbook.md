# 租户基座 — 数据库迁移 Runbook

> 适用：把单租户库改造成多租户基座。本仓库的目标库（Sealos 远程）已按本文步骤应用完毕；
> 本文供**其它环境（staging/新部署）复刻**与**回滚参考**。

## 为什么不用 `prisma migrate dev`

目标库的本地迁移历史与 DB 的 `_prisma_migrations` 已**漂移**（本地有未应用项、DB 有本地缺失项）。
`prisma migrate dev` 检测到漂移会提示 `migrate reset`（**DROP 全库**），在共享/生产库上绝不可触发。
因此本基座一律用**手写增量 DDL** + `prisma db execute` 应用（纯 `CREATE/ALTER/CREATE INDEX`，非破坏），
再 `prisma generate` 同步客户端类型。DDL 脚本留档于 `backend/.tenancy-backup/`。

## 前置

1. **备份**：对目标库做快照/逻辑备份（本仓库无 pg_dump/psql，用了 `pg_indexes` 导出索引定义到
   `.tenancy-backup/indexes-snapshot.sql` 作为最小留档；正式环境请用 `pg_dump`）。
2. 确认主站域名（本仓库 = `tanvas.cn`，来自 `APP_BASE_URL`）。
3. `cd backend`。

## 步骤

### 阶段 A — 租户表 + 主站种子（`.tenancy-backup/p1_tenant_tables.sql`）
```bash
npx prisma db execute --file .tenancy-backup/p1_tenant_tables.sql
```
建 `Tenant`/`TenantDomain`，插入主站 `Tenant{id:'default',slug:'platform',isPlatform:true}`
与 `TenantDomain{host:'tanvas.cn'}`。脚本幂等（`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`）。
> 新环境改 host 为该环境主站域名。可追加 `www.`、`localhost`（见 `p4_extra_domains.sql`）。

### 阶段 B — 业务表加 tenantId + User 复合唯一（`.tenancy-backup/p2_add_tenant_id.sql`）
```bash
npx prisma db execute --file .tenancy-backup/p2_add_tenant_id.sql
```
- 31 张业务表 `ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default'`
  （PG11+ 常量默认值不重写全表，存量自动回填 'default'）+ 单列 `tenantId` 索引。
- `User`：建 5 个复合唯一 `(tenantId, phone/email/watchaUserId/wechatOfficialOpenId/wechatUnionId)`，
  删除旧单列唯一。**前置安全**：迁移时全部数据属主站，复合唯一等价旧全局唯一，不会冲突。
> 大表/生产：把 `CREATE UNIQUE INDEX` 改为 `CREATE UNIQUE INDEX CONCURRENTLY` 并拆成独立的无事务执行，
> 避免长写锁。本仓库目标库数据量小，直接执行。

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
