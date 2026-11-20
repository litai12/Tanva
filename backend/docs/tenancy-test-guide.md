# 多租户本地验证流程

> 三层：① 自动化测试（最快）② 隔离冒烟脚本 ③ 双租户手动 e2e。
> ⚠ 本仓库 `DATABASE_URL` 指向远程共享库；第 ③ 层会写真实数据，末尾有清理 SQL。
> 怕污染就先把 `.env` 的 `DATABASE_URL` 临时指向本地 PG，再 `npx prisma migrate deploy`。

所有命令在 `backend/` 下。

---

## ① 自动化测试（无副作用）

```bash
npm run build              # 类型检查，应无 error
npm run test:tenancy       # 26 个用例：CLS/扩展注入/Host解析/JWT租户/外键断言
npm run lint:raw-sql       # 裸 SQL 闸：应输出 check passed
```
全绿即「隔离逻辑层」正确。

---

## ② 隔离冒烟脚本（连真库，只读 + 临时上下文，不留数据）

新建 `backend/scripts/tenancy-smoke.mjs`：
```js
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from '../dist/app.module.js';
const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'] });
app.setGlobalPrefix('api'); await app.init();
const inst = app.getHttpAdapter().getInstance();
const { PrismaService } = await import('../dist/prisma/prisma.service.js');
const { TenantContextService } = await import('../dist/tenancy/tenant-context.service.js');
const prisma = app.get(PrismaService), tctx = app.get(TenantContextService);
// Host 解析
const known = await inst.inject({ method:'GET', url:'/api/health', headers:{ host:'tanvas.cn' } });
const unknown = await inst.inject({ method:'GET', url:'/api/health', headers:{ host:'nope.example' } });
// 隔离
const def = await tctx.runAsTenant('default', () => prisma.project.count());
const other = await tctx.runAsTenant('t_nonexistent', () => prisma.project.count());
const plat = await tctx.runAsPlatform(() => prisma.project.count());
console.log('health known/unknown:', known.statusCode, unknown.statusCode);
console.log('project count default/other/platform:', def, other, plat);
console.log('PASS:', known.statusCode===200 && def===plat && other===0 && def>0);
await app.close(); process.exit(0);
```
运行：
```bash
npm run build && node scripts/tenancy-smoke.mjs
```
预期：`health known/unknown: 200 200`、`other=0`（隔离）、`platform=default`（逃生舱看全部）、`PASS: true`。
跑完可删除该脚本。

---

## ③ 双租户手动 e2e（curl 用 Host 头模拟分站）

### 3.1 造第二个租户 + 域名
```bash
npx prisma db execute --stdin <<'SQL'
INSERT INTO "Tenant"("id","slug","name","status","isPlatform","createdAt","updatedAt")
VALUES('t_test','acme','测试租户','active',false,now(),now()) ON CONFLICT("id") DO NOTHING;
INSERT INTO "TenantDomain"("id","tenantId","host","isPrimary","verified","createdAt")
VALUES(gen_random_uuid(),'t_test','acme.localhost',true,true,now()) ON CONFLICT("host") DO NOTHING;
SQL
```
> 主站域名是 `localhost`（已登记），第二租户用 `acme.localhost`。curl 用 `-H "Host: ..."` 切站。

### 3.2 启动后端
```bash
npm run dev      # 监听 :4000，全局前缀 /api
```

### 3.3 同一手机号在两个站各自注册（验证租户隔离账号）
```bash
# 主站（Host: localhost）
curl -s -X POST localhost:4000/api/auth/register -H 'Host: localhost' \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13900000001","password":"Test1234","name":"主站用户"}'

# 第二租户（Host: acme.localhost）—— 同一手机号应也能注册成功
curl -s -X POST localhost:4000/api/auth/register -H 'Host: acme.localhost' \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13900000001","password":"Test1234","name":"Acme用户"}'
```
预期：两次都返回 `{ user: ... }`，是两个不同 `id` 的账号 → **同手机号跨站独立**。
（若两端唯一约束没生效，第二次会报手机号已存在。）

### 3.4 各自登录拿 token
```bash
TOKEN_MAIN=$(curl -s -X POST localhost:4000/api/auth/login -H 'Host: localhost' \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13900000001","password":"Test1234"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["tokens"]["accessToken"])')

TOKEN_ACME=$(curl -s -X POST localhost:4000/api/auth/login -H 'Host: acme.localhost' \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13900000001","password":"Test1234"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["tokens"]["accessToken"])')

echo "main=$TOKEN_MAIN" ; echo "acme=$TOKEN_ACME"
```

### 3.5 跨站 token 拒绝（codex#2 核心）
```bash
# 主站 token 打主站 Host → 200，返回主站用户
curl -s localhost:4000/api/auth/me -H 'Host: localhost' -H "Authorization: Bearer $TOKEN_MAIN"
# 主站 token 打第二租户 Host → 应 401（token 租户 != Host 租户）
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/auth/me \
  -H 'Host: acme.localhost' -H "Authorization: Bearer $TOKEN_MAIN"
```
预期：第一条 200，第二条 **401**。

### 3.6 项目数据隔离
```bash
# 主站用户建项目
curl -s -X POST localhost:4000/api/projects -H 'Host: localhost' \
  -H "Authorization: Bearer $TOKEN_MAIN" -H 'Content-Type: application/json' \
  -d '{"name":"主站项目A"}'
# 主站列表能看到
curl -s localhost:4000/api/projects -H 'Host: localhost' -H "Authorization: Bearer $TOKEN_MAIN"
# 第二租户用户列表 —— 看不到主站项目A
curl -s localhost:4000/api/projects -H 'Host: acme.localhost' -H "Authorization: Bearer $TOKEN_ACME"
```
预期：第二租户列表里**没有**「主站项目A」。

### 3.7 未知域名行为
```bash
# 默认（TENANT_STRICT_HOST 未开）→ 兜底主站，200
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/health -H 'Host: random.unknown'
# 开严格模式后 → 404（需重启并设 TENANT_STRICT_HOST=true）
# TENANT_STRICT_HOST=true npm run dev  然后同上 → 404
```

### 3.8 清理测试数据
```bash
npx prisma db execute --stdin <<'SQL'
DELETE FROM "Project"     WHERE "tenantId" IN ('t_test') OR "name" = '主站项目A';
DELETE FROM "RefreshToken" WHERE "userId" IN (SELECT id FROM "User" WHERE phone='13900000001');
DELETE FROM "User"        WHERE phone='13900000001';
DELETE FROM "TenantDomain" WHERE "tenantId"='t_test';
DELETE FROM "Tenant"      WHERE id='t_test';
SQL
```
> 注意：上面按 `phone` 删 User 会删掉两个租户下的同号账号（主站测试号也清掉）。
> 若主站 `13900000001` 是你要保留的真实号，请改成按 `id` 精确删。

---

## 通过标准
- ① 全绿；② `PASS: true`；
- ③ 同号两站各注册成功(3.3)、跨站 token 401(3.5)、项目跨租户不可见(3.6)、未知域名兜底/严格符合预期(3.7)。
