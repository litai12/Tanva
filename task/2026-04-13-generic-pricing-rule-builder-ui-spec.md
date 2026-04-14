# Tanva 通用定价规则搭建器 UI 规格稿

## 1. 文档目标

本文件用于把“通用定价规则搭建器”从概念方案推进到前端可实现级别。

目标包括：

- 明确页面结构
- 明确字段级 UI
- 明确交互流程
- 明确保存与试算行为
- 明确如何兼容现有 Admin 页面

本稿默认：

- 规则匹配层使用 `json-rules-engine`
- 价格求值层由 Tanva evaluator 完成
- 当前先在 `Admin` 内集成

## 2. 页面定位

建议入口位置：

- `Admin -> 模型管理 -> 某模型 -> 某 vendor -> 定价规则`

不要把它做成一个孤立页面，建议挂在现有模型管理链路里。

这样上下文天然明确：

- 当前正在编辑哪个 `modelKey`
- 当前正在编辑哪个 `vendorKey`

## 3. 页面整体结构

建议使用左右布局：

### 左侧：规则编辑区

包含 4 个主区块：

1. `基础信息`
2. `维度定义`
3. `匹配规则`
4. `价格求值器`
5. `展示配置`

### 右侧：验证与预览区

包含 3 个主区块：

1. `试算器`
2. `命中结果`
3. `价格一览预览`

## 4. 顶部信息区

页面顶部建议显示：

- 模型名称
- 模型 Key
- Vendor 名称
- Vendor Key
- 当前 pricing version
- 保存状态

按钮区：

- `保存草稿`
- `重置未保存修改`
- `试算`
- `发布`（第二期）

## 5. 区块一：基础信息

作用：

- 说明当前 pricingBook 的基本信息

字段：

- `version`
- `description`
- `status`
- `updatedAt`
- `updatedBy`

第一期可编辑字段：

- `description`

其余只读即可。

## 6. 区块二：维度定义

这是整个规则搭建器的基础。

### 6.1 展示形式

建议使用“列表 + 右侧表单抽屉”或“卡片列表 + 行内编辑”。

每个 dimension 显示：

- 标签名
- key
- 类型
- 是否必填
- 选项数
- 排序

### 6.2 单个 dimension 字段

```ts
type DimensionForm = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  required: boolean;
  source: "pricingContext" | "derived";
  description?: string;
  options?: Array<{
    value: string | number | boolean;
    label: string;
  }>;
};
```

### 6.3 字段级 UI

`key`
- 输入框
- 规则：英文字母、数字、下划线
- 创建后尽量不允许轻易改名

`label`
- 输入框
- 用于运营和前端展示

`type`
- 单选
- 选项：
  - `枚举`
  - `布尔`
  - `数字`
  - `字符串`

`required`
- 开关

`source`
- 单选
- 默认 `pricingContext`
- 未来支持 `derived`

`description`
- 多行输入

`options`
- 仅当 `enum/boolean` 时显示
- 使用可增删的表格编辑

### 6.4 操作

- 新增维度
- 删除维度
- 调整顺序
- 复制维度

### 6.5 校验

- `key` 唯一
- 至少保留一个维度
- `enum` 必须至少一个 option

## 7. 区块三：匹配规则

### 7.1 展示形式

建议左侧规则列表 + 右侧规则详情编辑。

列表项显示：

- `label`
- `ruleKey`
- `enabled`
- `priority`
- `evaluatorKey`

### 7.2 单个规则字段

```ts
type MatchingRuleForm = {
  ruleKey: string;
  label?: string;
  enabled: boolean;
  priority?: number;
  evaluatorKey: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  conditions: {
    all: ConditionRow[];
    any: ConditionRow[];
  };
};
```

### 7.3 ConditionRow UI

```ts
type ConditionRow = {
  field: string;
  op: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
  value?: unknown;
};
```

字段展示：

`field`
- 下拉框
- 选项来自 `dimensions`

`op`
- 下拉框
- 根据字段类型动态限制

`value`
- 动态控件

值控件映射：

- `boolean + eq` -> 单选按钮
- `enum + eq` -> 单选下拉
- `enum + in` -> 多选下拉
- `number + gt/gte/lt/lte/eq` -> 数字输入框
- `string + eq` -> 文本输入框
- `exists` -> 不展示 value，仅展示真假切换

### 7.4 条件组交互

建议页面内明确区分：

- `必须同时满足（ALL）`
- `满足任一条件（ANY）`

每组都支持：

- 添加条件
- 删除条件
- 排序

### 7.5 规则级校验

- `ruleKey` 唯一
- `evaluatorKey` 必须存在
- `effectiveFrom <= effectiveTo`
- 至少要有一条条件

## 8. 区块四：价格求值器

### 8.1 展示形式

建议使用 evaluator 列表 + evaluator 详情表单。

列表项显示：

- `evaluatorKey`
- `type`
- 简介

### 8.2 新建 evaluator 流程

1. 点击“新增 evaluator”
2. 输入 `evaluatorKey`
3. 选择类型
4. 打开对应表单

### 8.3 evaluator 类型与 UI

#### `fixed`

字段：

- `priceYuan`

UI：

- 金额输入框

#### `linear`

字段：

- `unitField`
- `unitPriceYuan`

UI：

- 计价字段下拉
- 单位价格输入框

#### `base_plus_linear`

字段：

- `basePriceYuan`
- `includedUnits`
- `unitField`
- `extraUnitPriceYuan`

UI：

- 起步价输入
- 包含单位数输入
- 续量字段下拉
- 续量单价输入

#### `lookup_matrix`

这是最复杂的。

字段：

- `axes`
- `matrix`

UI 分两步：

1. 先选轴
2. 再生成矩阵编辑表

## 9. LookupMatrixEditor 详细规格

### 9.1 轴选择

最多支持 3 轴：

- Axis 1
- Axis 2
- Axis 3（可选）

轴只能选：

- `enum`
- `boolean`
- 数值型但推荐离散 options

### 9.2 自动生成矩阵编辑器

如果是 2 轴：

- 行：Axis 1
- 列：Axis 2
- 单元格：价格输入框

如果是 3 轴：

- 先按 Axis 1 分组
- 每组内展示 Axis 2 × Axis 3 二维表

### 9.3 Kling 示例

若 axes 为：

- `hasAudio`
- `qualityMode`
- `durationSec`

则 UI 显示为：

- 分组：无声 / 有声
- 每组表格列：标准 / 高品质
- 每组表格行：5 秒 / 10 秒

### 9.4 矩阵校验

- 不允许空单元格发布
- 值必须 >= 0
- 轴值必须来自 dimension options

## 10. 区块五：展示配置

作用：

- 控制价格一览页怎么展开
- 控制运营预览文案

### 10.1 字段

```ts
type DisplayConfigForm = {
  specAxes: string[];
  labels: Record<string, string>;
  defaultSelections: Record<string, unknown>;
  presets: Array<Record<string, unknown>>;
};
```

### 10.2 UI

`specAxes`
- 拖拽排序多选

`labels`
- key-value 表格
- 可根据 dimensions/options 自动生成初始项

`defaultSelections`
- 动态表单
- 每个 dimension 一个默认值

`presets`
- 预设规格列表
- 每行是一个组合
- 用于前端价格一览和推荐规格

## 11. 右侧区块：试算器

这是整个 builder 的核心验证入口。

### 11.1 输入区

根据 `dimensions` 自动生成控件。

示例：

- 生成模式
- 声音
- 品质
- 时长

### 11.2 输出区

展示：

- `matchedRuleKey`
- `matchedRuleLabel`
- `evaluatorKey`
- `evaluatorType`
- `priceYuan`
- `credits`
- `trace`

积分统一显示：

```ts
credits = ceil(priceYuan * 100)
```

### 11.3 异常输出

若未命中规则：

- 红色提示
- 明确写：`未匹配到有效定价规则`

若 evaluator 失败：

- 红色提示
- 明确写：`规则已命中，但价格求值失败`

## 12. 右侧区块：价格一览预览

作用：

- 模拟前端看到的价格表

逻辑：

- 基于 `displayConfig.presets`
- 对每个 preset 自动调用试算

展示形式建议：

- 表格或卡片列表

每项显示：

- 规格标签
- 价格（元）
- 积分

## 13. 保存交互

### 13.1 保存草稿

行为：

- 只做结构校验
- 不强制所有 matrix 填满

### 13.2 发布前校验

第二期可补：

- 所有规则合法
- 无冲突
- 所有 matrix 完整
- 所有 preset 均可试算

## 14. 推荐的前端状态结构

```ts
type PricingBuilderState = {
  version: "v2";
  dimensions: DimensionForm[];
  matchingRules: MatchingRuleForm[];
  evaluators: Record<string, PricingEvaluatorDefinition>;
  displayConfig: DisplayConfigForm;
  dirty: boolean;
};
```

## 15. 推荐的前端组件树

```ts
PricingRuleBuilderPage
  ├── PricingHeaderBar
  ├── DimensionDefinitionPanel
  ├── MatchingRulePanel
  ├── EvaluatorPanel
  ├── DisplayConfigPanel
  ├── PricingPreviewSidebar
  │   ├── PricingContextPreviewForm
  │   ├── QuoteResultCard
  │   └── PricingCatalogPreviewTable
```

## 16. 与现有 Admin 集成建议

当前 [Admin.tsx](/Users/libiqiang/business/Tanva/frontend/src/pages/Admin.tsx) 已经很重。

建议不要继续堆在一个文件里。

建议拆分：

- `frontend/src/components/admin/pricing-builder/PricingRuleBuilderPage.tsx`
- `frontend/src/components/admin/pricing-builder/DimensionDefinitionPanel.tsx`
- `frontend/src/components/admin/pricing-builder/MatchingRulePanel.tsx`
- `frontend/src/components/admin/pricing-builder/EvaluatorPanel.tsx`
- `frontend/src/components/admin/pricing-builder/LookupMatrixEditor.tsx`
- `frontend/src/components/admin/pricing-builder/PricingPreviewSidebar.tsx`

`Admin.tsx` 只负责：

- 路由入口
- 读取当前 model/vendor
- 调用保存接口

## 17. Kling 在通用 UI 中的演示方式

Kling 不是专用页面，但可以作为默认 demo 数据：

- 打开 Kling-2.6 时，预置 dimensions
- 自动展示一个三轴 matrix evaluator
- 运营能直观看到通用 builder 如何表达复杂规则

这有利于：

- 验证通用性
- 降低首次理解成本

## 18. 第一阶段实现边界

第一阶段建议实现：

- `dimensions`
- `matchingRules`
- `fixed / linear / lookup_matrix`
- `试算器`
- `价格一览预览`
- `保存到 vendor.pricing.version=v2`

先不做：

- 发布审批
- 版本 diff
- 回滚
- 高级公式表达式

## 19. 最终结论

通用定价规则搭建器的正确形态是：

- 左侧编辑规则结构
- 右侧即时试算和预览
- 用 `dimensions` 驱动整个 UI
- 用 `json-rules-engine` 做条件命中
- 用 Tanva evaluator 做价格求值

`Kling` 的价值是验证这套 UI 能承载真实复杂价格，而不是定义最终 UI 只能服务 Kling。
