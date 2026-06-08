# 后端模块：邀请码（backend-invites）

## 作用
- 管理邀请码创建、兑换与邀请关系记录。

## 关键文件
- `backend/src/referral/referral.controller.ts`：`/api/referral/*`
- `backend/src/referral/referral.service.ts`

## 数据模型关联
- `InvitationCode`、`InvitationRedemption`、`User.invitedById`

## 接口约定
- `GET /api/referral/stats` 返回邀请码、全量邀请统计、收益统计，以及分页后的 `inviteRecords`；支持 `page`/`pageSize`，默认 `1/20`，`pageSize` 上限 100。
