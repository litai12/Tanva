# Tanva 多形态积分 V2 技术方案

**日期：** 2026-04-08

**目的：** 在现有积分系统上补齐“多形态积分 + 时长可调 + 可配置扣减优先级”的基础设施，为后续会员月卡、活动限时积分、永久充值积分提供统一模型。

---

## 1. 本轮目标

本轮只做基础层，不直接重写所有现有扣费逻辑。

### 1.1 要落地的能力

- 增加积分批次模型 `CreditLot`
- 增加积分扣减策略模型 `CreditConsumePolicy`
- 明确积分生命周期状态机
- 实现 lot 筛选与排序引擎
- 明确扣减审计字段与策略快照

### 1.2 本轮不做

- 不直接把现有 `preDeductCredits` 全量切到 lot 扣减
- 不实现完整会员订阅模块
- 不改前端会员展示页
- 不实现活动后台完整 UI

---

## 2. 真值模型

### 2.1 账户层

`CreditAccount` 继续保留，用于快速查询总余额与聚合统计。

职责：

- 汇总余额缓存
- 历史总收入 / 总支出
- 与用户一对一

### 2.2 批次层

`CreditLot` 作为真值来源，表示“一批具有同一来源和生命周期规则的积分”。

典型示例：

- 用户充值 10000 永久积分 -> 1 个 `CreditLot`
- 活动赠送 300 积分，7 天有效 -> 1 个 `CreditLot`
- VIP 199 月卡发放 22000 积分，跟会员周期到期 -> 1 个 `CreditLot`

### 2.3 流水层

`CreditTransaction` 保留审计职责：

- 发放
- 消费
- 退款
- 过期
- 撤销

每次流水必须能追溯到：

- 哪个 `lot`
- 用了哪个扣减策略
- 策略版本号

---

## 3. 积分形态

### 3.1 永久积分

- `validityType = permanent`
- `expiresAt = null`

适用：

- 充值购买
- 永久补偿

### 3.2 限时积分

- `validityType = fixed_window`
- `expiresAt = grantedAt + duration`

适用：

- 签到奖励
- 活动积分
- 运营补贴

### 3.3 跟会员到期清空

- `validityType = membership_bound`
- `expiresAt = subscription.currentPeriodEndAt`
- 可选绑定 `subscriptionId`

适用：

- 月卡积分
- 会员专属赠送积分

---

## 4. 积分生命周期

### 4.1 状态

- `pending`
- `active`
- `exhausted`
- `expired`
- `revoked`

### 4.2 状态流转

- 发放成功：`pending -> active`
- 全部消费完：`active -> exhausted`
- 到达有效期：`active -> expired`
- 后台回收/退款：`active|pending -> revoked`

### 4.3 到期处理

到期必须显式批处理，不能只在读取时临时过滤。

处理步骤：

1. 找到 `status=active` 且 `expiresAt <= now`
2. 生成过期流水
3. 将 `remainingAmount` 归零
4. lot 标记为 `expired`
5. 同步更新 `CreditAccount.balance`

---

## 5. 扣减优先级模型

### 5.1 原则

优先级需要可配置，但不能完全自由化。

推荐只做“策略级配置”，不做“逐条 lot 手工排序”。

### 5.2 推荐默认规则

先筛选可用 lot：

- `status = active`
- `remainingAmount > 0`
- `activeAt <= now`
- `expiresAt is null or expiresAt > now`

再排序：

1. `scopeSpecificity DESC`
2. `validityPriority ASC`
3. `expiresAt ASC NULLS LAST`
4. `sourcePriority ASC`
5. `grantedAt ASC`

### 5.3 默认优先级

生命周期优先级：

- `membership_bound = 10`
- `fixed_window = 20`
- `permanent = 30`

这意味着默认策略下：

- 会员绑定积分优先于普通限时积分
- 同一生命周期类型内再按最早过期优先
- 永久积分默认最后扣

来源优先级：

- `promo = 10`
- `gift = 20`
- `manual = 25`
- `recharge = 30`

### 5.4 审计要求

每次扣减必须记录：

- `consumePolicyCode`
- `consumePolicyVersion`
- `lotId`
- 每个 lot 的扣减量

---

## 6. V2 数据模型

### 6.1 `CreditLot`

```prisma
model CreditLot {
  id              String   @id @default(uuid())
  accountId       String
  sourceType      String   // subscription, recharge, gift, promo, manual
  validityType    String   // permanent, fixed_window, membership_bound
  scopeType       String?  // global, service_type, provider, model
  scopeValue      String?
  totalAmount     Int
  remainingAmount Int
  grantedAt       DateTime @default(now())
  activeAt        DateTime @default(now())
  expiresAt       DateTime?
  durationDays    Int?
  subscriptionId  String?
  orderId         String?
  status          String   @default("active")
  priority        Int      @default(0)
  metadata        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 6.2 `CreditConsumePolicy`

```prisma
model CreditConsumePolicy {
  id               String   @id @default(uuid())
  code             String   @unique
  scopeType        String   @default("global")
  scopeValue       String?
  isActive         Boolean  @default(true)
  version          Int      @default(1)
  sorts            Json
  validityPriority Json
  sourcePriority   Json
  description      String?
  metadata         Json?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

---

## 7. 本轮编码边界

### Phase 1

- Prisma schema 新增 `CreditLot`
- Prisma schema 新增 `CreditConsumePolicy`
- 新增 TypeScript 策略引擎
- 新增基础测试脚本

### Phase 2

- lot 发放与过期任务接入
- 扣费链路从 `balance` 切到 `lot`
- 消费流水记录 lot 扣减详情

### Phase 3

- 会员月卡与订阅联动
- 后台策略配置界面
- 对账与补偿工具

---

## 8. 本轮推荐实现

本轮建议先把系统升级到“可承载多形态积分”的状态，而不是立即切换生产扣费真值。

也就是：

- 先落模型
- 先落排序算法
- 先落测试
- 暂不改动所有线上消费路径

这能保证：

- 架构方向正确
- 编码风险可控
- 后续逐步切换 lot 扣减时不用推倒重来
