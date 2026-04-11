# Tanva 会员定价完整闭环技术方案

**日期：** 2026-04-08

**目标：** 基于现有 Tanva 后端积分与支付系统，设计一套覆盖会员套餐配置、展示、下单支付、开通/续费、积分分池、每日赠送与衰减、免费额度控制、后台配置、历史迁移与对账的完整闭环方案。

---

## 1. 现状与设计目标

### 1.1 当前系统现状

当前后端已经具备以下基础能力：

- `CreditAccount` + `CreditTransaction`：单余额积分账户与流水
- `PaymentOrder`：积分充值订单
- `CreditsService`：积分扣减、签到、免费用户额度校验
- `PaymentService`：支付宝/微信下单、回调、支付成功后发积分
- `CreditPackage` / `CreditPricing`：基础充值套餐与服务计费配置

当前缺口：

- 没有“会员套餐”独立实体，VIP 规则无法配置化管理
- 没有“会员订阅关系”与续费周期模型
- 没有“三类积分分池”账户结构，当前只有单一 `balance`
- 没有“会员展示页/支付页”统一配置接口
- `PaymentOrder` 仅承载“积分充值”，无法表达“会员购买/续费”
- 免费用户与会员用户配额规则分散在代码中，无法用配置统一驱动

### 1.2 本次方案目标

本方案要实现：

- 把“展示文案”与“技术口径”统一到一个可配置模型
- 会员购买走现有支付链路扩展，而不是重做支付系统
- 三类积分分池可独立计入、扣减、衰减、刷新、过期
- 支持免费 / VIP69 / VIP199 / VIP599 / 年费展示
- 支持首购、续费、到期、断续费、会员恢复、对账
- 支持前端官网、会员页、支付页、弹窗共用同一份套餐数据
- 支持后台可配置价格、权益、展示文案、是否上架

---

## 2. 需求口径冲突与推荐统一口径

两份需求文档存在口径冲突，若不先统一，后续实现会反复返工。

### 2.1 冲突点

| 项目 | 文档 A：会员定价展示文案 | 文档 B：产品定价策略 | 推荐口径 |
| --- | --- | --- | --- |
| 免费签到积分 | 60/日 | 50/日 | 以策略文档为准，系统口径用 50/日，展示文案同步修正 |
| 赠送积分每日衰减 | 60/日 | 50/日 | 以策略文档为准，系统口径用 50/日 |
| 599 VIP 每日赠送 | 200/日 | 200/日（表格）；另有 150/日 文案 | 统一为 200/日 |
| 会员支持等级 | 管理员支持 / CEO 直接支持 | 官方支持 / 官方24小时支持 / CEO 支持 | 技术上配置化，不写死；默认沿用展示文案版本 |
| 连续签到 7 天 3 倍 | 文案未强调 | 有提及 | 作为可选运营规则，放入 schema，首期默认关闭 |

### 2.2 推荐最终业务口径

建议将“策略文档”作为系统真值源，展示文案服从系统配置：

- 免费签到积分：`50/日`
- 赠送积分衰减：`50/日`
- 免费用户月卡积分：`500 / 30天`
- 69 VIP：月卡 `7000`，档位赠送 `350`，合计 `7350`，每日赠送 `50`
- 199 VIP：月卡 `20000`，档位赠送 `2000`，合计 `22000`，每日赠送 `100`
- 599 VIP：月卡 `60000`，档位赠送 `9000`，合计 `69000`，每日赠送 `200`
- 年费统一：连续包月基础上 `8 折`
- 积分扣减顺序：`月卡积分 -> 赠送积分 -> 固定积分`

---

## 3. 方案选型

### 方案 A：在现有积分与支付系统上增量扩展

做法：

- 扩展 `PaymentOrder` 支持会员订单
- 新增 `MembershipPlan`、`UserMembershipSubscription`
- 扩展 `CreditAccount` 为三池余额
- 用定时任务处理赠送积分衰减、月卡刷新、会员过期

优点：

- 复用现有支付宝/微信支付链路
- 与当前 `CreditsService`、`PaymentService` 改动边界清晰
- 最符合 Tanva 当前代码结构

缺点：

- 需要做一次积分模型升级与历史兼容

### 方案 B：单独建设 Membership Domain，与积分系统弱耦合

做法：

- 新建会员中心模块，支付成功后通过事件给积分系统发放权益

优点：

- 边界更清晰，长期更易扩展

缺点：

- 对当前项目偏重，落地成本更高
- 需要额外事件总线或补偿机制

### 方案 C：只做展示和配置，不改底层账户模型

做法：

- 会员只是一个标签，积分仍记入单余额

优点：

- 上线快

缺点：

- 无法正确支持“月卡刷新 / 赠送衰减 / 固定积分 2 年有效 / 优先扣减顺序”
- 后续一定重做

### 推荐

推荐采用 **方案 A**。原因很直接：这是当前代码成本最低、可正确支撑完整闭环、并且能控制迁移风险的方案。

---

## 4. 目标架构

### 4.1 核心模块

新增或扩展以下模块：

- `membership`：会员套餐、订阅、权益聚合、展示接口
- `payment`：支持会员订单与充值订单两类业务
- `credits`：三池积分账户、扣减优先级、衰减与刷新
- `admin`：后台套餐配置、会员订单查询、权益重发、数据修复
- `scheduler`：会员到期、月卡刷新、赠送衰减、固定积分过期

### 4.2 数据流

#### 会员购买

1. 前端获取套餐展示配置
2. 用户选择月付或年付套餐
3. 后端创建 `PaymentOrder(orderType=membership)`
4. 第三方支付成功回调
5. `PaymentService` 调用 `MembershipService.activateSubscription`
6. `MembershipService`：
   - 创建或更新订阅关系
   - 发放月卡积分
   - 发放档位赠送积分
   - 更新用户会员态快照
7. 前端刷新会员信息和积分余额

#### 续费

1. 用户购买同档位续费
2. 若当前仍在有效期内，则 `currentPeriodEndAt` 顺延 30 天或 365 天
3. 续费成功时立即刷新当期月卡积分到档位满额
4. 每日赠送继续按会员态发放

#### 到期/断续费

1. 定时任务扫描到期订阅
2. 标记订阅为 `expired`
3. 用户失去 VIP 权益
4. 月卡积分池在到期后刷新为 `0`
5. 赠送积分池恢复“每日衰减 50”

---

## 5. 领域模型

### 5.1 会员套餐

会员套餐是“可销售商品”，面向展示、下单、结算。

核心字段：

- 套餐编码：`free`, `vip_69`, `vip_199`, `vip_599`
- 周期类型：`monthly`, `yearly`
- 基础价格
- 展示原价/参考年费
- 月卡积分额度
- 档位赠送积分
- 每日赠送积分
- 邀请上限
- 权益开关：去水印、模板库、Seedance 2、支持等级
- 展示文案与排序

### 5.2 用户订阅

订阅是“用户当前拥有的会员关系”，面向状态判定和续费。

核心字段：

- 当前套餐编码
- 订阅状态：`active`, `expired`, `cancelled`, `pending_activation`
- 当前周期开始/结束时间
- 是否自动续费
- 最近一次成功支付订单
- 续费次数
- 到期后的权益处理状态

### 5.3 三池积分账户

将当前单余额升级为三池：

- `subscriptionCreditsBalance`：月卡积分，按会员周期刷新
- `giftCreditsBalance`：赠送可衰减积分，VIP 可暂停日衰减
- `fixedCreditsBalance`：固定积分，2 年有效

总余额为派生值：

`totalBalance = subscriptionCreditsBalance + giftCreditsBalance + fixedCreditsBalance`

### 5.4 积分流水

流水必须显式记录积分池变化来源。

新增维度：

- `creditBucket`: `subscription`, `gift`, `fixed`
- `businessType`: `membership_grant`, `daily_reward`, `payment_recharge`, `manual_adjustment`, `decay`, `expire`, `consume`, `refund`
- `membershipPlanCode`
- `subscriptionId`
- `orderType`

---

## 6. 推荐数据库 Schema

以下 schema 以 Prisma/PostgreSQL 为目标。

### 6.1 扩展 `CreditAccount`

```prisma
model CreditAccount {
  id                         String              @id @default(uuid())
  userId                     String              @unique
  balance                    Int                 @default(0) // 兼容旧逻辑，作为汇总冗余值
  subscriptionCreditsBalance Int                 @default(0)
  giftCreditsBalance         Int                 @default(0)
  fixedCreditsBalance        Int                 @default(0)
  totalEarned                Int                 @default(0)
  totalSpent                 Int                 @default(0)
  createdAt                  DateTime            @default(now())
  updatedAt                  DateTime            @updatedAt
  lastDailyRewardAt          DateTime?
  consecutiveDays            Int                 @default(0)
  lastCheckInDate            DateTime?
  user                       User                @relation(fields: [userId], references: [id])
  transactions               CreditTransaction[]
  anomalyRecords             CreditAnomalyRecord[]
}
```

### 6.2 扩展 `CreditTransaction`

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
  creditBucket     String?       // subscription, gift, fixed
  businessType     String?       // membership_grant, recharge, decay, expire, consume...
  orderId          String?
  subscriptionId   String?
  membershipPlanId String?
  createdAt        DateTime      @default(now())
  expiresAt        DateTime?
  expiredAmount    Int           @default(0)
  isExpired        Boolean       @default(false)
  account          CreditAccount @relation(fields: [accountId], references: [id])

  @@index([accountId, createdAt])
  @@index([creditBucket, createdAt])
  @@index([businessType, createdAt])
}
```

### 6.3 新增 `MembershipPlan`

```prisma
model MembershipPlan {
  id                        String   @id @default(uuid())
  code                      String   @unique // free, vip_69, vip_199, vip_599
  name                      String
  tierLevel                 Int
  billingCycle              String   // monthly, yearly
  basePlanCode              String?  // yearly -> vip_69 / vip_199 / vip_599
  price                     Decimal  @db.Decimal(10, 2)
  originalPrice             Decimal? @db.Decimal(10, 2)
  yearReferencePrice        Decimal? @db.Decimal(10, 2)
  discountRate              Decimal? @db.Decimal(5, 2)
  monthlyQuotaCredits       Int      @default(0)
  signupBonusCredits        Int      @default(0)
  dailyGiftCredits          Int      @default(0)
  inviteLimit               Int      @default(0)
  imageDailyLimit           Int?
  videoDailyLimit           Int?
  templateAccess            String?  // basic, full
  supportLevel              String?
  watermarkRemoval          Boolean  @default(false)
  seedance2Enabled          Boolean  @default(false)
  pauseGiftDecay            Boolean  @default(false)
  checkInRewardMultiplier   Decimal? @db.Decimal(5, 2)
  seventhDayRewardMultiplier Decimal? @db.Decimal(5, 2)
  isActive                  Boolean  @default(true)
  isRecommended             Boolean  @default(false)
  sortOrder                 Int      @default(0)
  displayConfig             Json?
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt
}
```

### 6.4 新增 `UserMembershipSubscription`

```prisma
model UserMembershipSubscription {
  id                    String   @id @default(uuid())
  userId                String
  membershipPlanId      String
  status                String   @default("active") // pending_activation, active, expired, cancelled
  periodType            String   // monthly, yearly
  currentPeriodStartAt  DateTime
  currentPeriodEndAt    DateTime
  activatedAt           DateTime?
  expiredAt             DateTime?
  cancelledAt           DateTime?
  autoRenewEnabled      Boolean  @default(false)
  renewalCount          Int      @default(0)
  lastOrderId           String?
  snapshot              Json?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([userId, status])
  @@index([currentPeriodEndAt, status])
}
```

### 6.5 扩展 `PaymentOrder`

```prisma
model PaymentOrder {
  id               String   @id @default(uuid())
  orderNo          String   @unique
  userId           String
  orderType        String   @default("recharge") // recharge, membership
  businessCode     String?  // vip_69_monthly, vip_69_yearly...
  amount           Decimal  @db.Decimal(10, 2)
  credits          Int      // 充值单使用；会员单可记录固定积分奖励，没有则为0
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
  @@index([membershipPlanId, createdAt])
}
```

### 6.6 新增 `MembershipEntitlementSnapshot`

用于快速给前端返回“当前会员态”，避免每次动态聚合多表。

```prisma
model MembershipEntitlementSnapshot {
  userId                      String   @id
  currentPlanCode             String   @default("free")
  membershipStatus            String   @default("inactive")
  currentPeriodStartAt        DateTime?
  currentPeriodEndAt          DateTime?
  pauseGiftDecay              Boolean  @default(false)
  watermarkRemoval            Boolean  @default(false)
  seedance2Enabled            Boolean  @default(false)
  templateAccess              String?  @default("basic")
  supportLevel                String?
  inviteLimit                 Int      @default(5)
  imageDailyLimit             Int?
  videoDailyLimit             Int?
  dailyGiftCredits            Int      @default(0)
  monthlyQuotaCredits         Int      @default(0)
  updatedAt                   DateTime @updatedAt
}
```

---

## 7. 接口设计

### 7.1 前台接口

#### `GET /membership/plans`

用途：

- 官网套餐卡片
- 会员中心
- 支付弹窗
- 对比表

返回结构建议：

```json
{
  "hero": {
    "title": "从免费体验到专业创作，找到最适合你的方案",
    "subtitle": "免费用户可体验基础生图与视频能力，升级 VIP 后获得更多积分与高级权益"
  },
  "plans": [
    {
      "code": "vip_69_monthly",
      "basePlanCode": "vip_69",
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
      "benefits": ["去水印", "Seedance 2", "模板库全部开放"],
      "isRecommended": true,
      "ctaText": "升级 VIP 69"
    }
  ],
  "comparisonTable": [],
  "creditRules": [],
  "footnotes": []
}
```

#### `GET /membership/me`

返回当前用户会员态：

- 当前套餐
- 到期时间
- 是否处于 VIP
- 今日剩余图片/视频额度
- 三池积分余额
- 当前权益开关

#### `POST /membership/orders`

创建会员订单：

请求：

```json
{
  "planCode": "vip_199_monthly",
  "paymentMethod": "alipay"
}
```

#### `POST /membership/orders/:orderNo/confirm`

支付成功轮询确认。

#### `GET /membership/orders`

会员订单历史。

### 7.2 后台接口

- `GET /admin/membership/plans`
- `POST /admin/membership/plans`
- `PATCH /admin/membership/plans/:id`
- `POST /admin/membership/subscriptions/:id/regrant`
- `POST /admin/membership/subscriptions/:id/expire`
- `GET /admin/membership/orders`
- `GET /admin/membership/reconciliation`

---

## 8. 核心业务规则

### 8.1 积分分池规则

#### 月卡积分

- 仅会员拥有
- 与套餐档位绑定
- 周期开始时写入当期满额
- 周期结束后若未续费，刷新为 `0`
- 消耗优先级最高

#### 赠送积分

- 来源：签到、活动、会员每日赠送、后台手工赠送
- 普通用户默认每天衰减 `50`
- VIP 用户暂停衰减
- 若用户从 VIP 变为免费，则次日起恢复衰减

#### 固定积分

- 来源：充值购买
- 总时效 `2 年`
- 不参与日衰减
- 最后消耗

### 8.2 扣减顺序

每次扣费时必须按以下顺序原子扣减：

1. `subscriptionCreditsBalance`
2. `giftCreditsBalance`
3. `fixedCreditsBalance`

若任一池不足，则继续扣下一池，直到扣满或失败。

### 8.3 免费用户额度

免费用户仍保留：

- 图片 `20/日`
- 视频 `3/日`
- 邀请上限 `5`

会员用户：

- 每个档位允许配置更高额度
- 如果前端只展示“更高额度”，后端仍必须有明确数值
- 建议首期落到套餐配置中，避免写死代码

### 8.4 会员开通与续费

#### 首次开通

- 创建订阅
- 当前周期立即生效
- 发放月卡积分与档位赠送积分
- 更新权益快照

#### 同档续费

- 若仍在有效期内：结束时间顺延
- 若已过期：新周期从支付成功时开始
- 均需要刷新月卡积分为该档位满额

#### 升级档位

首期建议：

- 不做按剩余天数补差价
- 直接购买新档位并立即覆盖权益
- 原档位剩余时间失效

原因：

- 可显著降低复杂度
- 更适合第一版快速上线

### 8.5 每日赠送与签到

建议拆成两类规则：

- `checkInRewardRule`：签到奖励规则
- `membershipDailyGiftRule`：会员每日赠送规则

不要把签到奖励和会员每日赠送混为一类字段，否则后续活动规则会越来越乱。

---

## 9. 后台配置设计

建议使用 `MembershipPlan` + `SystemSetting` 双层配置：

### 9.1 `MembershipPlan`

放“强结构化字段”：

- 价格、周期、积分、限额、权益开关、排序、状态

### 9.2 `displayConfig`

放“可运营展示字段”：

- 按钮文案
- 标签文案
- 推荐标记
- 说明文案
- 对比表展示顺序
- 页面底部 FAQ

### 9.3 `SystemSetting`

放全局规则：

- `membership.annual_discount_rate = 0.8`
- `credits.gift_decay_per_day = 50`
- `credits.fixed_expire_days = 730`
- `credits.consume_order = subscription,gift,fixed`
- `membership.free_daily_image_limit = 20`
- `membership.free_daily_video_limit = 3`

---

## 10. 迁移方案

### 10.1 数据库迁移

1. 给 `CreditAccount` 加三池字段
2. 给 `CreditTransaction` 加桶与业务类型字段
3. 给 `PaymentOrder` 增加会员订单字段
4. 新建 `MembershipPlan`
5. 新建 `UserMembershipSubscription`
6. 新建 `MembershipEntitlementSnapshot`

### 10.2 数据初始化

初始化写入：

- 免费套餐
- VIP69 月付 / 年付
- VIP199 月付 / 年付
- VIP599 月付 / 年付

### 10.3 历史数据兼容

对现有用户建议采用以下迁移策略：

- 现有 `CreditAccount.balance` 统一迁入 `fixedCreditsBalance`
- `subscriptionCreditsBalance = 0`
- `giftCreditsBalance = 0`
- `balance` 保留为冗余总额

原因：

- 无法可靠回溯历史余额来源
- 迁入固定积分风险最小，不会误衰减

### 10.4 上线顺序

1. 先上线表结构与读兼容逻辑
2. 再上线写入双写逻辑
3. 初始化套餐配置
4. 灰度开放会员展示接口
5. 最后开放会员支付入口

---

## 11. 对账与补偿

必须具备以下补偿能力：

- 支付成功但订阅未激活
- 订阅激活成功但月卡积分未发放
- 月卡积分发了两次
- 到期后未回收会员权益
- 赠送积分衰减任务漏跑或重复跑

推荐设计：

- 所有会员发放动作以 `orderId + businessType + creditBucket` 做幂等键
- 后台提供“重放权益”接口
- 每日生成会员对账报表：
  - 支付成功订单数
  - 成功激活订阅数
  - 积分发放成功数
  - 异常差异订单

---

## 12. 详细开发清单

### 12.1 后端模块

- 新增 `membership.module.ts`
- 新增 `membership.controller.ts`
- 新增 `membership.service.ts`
- 新增 `membership.scheduler.service.ts`
- 扩展 `payment.controller.ts`
- 扩展 `payment.service.ts`
- 扩展 `credits.service.ts`
- 扩展 Prisma schema 与 migration

### 12.2 核心能力清单

- 套餐列表接口
- 当前会员态接口
- 会员订单创建接口
- 会员订单状态查询接口
- 支付成功激活订阅
- 月卡积分发放
- 每日赠送积分发放
- 赠送积分衰减
- 固定积分过期
- 扣减顺序重构
- 权益快照更新
- 免费/会员额度判定统一

### 12.3 后台能力

- 套餐 CRUD
- 上下架与排序
- 展示文案配置
- 订阅查询
- 权益重发
- 会员订单对账

### 12.4 测试清单

- 免费用户扣费顺序
- VIP 用户扣费顺序
- 支付回调幂等
- 会员首购
- 同档续费
- 过期后重新开通
- 赠送积分暂停衰减
- VIP 到期后恢复衰减
- 历史余额迁移正确
- 展示接口返回与后台配置一致

---

## 13. 风险点

### P0

- 需求口径不统一，导致展示与实际扣费/发放不一致
- 历史单余额迁移后若误归类到赠送积分，会被错误衰减
- 支付成功回调没有幂等，可能重复开通或重复发积分

### P1

- 升级/降级规则未明确，容易引发客服工单
- 免费/会员额度若继续散落在代码中，后续套餐调整成本高

### P2

- 展示文案若写死在前端，后续套餐营销活动修改成本高

---

## 14. 建议的实施边界

### 第一阶段

- 套餐配置
- 会员展示接口
- 会员购买与支付开通
- 三池账户
- 扣减顺序
- 月卡刷新
- 赠送积分衰减
- 当前会员态接口

### 第二阶段

- 自动续费
- 升降级补差价
- 连续签到 7 天三倍
- 更复杂营销活动
- 更细粒度权益包

---

## 15. 推荐落地结论

本项目最合理的落地方式是：

- 保留现有 `PaymentService` 作为统一支付入口
- 将会员视为 `PaymentOrder.orderType=membership` 的另一种订单
- 引入 `MembershipPlan` 与 `UserMembershipSubscription` 作为会员主模型
- 将积分账户升级为 `月卡 / 赠送 / 固定` 三池账户
- 用配置驱动展示、权益和额度，而不是把 VIP 规则散落在代码里

这样可以最小成本完成“展示、购买、激活、计费、续费、过期、对账”的完整闭环。

---

## 16. 附：建议初始化套餐数据

```json
[
  {
    "code": "vip_69_monthly",
    "name": "VIP 69",
    "billingCycle": "monthly",
    "price": 69,
    "yearReferencePrice": 662.4,
    "monthlyQuotaCredits": 7000,
    "signupBonusCredits": 350,
    "dailyGiftCredits": 50,
    "inviteLimit": 20,
    "watermarkRemoval": true,
    "seedance2Enabled": true,
    "templateAccess": "full",
    "supportLevel": "admin_support"
  },
  {
    "code": "vip_199_monthly",
    "name": "VIP 199",
    "billingCycle": "monthly",
    "price": 199,
    "yearReferencePrice": 1910.4,
    "monthlyQuotaCredits": 20000,
    "signupBonusCredits": 2000,
    "dailyGiftCredits": 100,
    "inviteLimit": 40,
    "watermarkRemoval": true,
    "seedance2Enabled": true,
    "templateAccess": "full",
    "supportLevel": "admin_support"
  },
  {
    "code": "vip_599_monthly",
    "name": "VIP 599",
    "billingCycle": "monthly",
    "price": 599,
    "yearReferencePrice": 5750.4,
    "monthlyQuotaCredits": 60000,
    "signupBonusCredits": 9000,
    "dailyGiftCredits": 200,
    "inviteLimit": 100,
    "watermarkRemoval": true,
    "seedance2Enabled": true,
    "templateAccess": "full",
    "supportLevel": "ceo_support"
  }
]
```
