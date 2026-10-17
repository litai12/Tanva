# Admin 用户列表邀请人手机号

- 用户列表在手机号右侧新增“邀请人手机号”，没有邀请人或手机号时显示“—”，加载和空态跨列数同步增加。
- `GET /api/admin/users` 增加 `inviterPhone: string | null`，通过既有 `User.invitedBy` 关系仅查询 `phone`。邀请码兑换在同一事务写入兑换记录和 `invitedById`；不改变积分、注册或管理员鉴权逻辑，无数据库迁移。
- 发布按 101 当前前端基线 `85c6a019` 加既有 `f4183b23` Admin 覆盖文件重建，只叠加本次两个前端文件；后端仅发布 `admin.service.js` 和声明文件。

## 验证

- 后端构建通过；运行检查覆盖邀请人手机号映射、无关系返回 `null`、仅查询手机号及原分页/积分字段保持正常。
- 前端 TypeScript 与隔离生产构建通过；真实 UsersTab 浏览器验证手机号、空值“—”和 10 列对齐，截图已人工检查。
- 两个前端修改文件 ESLint 与修改前诊断完全一致（140 errors / 9 warnings），无新增。全库 lint 仍报 2556 errors / 199 warnings；没有宣称全库 lint 通过。约定的 AI metadata 同步脚本在本机缺失。
- 后端编译产物与线上旧版本逐行对比，仅增加本次邀请人字段和关系查询。

## 部署

- 功能提交：`efa872ce`，已推送 `origin/main`。
- 发布目录：`/opt/tanva-releases/admin-inviter-20261016/`；回退目录：`/opt/tanva-backups/admin-inviter-20261016/`。
- 2026-10-17 05:16:48 UTC（洛杉矶 2026-10-16 22:16:48）部署完成。发布前图片 active job 与近期网关未结请求均为 0；PM2 reload 后内外网健康正常，生成队列已恢复。
- 50 个文件（48 个前端文件、2 个后端文件）线上哈希与发布包一致；公网 HTML、版本、入口 JS/CSS 校验通过，旧入口 JS 仍可访问。
- 已部署 AdminService 在生产只读事务中核对 10 个已有邀请关系与 SQL 关联结果一致，无邀请关系返回 `null`，列表每页字段存在；未登录用户列表请求仍为 401。未写用户数据或触发注册、积分发放。
- 回执：发布目录下 `deployment.json`、`postcheck.json`、`public-acceptance.json`；`artifacts/manifest.json` 记录源码基线、覆盖文件、发布前与新产物哈希。
