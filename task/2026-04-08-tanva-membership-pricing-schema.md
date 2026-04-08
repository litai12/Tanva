# Tanva 会员定价闭环 Schema 摘要

**日期：** 2026-04-08

本文件从实现角度汇总数据库 schema、关键枚举和接口 schema，配套主文档：

- `2026-04-08-tanva-membership-pricing-full-loop-design.md`

---

## 1. 关键枚举

### 1.1 订单类型

```ts
type PaymentOrderType = 'recharge' | 'membership';
```

### 1.2 会员周期

```ts
type MembershipBillingCycle = 'monthly' | 'yearly';
```

### 1.3 订阅状态

```ts
type MembershipStatus = 'pending_activation' | 'active' | 'expired' | 'cancelled';
```

### 1.4 积分池

```ts
type CreditBucket = 'subscription' | 'gift' | 'fixed';
```

### 1.5 流水业务类型

```ts
type CreditBusinessType =
  | 'membership_grant'
  | 'membership_daily_gift'
  | 'daily_checkin_reward'
  | 'payment_recharge'
  | 'manual_adjustment'
  | 'gift_decay'
  | 'fixed_expire'
  | 'consume'
  | 'refund';
```

---

## 2. 数据库表

### 2.1 `CreditAccount`

```prisma
model CreditAccount {
  id                         String              @id @default(uuid())
  userId                     String              @unique
  balance                    Int                 @default(0)
  subscriptionCreditsBalance Int                 @default(0)
  giftCreditsBalance         Int                 @default(0)
  fixedCreditsBalance        Int                 @default(0)
  totalEarned                Int                 @default(0)
  totalSpent                 Int                 @default(0)
  lastDailyRewardAt          DateTime?
  consecutiveDays            Int                 @default(0)
  lastCheckInDate            DateTime?
  createdAt                  DateTime            @default(now())
  updatedAt                  DateTime            @updatedAt
  user                       User                @relation(fields: [userId], references: [id])
  transactions               CreditTransaction[]
}
```

规则：

- `balance` 是冗余汇总字段
- 真实扣减以三池余额为准

### 2.2 `CreditTransaction`

```prisma
model CreditTransaction {
  id               String        @id @default(uuid())
  accountId        String
  type             String
  amount           Int
  balanceBefore    Int
  balanceAfter     Int
  description      String
  apiUsageId       String?
  metadata         Json?
  creditBucket     String?
  businessType     String?
  orderId          String?
  subscriptionId   String?
  membershipPlanId String?
  expiresAt        DateTime?
  expiredAmount    Int           @default(0)
  isExpired        Boolean       @default(false)
  createdAt        DateTime      @default(now())
  account          CreditAccount @relation(fields: [accountId], references: [id])

  @@index([accountId, createdAt])
  @@index([creditBucket, createdAt])
  @@index([businessType, createdAt])
}
```

### 2.3 `MembershipPlan`

```prisma
model MembershipPlan {
  id                         String   @id @default(uuid())
  code                       String   @unique
  name                       String
  tierLevel                  Int
  billingCycle               String
  basePlanCode               String?
  price                      Decimal  @db.Decimal(10, 2)
  originalPrice              Decimal? @db.Decimal(10, 2)
  yearReferencePrice         Decimal? @db.Decimal(10, 2)
  discountRate               Decimal? @db.Decimal(5, 2)
  monthlyQuotaCredits        Int      @default(0)
  signupBonusCredits         Int      @default(0)
  dailyGiftCredits           Int      @default(0)
  inviteLimit                Int      @default(0)
  imageDailyLimit            Int?
  videoDailyLimit            Int?
  templateAccess             String?
  supportLevel               String?
  watermarkRemoval           Boolean  @default(false)
  seedance2Enabled           Boolean  @default(false)
  pauseGiftDecay             Boolean  @default(false)
  checkInRewardMultiplier    Decimal? @db.Decimal(5, 2)
  seventhDayRewardMultiplier Decimal? @db.Decimal(5, 2)
  isActive                   Boolean  @default(true)
  isRecommended              Boolean  @default(false)
  sortOrder                  Int      @default(0)
  displayConfig              Json?
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt
}
```

### 2.4 `UserMembershipSubscription`

```prisma
model UserMembershipSubscription {
  id                   String   @id @default(uuid())
  userId               String
  membershipPlanId     String
  status               String   @default("active")
  periodType           String
  currentPeriodStartAt DateTime
  currentPeriodEndAt   DateTime
  activatedAt          DateTime?
  expiredAt            DateTime?
  cancelledAt          DateTime?
  autoRenewEnabled     Boolean  @default(false)
  renewalCount         Int      @default(0)
  lastOrderId          String?
  snapshot             Json?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([userId, status])
  @@index([currentPeriodEndAt, status])
}
```

### 2.5 `PaymentOrder`

```prisma
model PaymentOrder {
  id               String   @id @default(uuid())
  orderNo          String   @unique
  userId           String
  orderType        String   @default("recharge")
  businessCode     String?
  amount           Decimal  @db.Decimal(10, 2)
  credits          Int
  paymentMethod    String
  status           String   @default("pending")
  qrCodeUrl        String?
  tradeNo          String?
  paidAt           DateTime?
  expiredAt        DateTime
  membershipPlanId String?
  subscriptionId   String?
  planSnapshot     Json?
  metadata         Json?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([userId, createdAt])
  @@index([orderType, status])
}
```

### 2.6 `MembershipEntitlementSnapshot`

```prisma
model MembershipEntitlementSnapshot {
  userId               String   @id
  currentPlanCode      String   @default("free")
  membershipStatus     String   @default("inactive")
  currentPeriodStartAt DateTime?
  currentPeriodEndAt   DateTime?
  pauseGiftDecay       Boolean  @default(false)
  watermarkRemoval     Boolean  @default(false)
  seedance2Enabled     Boolean  @default(false)
  templateAccess       String?  @default("basic")
  supportLevel         String?
  inviteLimit          Int      @default(5)
  imageDailyLimit      Int?
  videoDailyLimit      Int?
  dailyGiftCredits     Int      @default(0)
  monthlyQuotaCredits  Int      @default(0)
  updatedAt            DateTime @updatedAt
}
```

---

## 3. 套餐初始化数据

```json
[
  {
    "code": "free",
    "name": "免费用户",
    "tierLevel": 0,
    "billingCycle": "monthly",
    "price": 0,
    "monthlyQuotaCredits": 500,
    "dailyGiftCredits": 0,
    "inviteLimit": 5,
    "imageDailyLimit": 20,
    "videoDailyLimit": 3,
    "templateAccess": "basic",
    "supportLevel": "limited_support"
  },
  {
    "code": "vip_69_monthly",
    "name": "VIP 69",
    "tierLevel": 1,
    "billingCycle": "monthly",
    "basePlanCode": "vip_69",
    "price": 69,
    "yearReferencePrice": 662.4,
    "monthlyQuotaCredits": 7000,
    "signupBonusCredits": 350,
    "dailyGiftCredits": 50,
    "inviteLimit": 20,
    "templateAccess": "full",
    "supportLevel": "admin_support",
    "watermarkRemoval": true,
    "seedance2Enabled": true,
    "pauseGiftDecay": true
  },
  {
    "code": "vip_199_monthly",
    "name": "VIP 199",
    "tierLevel": 2,
    "billingCycle": "monthly",
    "basePlanCode": "vip_199",
    "price": 199,
    "yearReferencePrice": 1910.4,
    "monthlyQuotaCredits": 20000,
    "signupBonusCredits": 2000,
    "dailyGiftCredits": 100,
    "inviteLimit": 40,
    "templateAccess": "full",
    "supportLevel": "admin_support",
    "watermarkRemoval": true,
    "seedance2Enabled": true,
    "pauseGiftDecay": true
  },
  {
    "code": "vip_599_monthly",
    "name": "VIP 599",
    "tierLevel": 3,
    "billingCycle": "monthly",
    "basePlanCode": "vip_599",
    "price": 599,
    "yearReferencePrice": 5750.4,
    "monthlyQuotaCredits": 60000,
    "signupBonusCredits": 9000,
    "dailyGiftCredits": 200,
    "inviteLimit": 100,
    "templateAccess": "full",
    "supportLevel": "ceo_support",
    "watermarkRemoval": true,
    "seedance2Enabled": true,
    "pauseGiftDecay": true
  }
]
```

---

## 4. 接口 Schema

### 4.1 `GET /membership/plans`

```json
{
  "hero": {
    "title": "从免费体验到专业创作，找到最适合你的方案",
    "subtitle": "免费用户可体验基础生图与视频能力，升级 VIP 后获得更多积分和高级权益"
  },
  "plans": [
    {
      "code": "vip_69_monthly",
      "name": "VIP 69",
      "billingCycle": "monthly",
      "price": 69,
      "yearReferencePrice": 662.4,
      "monthlyQuotaCredits": 7000,
      "signupBonusCredits": 350,
      "totalMonthlyCredits": 7350,
      "dailyGiftCredits": 50,
      "inviteLimit": 20,
      "supportLevel": "admin_support",
      "benefits": [
        "去水印",
        "Seedance 2",
        "模板库全部开放"
      ],
      "ctaText": "升级 VIP 69",
      "isRecommended": true
    }
  ],
  "comparisonTable": [],
  "creditRules": [],
  "footnotes": []
}
```

### 4.2 `GET /membership/me`

```json
{
  "planCode": "vip_199_monthly",
  "membershipStatus": "active",
  "currentPeriodStartAt": "<DATE>",
  "currentPeriodEndAt": "<DATE>",
  "benefits": {
    "watermarkRemoval": true,
    "seedance2Enabled": true,
    "templateAccess": "full",
    "supportLevel": "admin_support"
  },
  "balances": {
    "subscriptionCredits": 18300,
    "giftCredits": 800,
    "fixedCredits": 22000,
    "totalCredits": 41100
  },
  "quotas": {
    "inviteLimit": 40,
    "imageDailyLimit": 200,
    "videoDailyLimit": 30
  }
}
```

### 4.3 `POST /membership/orders`

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
  "orderType": "membership",
  "planCode": "vip_199_monthly",
  "amount": 199,
  "paymentMethod": "alipay",
  "status": "pending",
  "qrCodeUrl": "data:image/png;base64,...",
  "expiredAt": "<DATE>"
}
```

### 4.4 `GET /membership/orders`

```json
{
  "items": [
    {
      "orderNo": "PAY123",
      "planCode": "vip_69_monthly",
      "amount": 69,
      "paymentMethod": "wechat",
      "status": "paid",
      "paidAt": "<DATE>"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

---

## 5. 关键幂等键

### 5.1 支付成功处理

```ts
idempotencyKey = `payment_success:${orderId}`
```

### 5.2 会员月卡发放

```ts
idempotencyKey = `membership_grant:${subscriptionId}:${periodStart}`
```

### 5.3 每日赠送发放

```ts
idempotencyKey = `membership_daily_gift:${userId}:${date}`
```

### 5.4 赠送积分衰减

```ts
idempotencyKey = `gift_decay:${userId}:${date}`
```

---

## 6. 数据迁移规则

```ts
subscriptionCreditsBalance = 0
giftCreditsBalance = 0
fixedCreditsBalance = oldBalance
balance = oldBalance
```

原因：

- 无法可信回溯历史来源
- 迁入固定积分不会被误衰减

---

## 7. 必做校验

- `MembershipPlan.code` 全局唯一
- `price >= 0`
- 年费套餐必须带 `basePlanCode`
- `currentPeriodEndAt > currentPeriodStartAt`
- `giftCreditsBalance >= 0`
- `fixedCreditsBalance >= 0`
- `subscriptionCreditsBalance >= 0`
- `balance = subscription + gift + fixed`

