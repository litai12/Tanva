# Admin 用户列表邀请人手机号

- 用户列表在手机号右侧新增“邀请人手机号”，没有邀请人或手机号时显示“—”，加载和空态跨列数同步增加。
- `GET /api/admin/users` 增加 `inviterPhone: string | null`，通过既有 `User.invitedBy` 关系仅查询 `phone`。邀请码兑换在同一事务写入兑换记录和 `invitedById`；不改变积分、注册或管理员鉴权逻辑，无数据库迁移。
- 发布按 101 当前前端基线 `85c6a019` 加既有 `f4183b23` Admin 覆盖文件重建，只叠加本次两个前端文件；后端仅发布 `admin.service.js` 和声明文件。
- 部署状态和验证结果在完成后更新。
