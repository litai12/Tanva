# Tanva 基于 json-rules-engine 的 Kling 定价方案与 UI 配置设计

## 1. 目标

本方案基于“方案 1”落地：

- 使用 `json-rules-engine` 作为规则匹配层
- Tanva 自研 evaluator 作为价格计算层
- 从 `Kling` 系列模型先行接入
- 同时规划与现有 `Admin.tsx` 相兼容的运营配置 UI

本方案优先解决：

- `Kling-2.6` 的 `hasAudio × qualityMode × durationSec`
- `Kling-3.0` 的 `hasAudio × qualityMode × durationSec`
- 让运营通过 UI 配置这类组合规则

## 2. 为什么选 json-rules-engine

相对 Tanva 当前代码，`json-rules-engine` 最适合先做第一阶段：

- Node / TypeScript 友好
- 规则结构清晰，适合 NestJS 落地
- 支持 `all / any / fact`，适合多条件组合命中
- 容易从现有 `vendor.pricing.rules` 平滑迁移

但要明确：

- `json-rules-engine` 只负责匹配“哪条规则命中”
- 真正的价格计算仍由 Tanva evaluator 完成
- 不直接把价格写死在 engine event 里

## 3. 建议的总体结构

建议每个 vendor 的价格规则拆成两个部分：

1. `matchingRules`
- 交给 `json-rules-engine`
- 只负责命中哪条 pricing rule

2. `evaluatorMap`
- Tanva 自研
- 根据 `ruleKey` 执行 `fixed / lookup_matrix / linear`

这样可以避免把复杂 matrix 硬塞进 rules engine。

## 4. Kling 第一阶段的建议范围

### 4.1 优先接入的模型

- `kling-2.6-video`
- `kling-3.0-video`

### 4.2 第一阶段支持的条件维度

- `modelKey`
- `generationMode`
- `hasAudio`
- `qualityMode`
- `durationSec`

说明：

- `Kling-2.6` 第一阶段不用拆 `resolution`，因为价格表里更核心的是 `qualityMode`
- `Kling-3.0` 的 `std/pro` 已经隐含分辨率语义，先通过 metadata 映射，不强行拆开

### 4.3 第一阶段支持的 evaluator

- `lookup_matrix`
- `fixed`

不建议第一阶段在 Kling 上引入 `linear`，因为没有必要。

## 5. json-rules-engine 在 Tanva 中的角色

## 5.1 输入

输入给 engine 的是 `PricingContext`：

```ts
type PricingContext = {
  modelKey: string;
  vendorKey?: string;
  generationMode?: string;
  hasAudio?: boolean;
  qualityMode?: string;
  durationSec?: number;
};
```

## 5.2 输出

engine 只输出：

- `matchedRuleKey`
- `matchedPriority`
- `matchedLabel`

然后 Tanva 再根据 `matchedRuleKey` 去 evaluator 里求值。

## 5.3 为什么不让 json-rules-engine 直接算价格

原因：

- `json-rules-engine` 更适合判断，不适合复杂求值
- 价格矩阵和公式逻辑会让 rule payload 过重
- 运营 UI 更适合编辑结构化 matrix，而不是直接写 engine event

## 6. Kling 的推荐规则结构

建议现有 `vendor.pricing` 从：

```json
{
  "version": "v1",
  "dimensions": ["..."],
  "rules": [
    {
      "ruleKey": "xxx",
      "when": { "...": "..." },
      "price": { "credits": 100 }
    }
  ]
}
```

升级为：

```json
{
  "version": "v2",
  "dimensions": ["generationMode", "hasAudio", "qualityMode", "durationSec"],
  "matchingRules": [],
  "evaluators": {},
  "displayConfig": {}
}
```

### 6.1 matchingRules

```json
[
  {
    "ruleKey": "kling26_i2v_audio_quality_duration",
    "label": "Kling 2.6 图生视频矩阵价",
    "priority": 100,
    "conditions": {
      "all": [
        { "fact": "modelKey", "operator": "equal", "value": "kling-2.6-video" },
        { "fact": "generationMode", "operator": "equal", "value": "i2v" }
      ]
    },
    "evaluatorKey": "kling26_audio_quality_duration_matrix"
  }
]
```

### 6.2 evaluators

```json
{
  "kling26_audio_quality_duration_matrix": {
    "type": "lookup_matrix",
    "axes": ["hasAudio", "qualityMode", "durationSec"],
    "matrix": {
      "false": {
        "std": { "5": 1.5, "10": 3 },
        "pro": { "5": 3, "10": 5 }
      },
      "true": {
        "std": { "5": 5, "10": 10 },
        "pro": { "5": 6, "10": 12 }
      }
    }
  }
}
```

### 6.3 displayConfig

```json
{
  "specAxes": ["hasAudio", "qualityMode", "durationSec"],
  "labels": {
    "hasAudio.false": "无声",
    "hasAudio.true": "有声",
    "qualityMode.std": "标准",
    "qualityMode.pro": "高品质"
  },
  "durationOptions": [5, 10]
}
```

## 7. Kling-2.6 具体设计

### 7.1 原始表映射

原表：

- 无声 + std + 5s = 1.5
- 无声 + std + 10s = 3
- 无声 + pro + 5s = 3
- 无声 + pro + 10s = 5
- 有声 + std + 5s = 5
- 有声 + std + 10s = 10
- 有声 + pro + 5s = 6
- 有声 + pro + 10s = 12

### 7.2 推荐 Kling-2.6 pricingBook

```json
{
  "version": "v2",
  "dimensions": ["generationMode", "hasAudio", "qualityMode", "durationSec"],
  "matchingRules": [
    {
      "ruleKey": "kling26_i2v_rule",
      "label": "Kling 2.6 图生视频",
      "priority": 100,
      "conditions": {
        "all": [
          { "fact": "modelKey", "operator": "equal", "value": "kling-2.6-video" },
          { "fact": "generationMode", "operator": "equal", "value": "i2v" }
        ]
      },
      "evaluatorKey": "kling26_matrix"
    }
  ],
  "evaluators": {
    "kling26_matrix": {
      "type": "lookup_matrix",
      "axes": ["hasAudio", "qualityMode", "durationSec"],
      "matrix": {
        "false": {
          "std": { "5": 1.5, "10": 3 },
          "pro": { "5": 3, "10": 5 }
        },
        "true": {
          "std": { "5": 5, "10": 10 },
          "pro": { "5": 6, "10": 12 }
        }
      }
    }
  },
  "displayConfig": {
    "specAxes": ["hasAudio", "qualityMode", "durationSec"],
    "labels": {
      "hasAudio.false": "无声",
      "hasAudio.true": "有声",
      "qualityMode.std": "标准（std）",
      "qualityMode.pro": "高品质（pro）"
    },
    "durationOptions": [5, 10]
  }
}
```

## 8. Kling-3.0 具体设计

### 8.1 原始表特征

- 文生 / 图生 / 首尾帧共用一个价表
- 无声/有声
- std/pro
- 5 秒 / 10 秒
- `std/pro` 同时暗含 `720P/1080P`

### 8.2 推荐 Kling-3.0 pricingBook

```json
{
  "version": "v2",
  "dimensions": ["generationMode", "hasAudio", "qualityMode", "durationSec"],
  "matchingRules": [
    {
      "ruleKey": "kling30_common_rule",
      "label": "Kling 3.0 文生/图生/首尾帧",
      "priority": 100,
      "conditions": {
        "all": [
          { "fact": "modelKey", "operator": "equal", "value": "kling-3.0-video" },
          {
            "fact": "generationMode",
            "operator": "in",
            "value": ["t2v", "i2v", "start_end_frame"]
          }
        ]
      },
      "evaluatorKey": "kling30_matrix"
    }
  ],
  "evaluators": {
    "kling30_matrix": {
      "type": "lookup_matrix",
      "axes": ["hasAudio", "qualityMode", "durationSec"],
      "matrix": {
        "false": {
          "std": { "5": 3, "10": 6 },
          "pro": { "5": 4, "10": 8 }
        },
        "true": {
          "std": { "5": 4.5, "10": 9 },
          "pro": { "5": 6, "10": 12 }
        }
      }
    }
  },
  "displayConfig": {
    "specAxes": ["hasAudio", "qualityMode", "durationSec"],
    "labels": {
      "hasAudio.false": "无声",
      "hasAudio.true": "有声",
      "qualityMode.std": "标准（720P）",
      "qualityMode.pro": "高品质（1080P）"
    },
    "durationOptions": [5, 10]
  },
  "metadata": {
    "qualityToResolution": {
      "std": "720P",
      "pro": "1080P"
    }
  }
}
```

## 9. Admin UI 现状与改造策略

当前 `frontend/src/pages/Admin.tsx` 已经具备：

- `vendor.pricing.defaults`
- `vendor.pricing.rules`
- `metadata.specPricing`

问题在于：

- 规则 UI 默认假设是“简单 match + 静态价格”
- 没有 `matchingRules / evaluators / displayConfig` 三段结构
- 不适合配置 Kling 这种组合矩阵

因此建议采用“兼容升级”，不是完全推翻。

## 10. Kling UI 配置方案

建议在现有 vendor 配置区新增一个“高级定价模式”：

- `简单规则模式`
- `组合规则模式（Kling 推荐）`

### 10.1 组合规则模式的页面分块

建议拆成 4 个区块：

1. `匹配规则`
2. `价格求值器`
3. `展示配置`
4. `试算器`

### 10.2 匹配规则区

用于配置 `matchingRules`。

字段建议：

- 规则名称
- 规则 Key
- 优先级
- 模型 Key
- 生成模式
- 是否启用

UI 形式建议：

- 不给运营直接写 JSON
- 用表单 + tag selector
- `generationMode` 用多选

例如 Kling-3.0：

- 模型：`kling-3.0-video`
- 模式：`文生` / `图生` / `首尾帧`
- evaluatorKey：`kling30_matrix`

### 10.3 价格求值器区

Kling 第一阶段只支持 `lookup_matrix`。

因此 UI 直接做成矩阵编辑器。

Kling-2.6 矩阵轴：

- 行轴：`hasAudio`
- 列轴：`qualityMode`
- 单元格内再按 `durationSec`

更实用的 UI 建议：

- 先选择轴配置
- 自动生成二维/三维价格表单

Kling 第一版可以简化成固定样式：

- 分组 1：无声
- 分组 2：有声
- 每组下有：
  - 标准
  - 高品质
- 每个品质下有：
  - 5 秒价格
  - 10 秒价格

### 10.4 展示配置区

用于配置前端价格一览的展示方式。

字段建议：

- 规格轴顺序
- UI 标签映射
- 默认展示的 duration 选项
- 是否展示分辨率说明

Kling-3.0 特别需要：

- `std -> 标准（720P）`
- `pro -> 高品质（1080P）`

### 10.5 试算器

这是运营配置最关键的部分。

输入：

- modelKey
- generationMode
- hasAudio
- qualityMode
- durationSec

输出：

- 命中的 ruleKey
- evaluatorKey
- priceYuan
- credits

积分统一按：

```ts
credits = ceil(priceYuan * 100)
```

## 11. 前后端数据结构建议

为了尽量兼容现有代码，建议在 `ManagedModelVendorConfig.pricing` 下新增以下字段：

```ts
type ManagedPricingBookV2 = {
  version?: string;
  dimensions?: string[];
  defaults?: {
    credits?: number;
    priceYuan?: number;
    costYuan?: number;
  };
  rules?: Array<any>; // 旧结构保留兼容
  matchingRules?: Array<{
    ruleKey: string;
    label?: string;
    priority?: number;
    conditions: Record<string, unknown>;
    evaluatorKey: string;
  }>;
  evaluators?: Record<
    string,
    {
      type: "fixed" | "lookup_matrix";
      axes?: string[];
      matrix?: Record<string, unknown>;
      priceYuan?: number;
    }
  >;
  displayConfig?: {
    specAxes?: string[];
    labels?: Record<string, string>;
    durationOptions?: number[];
  };
};
```

## 12. 后端实现建议

### 12.1 新增适配层

在现有 `backend/src/ai/services/model-pricing-resolver.ts` 前加一层：

- 若存在 `matchingRules + evaluators`
  - 走 `json-rules-engine` 模式
- 否则
  - 继续走旧的 `rules/defaults` 模式

### 12.2 解析流程

1. 读取 vendor.pricing
2. 若是 v2：
3. 用 `matchingRules` 在 engine 中跑命中
4. 找到对应 `evaluatorKey`
5. 调用 Tanva evaluator 求 `priceYuan`
6. 计算 `credits = ceil(priceYuan * 100)`
7. 返回统一 quote result

## 13. Kling UI 第一期实现建议

为了降低复杂度，第一期 UI 不做“通用规则编辑器”，只做：

- Kling-2.6 组合矩阵配置卡片
- Kling-3.0 组合矩阵配置卡片

也就是先做“场景化 UI”，不是完全抽象的规则搭建器。

原因：

- Kling 的规格非常稳定
- 运营更容易理解
- 落地更快
- 后续再抽象成通用组件

## 14. 第一期 UI 组件建议

建议新增组件：

- `KlingPricingMatrixEditor`
- `KlingPricingRuleMatcherEditor`
- `PricingQuotePreviewCard`

### 14.1 KlingPricingMatrixEditor

职责：

- 编辑 `hasAudio × qualityMode × durationSec`
- 自动生成 matrix JSON

### 14.2 KlingPricingRuleMatcherEditor

职责：

- 编辑 `modelKey`
- 编辑 `generationMode`
- 编辑 `priority`
- 选择 evaluatorKey

### 14.3 PricingQuotePreviewCard

职责：

- 即时输入组合条件
- 实时显示价格和积分

## 15. 迁移建议

### 15.1 第一步

先只为 Kling vendor 配置写入 `pricing.version = v2`

### 15.2 第二步

后端 resolver 支持：

- `v1` 老规则
- `v2` json-rules-engine + evaluator

### 15.3 第三步

Admin UI 只在 Kling 模型下露出“组合定价配置”

### 15.4 第四步

前端价格一览和扣费接口开始读取 quote 结果

## 16. 结论

如果选方案 1，那么最稳的落地方向是：

- 用 `json-rules-engine` 做 Kling 的规则命中
- 用 Tanva 自研 `lookup_matrix` evaluator 做实际价格求值
- 用场景化 UI 先支持 Kling 的矩阵配置
- 保持与现有 `Admin.tsx` 和 `vendor.pricing` 结构兼容升级

第一阶段不要追求通用到所有模型，先把 `Kling-2.6 / Kling-3.0` 配通、算准、展示准、扣费准。
