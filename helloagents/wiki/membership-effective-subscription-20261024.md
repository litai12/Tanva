# 会员生效口径单轨化（2026-10-24）

## 事故

用户 199 月卡 2026-10-24 10:10（北京时间）到期。到期扫描 `expireElapsedMemberships` 是小时级 cron，订阅 `status` 仍为 `active`：

- 积分侧（签到清理、免费积分衰减、`hasActiveVipEntitlement`）按 `currentPeriodEndAt > now` 判断，已视为免费用户：10:21 签到时清掉此前累积的 290 签到积分，当次签到按免费档发放。
- 会员页 `GET /membership/current` 与 `getMembershipEntitlement` 只看 `status='active'` 和滞后的 `MembershipEntitlementSnapshot`：仍显示 199 会员“今天到期”，`hasActiveSubscription=true`，前端把同档 199 按钮置为“当前套餐”，无法购买。

同一时刻两套口径，形成“页面显示会员、积分已按免费处理、又不能重新购买”的双轨状态。

## 根治

- `vip-entitlement-policy.ts` 新增 `effectiveSubscriptionWhere(now)`：`status='active'` 且 `now ∈ [currentPeriodStartAt, currentPeriodEndAt)`，为会员生效唯一口径。
- 会员展示（`getCurrentMembership`、`getMembershipEntitlement`）、下单预览、充值赠送资格、每日会员赠送、免费积分衰减、签到规则/清理、免费用户额度、权益解析全部改用该口径。
- `getMembershipEntitlement` 不再以快照判断生效：无生效订阅即返回 `free/inactive`；有生效订阅时套餐与周期取自订阅本身，快照仅提供 `pauseGiftDecay`。
- `activatePaidMembershipOrder` 激活前按用户结算已到期但未扫描的订阅（`settleElapsedSubscriptions`，与 cron 共用逻辑）：
  - 同档续费不再从已过去的结束时间顺延，而是从支付时刻开新周期；
  - 升级单支付时原订阅已到期，则按新开通激活，不再沿用已结束周期或报“当前没有可升级的生效订阅”。
- 签到积分“会员资格失效即清除”的规则不变。

## 未改动

- 会员生效期间购买同档套餐（`renew`）仍被下单接口拒绝，是否允许提前续费属产品决策。
- 管理员侧按原始 `status='active'` 记录操作（立即过期、调整天数、年费分期）保持不变。

## 验证

- 新增 `npm run test:membership-effective-subscription`：复现到期未扫描状态，校验会员页、预览、同档激活、升级激活；修复前失败、修复后通过。
- `daily-reward-policy`、`free-credit-decay-policy`、`free-credit-consumption`、`watermark-entitlement`、`admin-paid-orders` 通过；`tsc --noEmit` 与 `npm run build` 通过。
- `test:seedance2-whitelist` 在本次改动前已失败（mock 缺 `watermarkEntitlement`），与本次无关。

## 发布

- `9afea06c` 已推送并部署 101（git pull → `npm run build` → PM2 reload `tanvas-api`），无数据库迁移。
- 生产验证：`tanvas-api` online；内网与公网 `/api/health` 200；`dist` 含新口径；服务器上 `test:membership-effective-subscription` 通过。
- 生产只读核验（事故用户 `13316093001`）：`/membership/current` 返回 plan=null、`inactive`、`hasActiveSubscription=false`；`vip_199_monthly` 预览为 `subscribe`、应付 199，可正常购买。当前 `status=active` 且已过结束时间的订阅为 0。
- 事故中被清除的 290 签到积分未补发，是否补偿待定。
