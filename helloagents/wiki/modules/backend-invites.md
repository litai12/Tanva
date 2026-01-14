# 后端模块：邀请码（backend-invites）

## 作用
- 管理邀请码创建、兑换与邀请关系记录。

## 关键文件
- `backend/src/invites/invites.controller.ts`：`/invites/*`
- `backend/src/invites/invites.service.ts`

## 数据模型关联
- `InvitationCode`、`InvitationRedemption`、`User.invitedById`

