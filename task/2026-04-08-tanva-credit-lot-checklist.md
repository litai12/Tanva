# Tanva 多形态积分 V2 Checklist

**本轮目标：** 打好多形态积分基础层，不一次性替换全部线上扣费逻辑。

## 1. 文档

- [x] 补充多形态积分 V2 技术方案
- [x] 明确生命周期状态机
- [x] 明确扣减优先级规则
- [x] 明确本轮编码边界

## 2. Schema

- [x] 新增 `CreditLot`
- [x] 新增 `CreditConsumePolicy`
- [x] 给 `CreditAccount` 增加 `creditLots` relation
- [x] 给 `CreditTransaction` 增加 lot / policy 审计字段

## 3. 代码

- [x] 新增 credit lot 类型定义
- [x] 新增 consume policy 类型定义
- [x] 新增可用 lot 过滤函数
- [x] 新增 lot 排序函数
- [x] 新增 lot 扣减规划函数
- [x] 提供默认全局策略
- [x] 接入充值成功 -> permanent lot 发放
- [x] 接入管理员补发 -> permanent lot 发放
- [x] 接入新用户注册赠送 -> promo permanent lot 发放
- [x] 接入每日签到 -> fixed_window / permanent lot 发放
- [x] 接入 hybrid lot 扣减与 lot 级退款恢复
- [x] 支持从 `CreditConsumePolicy` 读取全局默认策略，缺失时回退内置策略

## 4. 测试

- [x] 测试：过期 lot 不参与扣减
- [x] 测试：membership_bound 优先于 fixed_window
- [x] 测试：同生命周期内快过期优先
- [x] 测试：permanent 最后扣
- [x] 测试：余额不足时报错
- [x] 测试：hybrid lot + legacy balance 扣减
- [x] 测试：lot 扣减后可按原 deductions 恢复
- [x] 测试：持久化 consume policy 记录可正确 hydrate / fallback

## 5. 验证

- [x] 测试脚本先失败
- [x] 实现后测试脚本转绿
- [x] `npm run build` 通过
- [x] 同步 helloagents wiki
