# 变更提案: unified_model_pricing_superpower

## 元信息
```yaml
类型: 设计
方案类型: proposal
优先级: P0
状态: 草稿
创建: 2026-04-11
```

---

## 1. 需求

### 背景
Tanva 现在的统一模型管理已经能解决一部分“模型 -> 厂商路线 -> 默认积分”的问题，也已经补了 `vendors[].metadata.specPricing` 来支持按规格匹配积分。但这套能力仍然是“默认价之上的补丁”，没有把“规格组合定价”提升为统一模型管理的一等公民。

当前状态大致是：
- 节点层有默认 `creditsPerCall / priceYuan / serviceType`
- 模型管理层有 vendor 级 `creditsPerCall`
- vendor metadata 里又挂了 `specPricing`
- 前端管理台对视频做了二维矩阵，对图片做了规则卡片
- 后端预扣积分只统一解析 `creditsPerCall`，`priceYuan` 仍然没有走同一套规格规则

这导致几个核心问题：
- “默认价格”和“规格价格”是分层拼接，而不是统一定价模型
- 价格维度只对积分有效，对人民币价格、结算成本、毛利率等无统一承载
- 规格组合越来越多后，规则散落在 node config、vendor metadata、服务特例逻辑里
- 前端 UI 只是勉强能编，但数据结构没有表达“哪些规格维度存在、哪些组合合法、哪些维度参与定价”
- 运行时计费、前端价格预览、后台维护、账单审计没有共享同一个“价格解析器”

### 目标
- 让“规格组合定价”成为统一模型管理的核心能力，而不是 vendor metadata 的附属字段
- 一套配置同时支持：
  - 默认价
  - 厂商价
  - 规格组合价
  - 多价格类型并存，如 `credits`、`priceYuan`、`costYuan`
- 支持有限组合和高维组合两种场景：
  - 视频：`resolution x duration x aspectRatio x mode`
  - 图片：`mode x imageSize x quality x outputCount x referenceImageCount`
- 前端预览价格、后端真实扣费、账单审计都使用同一个定价解析逻辑
- 兼容当前 `creditsPerCall + metadata.specPricing` 配置，允许平滑迁移

### 非目标
- 本提案不要求一次性重构所有 AI 服务路由逻辑
- 本提案不要求立刻替换所有历史静态 pricing config
- 本提案不要求第一期就支持“公式计价 / 表达式 DSL / 分段梯度价”

### 验收标准
- [ ] 同一模型同一 vendor 可以同时配置默认价和组合规格价
- [ ] 规格价不只支持积分，也支持人民币价格等多价格字段
- [ ] 前端能根据模型声明的规格维度渲染合适的编辑 UI，而不是把 UI 写死在节点类型里
- [ ] 后端预扣费和前端价格展示都能解析同一条命中的规则
- [ ] 每次扣费都能记录“命中了哪条规则、使用了哪些规格上下文、最终采用了什么价格快照”

---

## 2. 问题定义

### 2.1 当前能力为什么不够

#### 问题一: `specPricing` 是附属字段，不是领域模型
现在的规格价放在 `models[].vendors[].metadata.specPricing` 下，本质上还是一个 metadata escape hatch。只要一个能力长期依赖 metadata，就说明领域边界没有被建模清楚。

直接后果：
- 没有稳定类型
- 没有版本化
- 没有统一校验
- 没有统一解释“价格字段有哪些”
- 没有办法系统性承载更复杂的规则

#### 问题二: 价格维度只覆盖 `creditsPerCall`
目前规则命中后只返回积分，不覆盖：
- `priceYuan`
- `costYuan`
- `settlementPrice`
- `listPrice / salePrice`
- 渠道补贴、会员折扣前原价

这会导致“后台看到的人民币单价”和“真实扣积分”的来源分裂。

#### 问题三: UI 在替数据结构兜底
现在视频规格编辑是二维矩阵，图片规格编辑是规则卡片。这个方向没错，但它们现在是“UI 形式”，不是“领域结构”的视图投影。

问题在于：
- 一旦组合维度增加，矩阵就爆炸
- 一旦规则条件不是 exact match，UI 无法表达
- 不同模型的规格维度差异大，前端只能堆分支

#### 问题四: 运行时上下文没有正式建模
现在后端计费主要从 `requestParams` 生读字段匹配规则，例如：
- `resolution`
- `duration`
- `aspectRatio`
- `mode`
- `sound`

但没有一个正式的 `pricingContext` 契约来定义：
- 哪些字段是参与定价的
- 字段名是否统一
- 字段来源是用户输入、节点推导还是路由选择
- 哪些字段应该被持久化到账单审计里

#### 问题五: 默认价、线路价、规格价优先级不够清晰
当前大致是：
1. 命中 `specPricing`
2. 回退 vendor `creditsPerCall`
3. 回退 node config / static pricing

但这只是积分维度，且没有形成一个统一、可审计、可扩展的优先级体系。

---

## 3. Superpower 方案

### 3.1 核心设计原则

1. 定价不是 metadata，定价是正式模型
2. UI 是定价模型的视图，不是定价模型本身
3. 前后端共享同一种价格解析语义
4. 规格维度先建模，再谈矩阵/卡片/JSON
5. 兼容旧配置，但新能力只往新结构上长

### 3.2 新的一等公民: `pricing`

建议把 vendor 级价格结构从：

```json
{
  "creditsPerCall": 600,
  "metadata": {
    "specPricing": [
      {
        "match": { "resolution": "720P", "duration": 10 },
        "creditsPerCall": 900
      }
    ]
  }
}
```

升级为：

```json
{
  "pricing": {
    "version": "v1",
    "dimensions": [
      "resolution",
      "duration",
      "aspectRatio",
      "mode",
      "quality",
      "outputCount",
      "referenceImageCount"
    ],
    "defaults": {
      "credits": 600,
      "priceYuan": 6,
      "costYuan": 4.2
    },
    "rules": [
      {
        "ruleKey": "720p-10s",
        "label": "720P / 10s",
        "priority": 100,
        "when": {
          "resolution": "720P",
          "duration": 10
        },
        "price": {
          "credits": 900,
          "priceYuan": 9,
          "costYuan": 6.3
        }
      },
      {
        "ruleKey": "720p-10s-169",
        "label": "720P / 10s / 16:9",
        "priority": 200,
        "when": {
          "resolution": "720P",
          "duration": 10,
          "aspectRatio": "16:9"
        },
        "price": {
          "credits": 960
        }
      }
    ]
  }
}
```

这代表：
- `defaults` 定义 vendor 默认价格
- `rules` 定义规格组合覆盖
- `price` 是统一价格包，不再只有 `creditsPerCall`
- `priority` 控制命中顺序，避免“数组顺序即规则语义”

### 3.3 规格维度独立建模

模型需要显式声明“它支持哪些规格维度”和“这些维度的合法值是什么”。

建议放在 `model.metadata.capabilitySchema` 或升级为正式字段：

```json
{
  "capabilitySchema": {
    "pricingDimensions": {
      "resolution": {
        "type": "enum",
        "options": ["480P", "720P", "1080P"]
      },
      "duration": {
        "type": "enum",
        "options": [5, 10]
      },
      "aspectRatio": {
        "type": "enum",
        "options": ["16:9", "9:16", "1:1"]
      },
      "mode": {
        "type": "enum",
        "options": ["std", "pro"]
      },
      "sound": {
        "type": "boolean"
      }
    },
    "pricingUI": {
      "preferredView": "matrix",
      "matrixAxes": ["resolution", "duration"],
      "filters": ["aspectRatio", "mode", "sound"]
    }
  }
}
```

重点不在字段名字，而在分层：
- 能力层负责声明规格维度
- 定价层负责对这些维度定价
- UI 层根据能力层和定价层决定如何渲染编辑器

### 3.4 引入正式的 `pricingContext`

每次前端预览价格、后端预扣费，都不要直接扫杂乱 `requestParams`，而是构造统一的 `pricingContext`：

```json
{
  "managedModelKey": "kling-3.0",
  "vendorKey": "tencent_vod",
  "serviceType": "kling-3.0-video",
  "taskType": "video",
  "specs": {
    "resolution": "720P",
    "duration": 10,
    "aspectRatio": "16:9",
    "mode": "pro",
    "sound": true
  }
}
```

所有价格解析都只吃这份结构，而不是直接吃业务请求 DTO。

好处：
- 计费上下文稳定
- 不同节点共用价格引擎
- 账单和审计可以直接存快照
- 后续做前后端同构校验更容易

### 3.5 统一价格解析优先级

建议统一为：

1. 命中 `vendor.pricing.rules`
2. 回退 `vendor.pricing.defaults`
3. 回退 `vendor` 旧字段兼容层
4. 回退 `nodeConfig`
5. 回退静态 `CREDIT_PRICING_CONFIG`

同时，解析结果不是一个 number，而是：

```ts
type ResolvedPricingResult = {
  source: "vendor_rule" | "vendor_default" | "legacy_vendor" | "node_config" | "static";
  ruleKey?: string;
  label?: string;
  price: {
    credits?: number;
    priceYuan?: number;
    costYuan?: number;
  };
  pricingContext: Record<string, any>;
};
```

### 3.6 一套模型支持两种编辑模式

#### 模式 A: 矩阵模式
适合：
- 维度少
- 组合有限
- 主要是 exact match

例如视频：
- 行: `resolution`
- 列: `duration`
- 筛选: `aspectRatio / mode / sound`

#### 模式 B: 规则模式
适合：
- 维度多
- 不是所有组合都合法
- 某些模型只对少数组合单独加价

例如图片：
- `mode + imageSize + quality + outputCount + referenceImageCount`

关键点：
- 底层都落同一个 `pricing.rules`
- UI 只是在“矩阵视图”和“规则卡片视图”之间切换

### 3.7 第一阶段不要上 DSL

当前最合适的是结构化条件，不建议一步上可执行表达式。

推荐支持的条件能力：
- `field = value`
- `field in []`
- `field exists`

可选第二期再扩展：
- `gte/lte`
- `allOf/anyOf`
- `not`

这能覆盖 80% 规格组合场景，同时避免安全和复杂度失控。

---

## 4. 建议的数据结构

### 4.1 模型层

```ts
type ManagedModelConfigV3 = {
  modelKey: string;
  modelName?: string;
  taskType?: "text" | "image" | "video";
  enabled?: boolean;
  defaultVendor?: string;
  capabilitySchema?: PricingCapabilitySchema;
  vendors?: ManagedModelVendorConfigV3[];
  metadata?: Record<string, any>;
};
```

### 4.2 Vendor 层

```ts
type ManagedModelVendorConfigV3 = {
  vendorKey: string;
  platformKey?: string;
  label?: string;
  enabled?: boolean;
  route?: string;
  provider?: string;
  modelName?: string;
  modelVersion?: string;

  // 兼容旧字段
  creditsPerCall?: number;

  // 新字段
  pricing?: PricingBook;
  metadata?: Record<string, any>;
};
```

### 4.3 定价层

```ts
type PricingBook = {
  version: "v1";
  dimensions?: string[];
  defaults?: PriceBundle;
  rules?: PricingRule[];
};

type PriceBundle = {
  credits?: number;
  priceYuan?: number;
  costYuan?: number;
};

type PricingRule = {
  ruleKey: string;
  label?: string;
  priority?: number;
  when: Record<string, string | number | boolean | Array<string | number | boolean>>;
  price: PriceBundle;
};
```

### 4.4 兼容层

读取新结构时，后端按以下方式兼容：
- 若 `vendor.pricing` 存在，优先使用
- 否则把 `creditsPerCall + metadata.specPricing` 解释成临时 `PricingBook`

这能保证：
- 旧数据不需要一次性迁移
- 新编辑器和旧数据可以同时工作

---

## 5. 前端设计

### 5.1 管理台重构原则
- 不再把“规格价”放在 `metadata.specPricing` 心智里
- 把管理页文案从“规格积分”升级为“规格定价”
- 同一个规则可以同时填写：
  - 积分
  - 标价人民币
  - 成本人民币

### 5.2 UI 分层

#### 模型信息区
- 基础信息
- 路由信息
- 能力规格声明

#### 定价区
- 默认价卡片
- 规格规则区
- 价格预览区

#### 价格预览区
允许管理员选择一组规格上下文，实时展示：
- 命中的规则
- 最终积分
- 最终人民币价格
- 回退来源

这块价值很大，因为它能直接验证配置是否符合预期。

### 5.3 不同模型的 UI 自动适配

根据 `capabilitySchema.pricingUI`：
- `preferredView = matrix` 时渲染矩阵
- `preferredView = rule_list` 时渲染规则卡片
- `preferredView = mixed` 时渲染矩阵 + 高级规则入口

这意味着以后新增模型，不需要每次在 `Admin.tsx` 里写一套硬编码 if/else。

---

## 6. 后端设计

### 6.1 抽一个独立 Pricing Resolver

建议新增一个独立服务，例如：
- `backend/src/ai/services/model-pricing-resolver.service.ts`

职责：
- 读取 `model_provider_mapping_v2`
- 归一化旧配置和新配置
- 按 `pricingContext` 解析价格
- 返回结构化命中结果

不建议继续把规则解析散在：
- `credits.service.ts`
- 各节点 controller
- 前端本地 helper

### 6.2 预扣费改造

`CreditsService.preDeductCredits()` 不再直接问“这次多少积分”，而是：

1. 构建 `pricingContext`
2. 调用 `ModelPricingResolver.resolve()`
3. 取 `result.price.credits`
4. 持久化 price snapshot

### 6.3 账单审计增强

建议在 `ApiUsageRecord.requestParams` 或新的 metadata 中记录：
- `pricingSource`
- `pricingRuleKey`
- `pricingContext`
- `resolvedPrice`

这样用户和运营都能回答：
- 为什么这次是 900 积分
- 命中了哪条规则
- 是默认价还是规格价

### 6.4 节点价格展示改造

当前 Flow 节点上的 `RunCreditBadge` 基本展示的是“默认路线价格”，不是“当前规格组合价格”。

建议分两阶段：

第一阶段：
- 继续展示 vendor 默认价
- 若当前节点规格能完整构造 `pricingContext`，则显示实时规格价

第二阶段：
- 所有统一模型节点都改成基于 `pricingContext` 实时预览

---

## 7. 迁移方案

### Phase 1: 建立兼容层
- 后端支持 `vendor.pricing`
- 若新字段不存在，自动从 `creditsPerCall + metadata.specPricing` 解释成 `PricingBook`
- 前端管理台读取新旧两种结构，但保存时优先写新结构

### Phase 2: 管理台升级
- 把“规格积分”改为“规格定价”
- 支持默认价 + 规则价 + 多价格字段
- 引入价格预览器

### Phase 3: 运行时统一
- Flow 节点用统一 resolver 预览价格
- 后端预扣费和账单审计全面切换到 resolver

### Phase 4: 清理旧字段
- 统计旧字段是否仍被依赖
- 完成迁移脚本后，逐步废弃 `metadata.specPricing`

---

## 8. 技术决策

### unified_model_pricing_superpower#D001: 把定价从 metadata 提升为正式 `pricing` 模型
**日期**: 2026-04-11
**状态**: ✅采纳
**背景**: `metadata.specPricing` 已经承担核心业务能力，但缺乏正式领域边界
**选项分析**:

| 选项 | 优点 | 缺点 |
|------|------|------|
| A: 继续扩展 `metadata.specPricing` | 改动最小 | 长期仍是补丁模型，无法承载多价格字段 |
| B: 引入正式 `pricing` 模型并保留兼容层 | 结构清晰，可长期演进 | 需要一次前后端适配 |

**决策**: 选择方案 B
**理由**: 这是模型管理继续扩展的基础设施，不值得继续堆 metadata 补丁

### unified_model_pricing_superpower#D002: 价格解析输入统一为 `pricingContext`
**日期**: 2026-04-11
**状态**: ✅采纳
**背景**: 当前价格规则从 `requestParams` 直接读字段，字段语义散乱
**选项分析**:

| 选项 | 优点 | 缺点 |
|------|------|------|
| A: 继续从 request DTO 直接匹配 | 短期简单 | 领域边界不清晰，难审计 |
| B: 显式构建 `pricingContext` | 输入稳定，便于前后端共享 | 需要各调用方补一层映射 |

**决策**: 选择方案 B
**理由**: 统一计费上下文是后续审计、预览、风控和账单解释的前提

### unified_model_pricing_superpower#D003: 先支持结构化规则，不立刻支持 DSL
**日期**: 2026-04-11
**状态**: ✅采纳
**背景**: 组合规格确实复杂，但绝大多数仍是结构化条件匹配
**决策**: 第一阶段只支持 `eq / in / exists` 级别的结构化规则
**理由**: 优先把领域模型做稳，再决定是否需要公式或表达式系统

---

## 9. 建议的最小落地范围

如果只做一个 P0 版本，我建议最小闭环是：

1. 后端新增统一 `pricing resolver`
2. vendor 新增正式 `pricing` 字段
3. 兼容读取旧 `specPricing`
4. 前端管理台先支持：
   - 默认积分
   - 默认人民币价格
   - 规格组合积分
   - 规格组合人民币价格
5. 后端账单记录命中规则和价格快照

这版做完，统一模型管理就真正从“线路切换配置”升级成“模型能力 + 路由 + 定价”的中心系统了。
