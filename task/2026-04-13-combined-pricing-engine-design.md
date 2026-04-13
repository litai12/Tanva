# Tanva 组合定价引擎设计稿

## 1. 背景

Tanva 现有定价体系已经存在以下问题：

- 不同模型的价格维度不统一
- 现有主路径仍以 `creditsPerCall` 为核心，无法表达复杂规格
- 前端展示、报价、扣费尚未完全同源
- 运营无法安全地调整复杂组合价格

`/Users/libiqiang/business/Tanva/task/视频模型官方价格表 (1).xlsx` 表明，视频模型价格已经不是单一的“按次收费”，而是典型的“组合规格定价”问题。

因此，目标不是统一成一种价格公式，而是统一成一套：

- 条件组合匹配框架
- 价格求值框架
- 价格展示与积分换算框架

## 2. 设计目标

### 2.1 必须满足

- 支持 `n` 维条件组合定价
- 支持不同模型混用不同 evaluator
- 前端展示、报价接口、实际扣费共用同一套结果
- 运营可在后台调整规则，不需要改代码
- 历史扣费可追溯，可回滚

### 2.2 非目标

- 第一阶段不追求任意脚本表达式
- 第一阶段不追求复杂动态优惠叠加
- 第一阶段不改造全部 AI 能力，只优先覆盖视频模型

## 3. 总体架构

建议拆成五层：

1. `Model Catalog`
2. `Vendor Route Catalog`
3. `Pricing Context`
4. `Pricing Rule Engine`
5. `Quote / Charge / Display`

职责如下：

- `Model Catalog` 负责定义模型能力边界
- `Vendor Route Catalog` 负责定义路由与供应商信息
- `Pricing Context` 负责定义一次报价的全部输入维度
- `Pricing Rule Engine` 负责命中规则并求值
- `Quote / Charge / Display` 负责将同一结果提供给前端、订单和扣费

## 4. 核心概念

### 4.1 Pricing Context

一次报价的完整上下文对象。

```ts
type PricingContext = {
  modelKey: string;
  vendorKey?: string;
  taskType?: "video" | "image" | "audio" | "other";
  generationMode?: string;
  inputType?: string;
  frameType?: string;
  resolution?: string;
  durationSec?: number;
  hasAudio?: boolean;
  qualityMode?: string;
  controlMode?: string;
  aspectRatio?: string;
  userTier?: string;
  region?: string;
  channel?: string;
};
```

说明：

- `PricingContext` 不是只给视频用，未来可以扩展到其他能力
- 某些字段可以为空，但某条规则命中时必须足够判断
- 所有价格计算必须只依赖 `PricingContext`

### 4.2 Pricing Rule

规则由“命中条件”和“价格求值器”两部分组成。

```ts
type PricingRule = {
  ruleKey: string;
  label?: string;
  enabled: boolean;
  priority?: number;
  specificityScore?: number;
  fallbackLevel?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  when: MatchConditionGroup;
  evaluator: PricingEvaluator;
  metadata?: Record<string, unknown>;
};
```

### 4.3 Price Result

报价结果对象，同时给前端展示和后端扣费使用。

```ts
type QuoteResult = {
  modelKey: string;
  vendorKey?: string;
  matchedRuleKey: string;
  evaluatorType: string;
  pricingVersion: string;
  pricingContext: PricingContext;
  priceYuan: number;
  credits: number;
  calcTrace?: Record<string, unknown>;
};
```

## 5. 匹配层设计

## 5.1 设计原则

- 规则必须支持组合条件
- 匹配逻辑要可解释
- 多规则冲突时必须可控

### 5.2 条件表达结构

建议采用结构化条件，而不是任意表达式脚本。

```ts
type MatchConditionGroup = {
  all?: MatchCondition[];
  any?: MatchCondition[];
};

type MatchCondition =
  | { field: string; op: "eq"; value: string | number | boolean }
  | { field: string; op: "in"; value: Array<string | number | boolean> }
  | { field: string; op: "gte"; value: number }
  | { field: string; op: "lte"; value: number }
  | { field: string; op: "gt"; value: number }
  | { field: string; op: "lt"; value: number }
  | { field: string; op: "exists"; value: boolean };
```

### 5.3 支持的匹配能力

- 单值精确匹配
- 枚举匹配
- 数值区间匹配
- AND 组合
- OR 组合
- 字段存在/不存在
- 缺省字段兼容

### 5.4 规则命中优先级

规则命中顺序建议如下：

1. 过滤 `enabled = true`
2. 过滤有效期内规则
3. 找出所有命中 `when` 的规则
4. 按 `specificityScore` 从高到低排序
5. 再按 `priority` 从高到低排序
6. 若仍冲突，发布阶段阻止上线

### 5.5 Specificity Score

用于体现“规则具体度”。

计算建议：

- 条件字段越多，分越高
- 精确匹配比分组匹配更高
- 带 `durationSec=10` 比 `durationSec>=5` 更具体

系统可自动生成，也允许人工覆写。

## 6. 求值层设计

## 6.1 设计原则

- 同一模型允许混用不同 evaluator
- evaluator 必须受限、可解释、可测试
- 优先支持结构化 evaluator，不开放任意脚本

### 6.2 Evaluator 类型

#### 6.2.1 fixed

固定价。

```ts
type FixedEvaluator = {
  type: "fixed";
  priceYuan: number;
};
```

适用：

- 固定规格价
- 小规模特殊规则

#### 6.2.2 lookup_matrix

离散规格查价。

```ts
type LookupMatrixEvaluator = {
  type: "lookup_matrix";
  axes: string[];
  matrix: Record<string, unknown>;
};
```

适用：

- `resolution × durationSec`
- `hasAudio × qualityMode × durationSec`
- 任意离散多维组合表

#### 6.2.3 linear

线性定价。

```ts
type LinearEvaluator = {
  type: "linear";
  unitField: string;
  unitPriceYuan: number;
};
```

适用：

- `Q3`
- `Q3 Turbo`

#### 6.2.4 base_plus_linear

起步价 + 续量线性。

```ts
type BasePlusLinearEvaluator = {
  type: "base_plus_linear";
  basePriceYuan: number;
  includedUnits: number;
  unitField: string;
  extraUnitPriceYuan: number;
};
```

适用：

- 首秒和续秒差异明显的模型

#### 6.2.5 piecewise

分段价格。

```ts
type PiecewiseEvaluator = {
  type: "piecewise";
  unitField: string;
  segments: Array<{
    gt?: number;
    gte?: number;
    lt?: number;
    lte?: number;
    unitPriceYuan: number;
  }>;
};
```

适用：

- 后续某些模型分段计价

### 6.3 统一 Evaluator 联合类型

```ts
type PricingEvaluator =
  | FixedEvaluator
  | LookupMatrixEvaluator
  | LinearEvaluator
  | BasePlusLinearEvaluator
  | PiecewiseEvaluator;
```

## 7. 价格输出规则

### 7.1 统一价格口径

系统内部统一字段：

- `costYuan`: 上游成本价
- `priceYuan`: 对客售价
- `credits`: 实际积分消耗

### 7.2 当前积分换算

当前先固定为：

```ts
credits = ceil(priceYuan * 100)
```

说明：

- 前端不自行计算
- 扣费不自行重复推导
- 报价服务直接产出 `credits`

### 7.3 统一输出

```ts
type FinalPriceBundle = {
  costYuan?: number;
  priceYuan: number;
  credits: number;
};
```

## 8. 价格快照设计

每次提交、下单、扣费都应固化价格快照：

```ts
type PricingSnapshot = {
  pricingVersion: string;
  matchedRuleKey: string;
  evaluatorType: string;
  pricingContext: PricingContext;
  priceYuan: number;
  credits: number;
  calcTrace?: Record<string, unknown>;
};
```

用途：

- 订单审计
- 退款回滚
- 投诉排查
- 版本追溯

## 9. 展示层设计

### 9.1 Pricing Catalog

用于价格一览页、模型卡片、帮助中心。

```ts
type PricingCatalogItem = {
  modelKey: string;
  modelName: string;
  generationMode?: string;
  resolution?: string;
  durationSec?: number;
  hasAudio?: boolean;
  qualityMode?: string;
  priceYuan: number;
  credits: number;
  specLabel: string;
  summaryLabel: string;
};
```

### 9.2 Quote Result

用于操作前报价与实际扣费。

- 按具体组合返回
- 必须与最终扣费完全同源

## 10. 运营改价方案

### 10.1 运营可改

- 规则条件
- evaluator 参数
- 生效时间
- 状态
- 展示规格

### 10.2 运营不可直接改

- 底层 evaluator 实现
- 路由协议
- 扣费事务逻辑
- 任意脚本表达式

### 10.3 发布流程

建议流程：

1. 编辑草稿
2. 系统校验
3. 试算预览
4. 发布版本
5. 写入版本记录
6. 支持回滚

## 11. 校验与风控

发布前必须校验：

- 是否有冲突规则
- 是否存在无法命中的 matrix 轴
- 是否存在 evaluator 缺少必需字段
- 是否存在价格小于 0
- 是否存在价格突变幅度超阈值
- 是否存在低于成本价

## 12. 与当前代码的关系

当前仓库已有基础能力：

- `backend/src/ai/services/model-pricing-resolver.ts`
- `backend/src/ai/services/model-routing.service.ts`
- `backend/src/credits/credits.service.ts`

但当前主要能力还是：

- 简单 `when -> fixed price` 命中
- `creditsPerCall` 仍是主口径

要升级到本方案，需要把现有 resolver 从“静态价格选择器”升级为“组合规则求值器”。

## 13. 实施建议

第一阶段：

- 仅对视频模型启用新 pricing engine
- 优先支持 `lookup_matrix` 和 `linear`
- 保留 `creditsPerCall` 兼容旧链路

第二阶段：

- 补齐 `base_plus_linear`
- 补齐版本发布和快照
- 补齐前端 catalog / quote 展示

第三阶段：

- 支持批量运营调价
- 支持成本利润分析
- 扩展到图像和其他能力

## 14. 最终结论

统一模型管理的关键不在于把所有价格统一成一种公式，而在于统一成：

- 一套通用的 `PricingContext`
- 一套可解释的 `Rule Matching`
- 一套多态的 `Evaluator`
- 一套统一的 `Quote Result`

最终积分消耗只是最后一步：

```ts
priceYuan = evaluate(rule, context)
credits = ceil(priceYuan * 100)
```

真正复杂、也最需要方案化的，是 `evaluate(rule, context)` 这一步。
