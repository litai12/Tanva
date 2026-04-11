# 任务清单: unified_model_pricing_superpower

目录: `helloagents/plan/202604111320_unified-model-pricing-superpower/`

---

## 任务状态符号说明

| 符号 | 状态 | 说明 |
|------|------|------|
| `[ ]` | pending | 待执行 |
| `[√]` | completed | 已完成 |
| `[X]` | failed | 执行失败 |
| `[-]` | skipped | 已跳过 |
| `[?]` | uncertain | 待确认 |

---

## 执行状态
```yaml
总任务: 13
已完成: 2
完成率: 15%
```

---

## 任务列表

### 1. 现状梳理
- [√] 1.1 确认现有统一模型管理的数据入口与读写链路
  - 验证: `model_provider_mapping_v2`、`NodeConfigService`、`Admin.tsx`、`CreditsService` 已完成定位
- [√] 1.2 确认当前规格价能力边界
  - 验证: 已确认 `metadata.specPricing` 仅是 vendor 附属规则，且主消费点仍偏向 `creditsPerCall`

### 2. 领域模型升级
- [ ] 2.1 设计正式 `pricing` 结构，统一承载默认价与规格组合价
  - 验证: 支持 `defaults + rules + dimensions + multi price fields`
- [ ] 2.2 设计 `capabilitySchema/pricingDimensions` 结构
  - 验证: 不同模型可声明参与定价的规格维度与 UI 偏好
- [ ] 2.3 设计 `pricingContext` 契约
  - 验证: 前端预览和后端预扣费可共享同一个上下文

### 3. 后端落地
- [ ] 3.1 新增统一 `model-pricing-resolver` 服务
  - 验证: 可解析新 `pricing`，也可兼容旧 `creditsPerCall + specPricing`
- [ ] 3.2 将 `CreditsService.preDeductCredits()` 接入 resolver
  - 验证: 预扣费不再散落写死规则
- [ ] 3.3 增强账单审计字段
  - 验证: 能看到命中规则、价格来源、定价上下文与价格快照

### 4. 前端管理台落地
- [ ] 4.1 将“规格积分”升级为“规格定价”
  - 验证: 默认价和规则价都支持 `credits / priceYuan`
- [ ] 4.2 管理台根据模型维度声明自动选择矩阵/规则视图
  - 验证: 不再在 `Admin.tsx` 持续堆模型特例
- [ ] 4.3 增加价格预览器
  - 验证: 输入规格组合即可看到命中规则和最终价格

### 5. Flow 运行时接入
- [ ] 5.1 统一模型节点构造 `pricingContext`
  - 验证: 节点 UI 可展示当前组合规格的实时价格，而不仅是 vendor 默认价
- [ ] 5.2 运行按钮旁价格徽标升级
  - 验证: 规格切换后价格可即时刷新

### 6. 迁移与兼容
- [ ] 6.1 编写新旧配置兼容读取策略
  - 验证: 老数据不迁移也能正常运行
- [ ] 6.2 设计历史配置迁移脚本
  - 验证: 可把 `metadata.specPricing` 平滑搬到 `pricing.rules`

### 7. 文档同步
- [ ] 7.1 实施落地时同步更新 `helloagents/wiki/modules/backend-admin.md`
- [ ] 7.2 实施落地时同步更新 `helloagents/wiki/modules/backend-credits.md`
- [ ] 7.3 实施落地时同步更新 `helloagents/wiki/modules/frontend-flow.md`

---

## 执行备注

| 任务 | 状态 | 备注 |
|------|------|------|
| 1.1 | [√] | 现有数据入口为 `model_provider_mapping_v2`，管理台与预扣费均已接入 |
| 1.2 | [√] | 当前规格规则已存在，但它仍是 metadata 级补丁能力，且没有统一到多价格字段 |
