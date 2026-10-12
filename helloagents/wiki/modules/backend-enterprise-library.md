# 企业资料库 HTTP 与不可变版本

2026-10-12。本机开发实现，未部署生产。服务位于 `backend/src/enterprise-library/`，由 AppModule 注册；不复用 Xiangyu 协议或账号。已有素材库 MaterialAsset 只保留当前 data，无法表示可检索文本与不可变历史，所以新增独立的两张资料表，保留原素材接口。

## 接口

所有路由为 `/api/enterprise-library`，使用现有 JwtAuthGuard、JWT Cookie 与 TeamCoreService 成员校验。

| 方法与路径 | 输入与返回 |
| --- | --- |
| GET `/spaces` | 返回当前用户个人云端及 active 非个人团队空间、名称、真实成员角色 |
| GET `/documents` | `scope=cloud-personal` 或 `scope=team&teamId=...`，可选 query、enterpriseName、category、cursor、limit；返回无正文的 summaries 与 nextCursor |
| POST `/documents` | `{id,scope,teamId?,draft}`；客户端稳定 id 为同一次创建重试去重；返回实际 v1 |
| GET `/documents/:id` | 固定 scope/teamId，version 可选；指定版本读取不可变快照 |
| PATCH `/documents/:id` | `{scope,teamId?,expectedVersion,draft}`；仅成功 CAS 更新可增加版本 |
| DELETE `/documents/:id` | scope/teamId/expectedVersion；软删除当前入口，旧 revision 保留 |

`draft` 仅接受 title、content、summary、tags、enterprise、origin。正文最多 400000 字，分类为 profile/case/material/process/pricing/brand；企业归属可空，用于普通云端笔记。origin 保存 manual/import/conversation 及来源文件名或对话标识，不接收本机绝对路径或账号凭据。检索是 PostgreSQL 文本 contains，不宣称向量检索。

个人云端按 ownerId 隔离。团队成员可读取与新建，只有创建者、owner 或 admin 可改删；每次读取指定版本仍验证当前成员资格。权限、修改与快照写入使用真实数据库；修改/删除在 Serializable 事务内再次验证成员并执行版本条件更新。版本冲突、序列化冲突及不同请求复用创建 id 返回 409，不自动重放用户动作。

## 数据与迁移

- `EnterpriseKnowledgeDocument` 保存当前正文、标题、摘要、标签、企业、分类、来源、SHA-256、字节数、版本、归属与删除时间。
- `EnterpriseKnowledgeRevision` 按 documentId/version 唯一存储不可变完整快照与操作者。
- User/Team 使用实际外键，团队解散与账号删除沿 Cascade 移除该归属资料；资料软删除保留版本，不绕过成员权限。
- 部署 SQL 为 `backend/prisma/migrations/202610120001_enterprise_knowledge/migration.sql`。生产发布须应用迁移并重新生成 Prisma Client；本轮没有执行生产迁移或部署。

## 独立桌面消费者

`tanvas-desk` 的 `TanvasEnterpriseLibraryTransport` 只使用 Tanvas 捕获的 Cookie 会话及固定 Origin。个人云端、团队资料和本机资料空间明确区分，账号或空间切换后的旧 sourceIdentity 回执失效。固定版本引用经主进程写成带来源、版本与内容哈希的文件；新版不覆盖旧文件。

桌面任务默认检索本机资料。用户引用云端资料后，主进程只认自产文件回执及真实文件哈希，按该附件绑定云空间；不信任 renderer 任意构造的团队或来源描述。绑定保存到本轮 TaskRun，暂停恢复沿原 binding；模型工具 `search_enterprise_knowledge` 只接 query/limit，不能枚举团队或换账号。关键词检索至多读取 20 个云端候选，交付最多 10 条、每条 1200 字的引用原文与行号/版本/哈希，不把整库注入上下文。

## 实测证据

macOS arm64，本机 PostgreSQL 16 的独立临时容器、实际 Nest/Fastify/JWT Cookie 与生产 service，未访问生产数据库或调用付费模型。

```bash
cd backend
npm run build
node scripts/test-enterprise-library.cjs
```

验证实际 SQL 迁移、个人隔离、团队权限、分类与正文检索、创建重试去重、metadata 冲突、管理员改他人资料、并发 CAS、指定旧版本、软删除后旧版本、撤销成员与重新连接数据库。25 项 HTTP/数据库检查通过；日志 `/tmp/tanvas-enterprise-backend-http.log`。脚本仅创建并删除自身的临时容器。

桌面额外验证：HTTP transport 的账号/空间迟到响应、固定版本附件、资料导入与任务绑定关键词证据；真实 TaskController 暂停恢复不重新捕获 binding；真实回环 MCP 的只读参数与失效来源。相应测试为 `tanvas-enterprise-library.test.mjs`、`capability-controller.test.mjs`、`design-production-mcp.test.mjs`。

真实 Electron + 本机生产 HTTP API + PostgreSQL 完成个人云创建/编辑/删除、团队归类导入、页面重载、v1 原文引用、成员对他人资料只读。命令在 desk：

```bash
pnpm --filter @tanvas/desktop exec playwright test --config tests/design-e2e/playwright.config.ts enterprise-cloud.spec.ts --output /tmp/tanvas-enterprise-cloud-ui-results --reporter=list
```

2/2 通过。日志 `/tmp/tanvas-enterprise-cloud-ui.log`；证据目录 `/var/folders/06/ds2pcqxs6pbd8yzqjbxsz3j00000gn/T/tanvas-enterprise-cloud-e2e-NRAymS`；截图 `/tmp/tanvas-enterprise-cloud-ui-results/enterprise-cloud-personal--e1d23-riginal-revision-references/enterprise-team-cloud.png` 已目视。服务器、数据库及 Electron 进程正常清理。

这些本机证据不代表生产已部署、真实生产登录已验收、Windows 安装包已验证或企业内容已发布。

## 101 生产部署（2026-10-12）

用户明确授权推送与部署。实现提交 `4ec4d43eb808c387700054bda235e4cb35df45cf` 已推送 main，并在 101 `/www/wwwroot/tanvas.cn` 发布后端；本次没有 Tanva 网页前端改动。

- 发布前 `npm run build` 及隔离 PostgreSQL/Nest/JWT HTTP 25 项测试通过。生产旧 dist 与 Prisma client 备份在 `/opt/tanva-backups/enterprise-4ec4d43e-20261012/`。
- 生产存在两条数据库已应用、仓库缺失的历史迁移：`20260308001733_fix_token_bigint`、`20260315165422_add_service_node_table`。本次保留历史状态，只将新迁移 SQL 在单事务内执行（lock_timeout 5s、statement_timeout 30s），成功后用 `prisma migrate resolve --applied 202610120001_enterprise_knowledge` 登记。没有 db push、数据回填或历史迁移重放。
- 两张新表、三个业务索引（另有两个主键索引）、三个外键及迁移已完成记录均只读核验通过，初始资料/版本均为 0，未创建生产验收数据。
- 重新生成 Prisma client；后端独立目录编译后，等待 image-tasks active=0 再切换 dist，执行 PM2 reload/save。没有暂停队列。重载后 `tanvas-api` online，队列 paused=false 并正常接收新任务；三项关键 JS 文件 SHA 与新编译产物一致。
- 2026-10-12 06:01 UTC，本机与公网 `/api/health` 均 200；`/api/enterprise-library/spaces` 未登录均 401，确认路由已上线且鉴权生效。生产登录后的 CRUD 尚未用真实账号验收；权限、版本和持久化由隔离环境 25 项真实 HTTP/SQL 测试覆盖。
- 回滚可恢复上述旧 dist 并 reload；新增表与新客户端兼容旧后端，无需删除表或回滚数据。桌面客户端功能在 tanvas-desk，服务器部署不会替用户更新已安装客户端。
