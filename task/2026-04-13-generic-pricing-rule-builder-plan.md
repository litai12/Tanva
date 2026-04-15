# Tanva 通用定价规则搭建器方案

## 1. 目标修正

本方案的目标不是做一个只服务 `Kling` 的专用配置页，而是做一个：

- 可配置多模型、多 vendor、多维条件组合
- 可承载不同 evaluator
- 可给运营使用
- 可先用 `Kling` 作为样例验证

也就是说：

- `Kling` 是示例模型
- `通用规则搭建器` 才是最终产品形态

## 2. 产品目标

构建一个通用 `Pricing Rule Builder`，让运营或产品同学通过后台完成以下工作：

1. 定义报价输入维度
2. 定义规则命中条件
3. 选择价格求值器类型
4. 配置 evaluator 参数
5. 配置前端展示规格
6. 通过试算器验证结果
7. 保存草稿、发布、回滚

## 3. 设计原则

### 3.1 通用，不绑定某个模型

搭建器不能写死：

- `hasAudio`
- `qualityMode`
- `durationSec`

而应该允许后台定义“本模型使用哪些维度”。

### 3.2 结构化，不开放任意脚本

运营编辑器只允许：

- 条件搭建
- evaluator 参数录入
- matrix 表格录入

不允许任意 JS/TS 脚本。

### 3.3 同一套规则同时服务三类场景

- 价格一览展示
- 实时报价
- 实际扣费

### 3.4 兼容现有数据结构

第一阶段应尽量兼容现有：

- `MODEL_PROVIDER_MAPPING_SETTING_KEY`
- `vendor.pricing`
- `vendor.pricing.rules`
- `metadata.specPricing`

## 4. 通用对象模型

## 4.1 定价书 PricingBook

```ts
type ManagedPricingBookV2 = {
  version: "v2";
  dimensions: PricingDimensionDefinition[];
  matchingRules: PricingMatchingRule[];
  evaluators: Record<string, PricingEvaluatorDefinition>;
  displayConfig?: PricingDisplayConfig;
  defaults?: {
    priceYuan?: number;
    credits?: number;
    costYuan?: number;
  };
};
```

## 4.2 维度定义

这是通用搭建器的核心。

```ts
type PricingDimensionDefinition = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  source?: "pricingContext" | "derived";
  required?: boolean;
  options?: Array<{
    value: string | number | boolean;
    label: string;
  }>;
  description?: string;
};
```

示例：

```json
[
  {
    "key": "generationMode",
    "label": "生成模式",
    "type": "enum",
    "required": true,
    "options": [
      { "value": "t2v", "label": "文生视频" },
      { "value": "i2v", "label": "图生视频" },
      { "value": "start_end_frame", "label": "首尾帧" }
    ]
  },
  {
    "key": "hasAudio",
    "label": "声音",
    "type": "boolean",
    "required": false,
    "options": [
      { "value": false, "label": "无声" },
      { "value": true, "label": "有声" }
    ]
  }
]
```

结论：

- `Kling` 用哪些维度，是靠 dimensions 配出来的
- 其他模型未来可以定义完全不同的维度集

## 4.3 通用匹配规则

```ts
type PricingMatchingRule = {
  ruleKey: string;
  label?: string;
  enabled: boolean;
  priority?: number;
  evaluatorKey: string;
  conditions: ConditionGroup;
  effectiveFrom?: string;
  effectiveTo?: string;
};
```

```ts
type ConditionGroup = {
  all?: ConditionItem[];
  any?: ConditionItem[];
};

type ConditionItem = {
  field: string;
  op: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
  value?: string | number | boolean | Array<string | number | boolean>;
};
```

说明：

- 这层是“通用规则搭建器”的条件编辑器产物
- 后端可转换为 `json-rules-engine` 结构

## 4.4 通用 evaluator 定义

```ts
type PricingEvaluatorDefinition =
  | FixedEvaluatorDefinition
  | LookupMatrixEvaluatorDefinition
  | LinearEvaluatorDefinition
  | BasePlusLinearEvaluatorDefinition;
```

```ts
type FixedEvaluatorDefinition = {
  type: "fixed";
  priceYuan: number;
};

type LookupMatrixEvaluatorDefinition = {
  type: "lookup_matrix";
  axes: string[];
  matrix: Record<string, unknown>;
};

type LinearEvaluatorDefinition = {
  type: "linear";
  unitField: string;
  unitPriceYuan: number;
};

type BasePlusLinearEvaluatorDefinition = {
  type: "base_plus_linear";
  basePriceYuan: number;
  includedUnits: number;
  unitField: string;
  extraUnitPriceYuan: number;
};
```

## 4.5 展示配置

```ts
type PricingDisplayConfig = {
  specAxes?: string[];
  labels?: Record<string, string>;
  presets?: Array<Record<string, string | number | boolean>>;
  defaultSelections?: Record<string, string | number | boolean>;
};
```

用途：

- 决定价格一览如何展开
- 决定字段值如何映射成人类可读文案
- 决定前端默认推荐规格

## 5. 通用规则搭建器 UI 结构

建议 UI 拆成 5 个 Tab。

### 5.1 Tab 1: 维度定义

用途：

- 定义这个模型/这个 vendor 用哪些定价维度

字段：

- `key`
- `label`
- `type`
- `required`
- `options`
- `description`

交互：

- 支持新增维度
- 支持拖拽排序
- 支持为 `enum/boolean` 配置选项

这是“通用”的关键入口。

### 5.2 Tab 2: 匹配规则

用途：

- 让运营定义哪种条件命中哪条规则

字段：

- `ruleKey`
- `label`
- `enabled`
- `priority`
- `evaluatorKey`
- `conditions`

UI 形式：

- 规则列表
- 每条规则支持新增多个条件
- 条件字段由“维度定义”下拉生成
- 操作符根据字段类型自动限制

例如：

- 对 `boolean` 仅允许 `eq`
- 对 `enum` 允许 `eq` / `in`
- 对 `number` 允许 `eq` / `gt` / `gte` / `lt` / `lte`

### 5.3 Tab 3: Evaluator 配置

用途：

- 配置每种价格求值器

UI 结构：

1. 新建 evaluator
2. 选择类型
3. 根据类型显示不同配置表单

不同类型的 UI：

`fixed`
- 价格（元）

`linear`
- 计价字段
- 单位价格

`base_plus_linear`
- 起步价
- 包含单位数
- 续量字段
- 续量单价

`lookup_matrix`
- 选择轴
- 自动生成矩阵表格

### 5.4 Tab 4: 展示配置

用途：

- 决定前端价格一览如何显示

字段：

- 规格轴顺序
- 标签映射
- 默认规格
- 推荐规格预设

例如：

- `hasAudio.true -> 有声`
- `qualityMode.pro -> 高品质（1080P）`

### 5.5 Tab 5: 试算器

用途：

- 用当前配置做实时试算

输入：

- 每个 dimension 一个控件

输出：

- 命中的 ruleKey
- evaluatorKey
- evaluatorType
- priceYuan
- credits
- 计算轨迹

这是运营发布前的强校验入口。

## 6. 通用 UI 组件建议

### 6.1 `DimensionDefinitionEditor`

职责：

- 编辑 `dimensions`

### 6.2 `ConditionBuilder`

职责：

- 编辑 `ConditionGroup`
- 动态根据维度类型切换控件

### 6.3 `EvaluatorEditor`

职责：

- 作为统一入口
- 内部根据类型切到不同子组件

子组件：

- `FixedEvaluatorForm`
- `LinearEvaluatorForm`
- `BasePlusLinearEvaluatorForm`
- `LookupMatrixEvaluatorForm`

### 6.4 `LookupMatrixEditor`

职责：

- 根据 axes 自动构建价格矩阵 UI
- 支持二维和三维矩阵

建议：

- 第一版支持最多 3 轴
- 第三轴可嵌套为分组字段

### 6.5 `PricingPreviewPanel`

职责：

- 展示试算结果
- 展示最终积分换算

## 7. JSON Schema 建议

## 7.1 PricingBook Schema

```json
{
  "version": "v2",
  "dimensions": [],
  "matchingRules": [],
  "evaluators": {},
  "displayConfig": {}
}
```

## 7.2 单条 Matching Rule Schema

```json
{
  "ruleKey": "string",
  "label": "string",
  "enabled": true,
  "priority": 100,
  "evaluatorKey": "string",
  "conditions": {
    "all": [],
    "any": []
  }
}
```

## 7.3 Evaluator Schema

```json
{
  "eval_fixed_1": {
    "type": "fixed",
    "priceYuan": 6
  },
  "eval_matrix_1": {
    "type": "lookup_matrix",
    "axes": ["hasAudio", "qualityMode", "durationSec"],
    "matrix": {}
  }
}
```

## 8. 与 json-rules-engine 的适配层

后台不必直接把 UI 产物原样塞进 `json-rules-engine`。

建议新增转换函数：

```ts
function toJsonRulesEngineRule(rule: PricingMatchingRule) {
  return {
    name: rule.ruleKey,
    priority: rule.priority ?? 1,
    conditions: convertConditionGroup(rule.conditions),
    event: {
      type: "pricing_rule_matched",
      params: {
        ruleKey: rule.ruleKey,
        evaluatorKey: rule.evaluatorKey
      }
    }
  };
}
```

这样：

- UI 层保留 Tanva 自己的通用 schema
- 执行层再适配到 `json-rules-engine`

## 9. Admin 里的落地建议

当前 [Admin.tsx](/Users/libiqiang/business/Tanva/frontend/src/pages/Admin.tsx) 已经维护 `vendor.pricing`。

建议不要新开完全独立的存储结构，而是这样扩展：

```ts
vendor.pricing = {
  version: "v2",
  dimensions: [...],
  matchingRules: [...],
  evaluators: {...},
  displayConfig: {...},
  defaults: {...}
}
```

兼容策略：

- 如果只有 `rules/defaults`，按 v1 处理
- 如果有 `matchingRules/evaluators`，按 v2 处理

## 10. Kling 作为示例如何放进通用搭建器

Kling 只是维度定义和 evaluator 的一个实例。

### 10.1 Kling-2.6 的 dimensions

```json
[
  {
    "key": "generationMode",
    "label": "生成模式",
    "type": "enum",
    "options": [{ "value": "i2v", "label": "图生视频" }]
  },
  {
    "key": "hasAudio",
    "label": "声音",
    "type": "boolean",
    "options": [
      { "value": false, "label": "无声" },
      { "value": true, "label": "有声" }
    ]
  },
  {
    "key": "qualityMode",
    "label": "品质",
    "type": "enum",
    "options": [
      { "value": "std", "label": "标准" },
      { "value": "pro", "label": "高品质" }
    ]
  },
  {
    "key": "durationSec",
    "label": "时长（秒）",
    "type": "enum",
    "options": [
      { "value": 5, "label": "5秒" },
      { "value": 10, "label": "10秒" }
    ]
  }
]
```

### 10.2 Kling-2.6 的 evaluator

这只是一个 `lookup_matrix` 示例，不是专用 UI。

所以 Kling 的价值在于：

- 用来验证通用 builder 是否足够表达真实业务

## 11. 接口草案

### 11.1 获取单个模型 vendor pricing

```http
GET /api/admin/model-pricing/:modelKey/:vendorKey
```

返回：

```json
{
  "modelKey": "kling-2.6-video",
  "vendorKey": "kapon",
  "pricing": {
    "version": "v2",
    "dimensions": [],
    "matchingRules": [],
    "evaluators": {},
    "displayConfig": {}
  }
}
```

### 11.2 保存 pricingBook

```http
PUT /api/admin/model-pricing/:modelKey/:vendorKey
```

### 11.3 试算

```http
POST /api/admin/model-pricing/preview
```

请求：

```json
{
  "pricingBook": {},
  "context": {
    "modelKey": "kling-2.6-video",
    "generationMode": "i2v",
    "hasAudio": true,
    "qualityMode": "pro",
    "durationSec": 10
  }
}
```

返回：

```json
{
  "matchedRuleKey": "kling26_i2v_rule",
  "evaluatorKey": "kling26_matrix",
  "evaluatorType": "lookup_matrix",
  "priceYuan": 12,
  "credits": 1200
}
```

## 12. 第一期实施建议

第一期通用搭建器建议做到：

1. 支持 `dimensions`
2. 支持 `matchingRules`
3. 支持 `fixed / linear / lookup_matrix`
4. 支持试算器
5. 支持保存到 `vendor.pricing`

先不做：

- 版本发布流
- 审批流
- 回滚
- 超复杂 piecewise

## 13. 最终结论

你要的不是“给 Kling 做个特例页”，而是：

- 先做一套 `通用规则搭建器`
- 用 `Kling` 验证这套 builder 能表达真实复杂价格

因此正确的产品形态应该是：

- 通用 `DimensionDefinitionEditor`
- 通用 `ConditionBuilder`
- 通用 `EvaluatorEditor`
- 通用 `LookupMatrixEditor`
- 通用 `PricingPreviewPanel`

`Kling` 只是第一批演示与验证数据，不应决定最终 UI 只能服务 Kling。
