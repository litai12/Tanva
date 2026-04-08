# Tanva 会员与支付接口文档

**日期：** 2026-04-08

**说明：** 本文档描述的是当前仓库中已经落地的真实接口，不是纯设计稿口径。后端全局前缀为 `/api`。

---

## 1. 鉴权说明

- 支付回调接口不需要用户登录：
  - `POST /api/payment/notify`
  - `POST /api/payment/wechat-notify`
  - `POST /api/payment/wechat/notify`
- 其余本文档中的接口都需要 `Authorization: Bearer <token>`

---

## 2. 支付接口

### 2.1 `GET /api/payment/packages`

获取积分充值套餐。

响应示例：

```json
{
  "packages": [
    {
      "price": 10,
      "credits": 2000,
      "bonus": null,
      "tag": "首充翻倍",
      "isFirstRecharge": true
    }
  ],
  "creditsPerYuan": 100
}
```

### 2.2 `GET /api/payment/membership-plans`

获取可售会员套餐列表。

响应示例：

```json
{
  "plans": [
    {
      "id": "plan_uuid",
      "code": "vip_199_monthly",
      "name": "VIP 199 月卡",
      "billingCycle": "monthly",
      "price": 199,
      "monthlyQuotaCredits": 20000,
      "signupBonusCredits": 2000,
      "dailyGiftCredits": 100,
      "metadata": {
        "planCode": "vip_199",
        "pauseGiftDecay": true
      }
    }
  ]
}
```

### 2.3 `POST /api/payment/order`

创建支付订单。支持充值单和会员单。

充值单请求：

```json
{
  "amount": 100,
  "credits": 22400,
  "paymentMethod": "alipay",
  "orderType": "recharge"
}
```

会员单请求：

```json
{
  "amount": 199,
  "credits": 0,
  "paymentMethod": "wechat",
  "orderType": "membership",
  "membershipPlanId": "plan_uuid"
}
```

字段说明：

- `amount`: 支付金额，单位元
- `credits`: 充值单到账积分；会员单必须固定为 `0`
- `paymentMethod`: `alipay | wechat`
- `orderType`: `recharge | membership`，缺省为 `recharge`
- `membershipPlanId`: 仅会员单需要

会员单校验规则：

- `membershipPlanId` 必填
- 套餐必须存在且 `isActive = true`
- `amount` 必须和套餐价格一致
- `credits` 必须等于 `0`

响应示例：

```json
{
  "orderId": "order_uuid",
  "orderNo": "PAY174...",
  "amount": 199,
  "credits": 0,
  "paymentMethod": "wechat",
  "orderType": "membership",
  "businessCode": "vip_199_monthly",
  "status": "pending",
  "qrCodeUrl": "data:image/png;base64,...",
  "expiredAt": "2026-04-08T09:15:00.000Z",
  "createdAt": "2026-04-08T09:10:00.000Z",
  "membershipPlanId": "plan_uuid"
}
```

### 2.4 `GET /api/payment/order/:orderNo/status`

轮询支付状态。

响应示例：

```json
{
  "orderNo": "PAY174...",
  "status": "paid",
  "paidAt": "2026-04-08T09:12:10.000Z",
  "credits": 0,
  "orderType": "membership",
  "membershipPlanId": "plan_uuid",
  "subscriptionId": "subscription_uuid"
}
```

### 2.5 `POST /api/payment/order/:orderNo/confirm`

手动确认支付完成。

响应示例：

```json
{
  "success": true,
  "credits": 0,
  "newBalance": 41100,
  "orderType": "membership",
  "membershipPlanId": "plan_uuid",
  "subscriptionId": "subscription_uuid"
}
```

### 2.6 `GET /api/payment/orders?page=1&pageSize=10`

获取当前用户全部订单列表，充值单和会员单都会返回。

响应示例：

```json
{
  "orders": [
    {
      "orderId": "order_uuid",
      "orderNo": "PAY174...",
      "amount": 199,
      "credits": 0,
      "paymentMethod": "wechat",
      "orderType": "membership",
      "businessCode": "vip_199_monthly",
      "membershipPlanId": "plan_uuid",
      "subscriptionId": "subscription_uuid",
      "status": "paid",
      "paidAt": "2026-04-08T09:12:10.000Z",
      "createdAt": "2026-04-08T09:10:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

---

## 3. 会员接口

### 3.1 `GET /api/membership/plans`

返回会员展示页数据。这个接口是面向前端展示的聚合结果。

响应示例：

```json
{
  "hero": {
    "title": "从免费体验到专业创作，找到最适合你的方案",
    "subtitle": "免费用户可体验基础生图与视频能力，升级 VIP 后获得更多积分和高级权益"
  },
  "plans": [
    {
      "code": "vip_199_monthly",
      "name": "VIP 199 月卡",
      "billingCycle": "monthly",
      "price": 199,
      "monthlyQuotaCredits": 20000,
      "signupBonusCredits": 2000,
      "totalMonthlyCredits": 22000,
      "dailyGiftCredits": 100,
      "metadata": {
        "planCode": "vip_199",
        "pauseGiftDecay": true
      },
      "ctaText": "升级 VIP 199 月卡",
      "isRecommended": false
    }
  ],
  "comparisonTable": [],
  "creditRules": [],
  "footnotes": []
}
```

### 3.2 `GET /api/membership/me`

返回当前用户会员态聚合视图。

当前实现说明：

- `balances` 基于现有 `CreditLot` 体系动态聚合
- `subscriptionCredits`：`membership_bound` / `sourceType=subscription`
- `giftCredits`：`sourceType=gift`
- `fixedCredits`：其他可用 lot 归并
- `quotas` 目前还未落完整 schema，先返回 `null`

响应示例：

```json
{
  "planCode": "vip_199_monthly",
  "membershipStatus": "active",
  "currentPeriodStartAt": "2026-04-08T09:12:10.000Z",
  "currentPeriodEndAt": "2026-05-08T09:12:10.000Z",
  "benefits": {
    "pauseGiftDecay": true
  },
  "balances": {
    "subscriptionCredits": 18300,
    "giftCredits": 800,
    "fixedCredits": 22000,
    "totalCredits": 41100
  },
  "quotas": {
    "inviteLimit": null,
    "imageDailyLimit": null,
    "videoDailyLimit": null
  },
  "current": {
    "subscription": {
      "id": "subscription_uuid",
      "status": "active",
      "periodType": "monthly",
      "currentPeriodStartAt": "2026-04-08T09:12:10.000Z",
      "currentPeriodEndAt": "2026-05-08T09:12:10.000Z",
      "activatedAt": "2026-04-08T09:12:10.000Z",
      "renewalCount": 0,
      "lastOrderId": "order_uuid"
    },
    "plan": {
      "id": "plan_uuid",
      "code": "vip_199_monthly",
      "name": "VIP 199 月卡",
      "billingCycle": "monthly",
      "price": 199,
      "monthlyQuotaCredits": 20000,
      "signupBonusCredits": 2000,
      "dailyGiftCredits": 100
    },
    "entitlement": {
      "currentPlanCode": "vip_199_monthly",
      "membershipStatus": "active",
      "currentPeriodStartAt": "2026-04-08T09:12:10.000Z",
      "currentPeriodEndAt": "2026-05-08T09:12:10.000Z",
      "pauseGiftDecay": true,
      "hasActiveSubscription": true
    }
  }
}
```

### 3.3 `GET /api/membership/current`

返回当前活跃订阅、套餐摘要和权益快照。

无会员时：

```json
{
  "subscription": null,
  "plan": null,
  "entitlement": {
    "currentPlanCode": "free",
    "membershipStatus": "inactive",
    "currentPeriodStartAt": null,
    "currentPeriodEndAt": null,
    "pauseGiftDecay": false,
    "hasActiveSubscription": false
  }
}
```

### 3.4 `GET /api/membership/entitlement`

返回当前权益快照。

响应示例：

```json
{
  "currentPlanCode": "vip_199_monthly",
  "membershipStatus": "active",
  "currentPeriodStartAt": "2026-04-08T09:12:10.000Z",
  "currentPeriodEndAt": "2026-05-08T09:12:10.000Z",
  "pauseGiftDecay": true,
  "hasActiveSubscription": true
}
```

### 3.5 `POST /api/membership/orders`

按 `planCode` 创建会员订单。内部复用支付模块。

请求：

```json
{
  "planCode": "vip_199_monthly",
  "paymentMethod": "alipay"
}
```

响应：

```json
{
  "orderId": "uuid",
  "orderNo": "PAY123",
  "amount": 199,
  "credits": 0,
  "paymentMethod": "alipay",
  "orderType": "membership",
  "businessCode": "vip_199_monthly",
  "status": "pending",
  "qrCodeUrl": "data:image/png;base64,...",
  "expiredAt": "2026-04-08T09:15:00.000Z",
  "createdAt": "2026-04-08T09:10:00.000Z",
  "membershipPlanId": "plan_uuid"
}
```

### 3.6 `GET /api/membership/orders?page=1&pageSize=20`

仅返回会员订单。

响应示例：

```json
{
  "items": [
    {
      "orderId": "order_uuid",
      "orderNo": "PAY123",
      "planCode": "vip_69_monthly",
      "amount": 69,
      "paymentMethod": "wechat",
      "orderType": "membership",
      "membershipPlanId": "plan_uuid",
      "subscriptionId": "subscription_uuid",
      "status": "paid",
      "paidAt": "2026-04-08T09:12:10.000Z",
      "createdAt": "2026-04-08T09:10:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

---

## 4. 当前已知缺口

- `GET /api/membership/me` 中的 `quotas` 还没有完整落到数据库字段，当前返回 `null`
- 会员权益中的 `watermarkRemoval`、`templateAccess`、`supportLevel` 等展示字段还没有完整持久化到快照
- 还没有后台套餐 CRUD 接口
- 还没有会员权益变更流水专用查询接口
- 月付会员自动续费尚未实现

