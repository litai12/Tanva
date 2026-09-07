# 历史邀请积分消费归属矫正

## Analyze

生产排查发现两名指定用户的旧 REFERRAL_REWARD 流水没有 creditLotId。消费优先扣有效批次，旧奖励落入最后的 legacy balance；每日衰减却按旧奖励原额减 expiredAmount 计算，成功消费没有同步消耗奖励剩余额度。生产批次排序也不是严格免费优先，本次不能描述成全局算法修复。

## Design

选择用户授权的“矫正数据”路径，仅处理指定两账户。要求所有待处理奖励发放之后、首次对应衰减之前，有足够的成功且未退款消费；只从 legacy balance 或未过期充值批次改归属，不挪用其他免费批次。无足够证据、混合衰减、重复衰减、计数不符、超额恢复均拒绝。

## Develop / verification

- 工具：backend/scripts/reconcile-legacy-referral-credits.cjs，默认 dry run；apply 需匹配预览 SHA-256，serializable 事务及账户行锁，服务器 0600 原始快照，确定性审核流水 ID 保证幂等。
- 为旧奖励创建已耗尽 gift 批次、关联原奖励与成功消费；保留原消费金额及余额前后值，原扣减来源保留在 metadata 与备份。保留原衰减流水，新增 credit_reconciliation 返还流水。totalEarned/totalSpent 不因来源重分配或衰减返还变动。
- 两账户分别消费归属矫正 1,500 / 500 分，返还误衰减 250 / 350 分。第二账户恢复原充值批次 50 + 450 分；这是消费来源置换，不再额外增加账户余额 500 分。
- 提交后核验余额、奖励耗尽状态、改归属消费金额守恒、免费衰减池为零；重复运行返回 already_reconciled，未重复退款。
- 回归：node backend/scripts/test-reconcile-legacy-referral-credits.cjs，覆盖成功消费归属、充值恢复、legacy 来源，以及不足/未成功/已退款/时间不符/重复衰减/超额恢复拒绝。
- 生产备份：/www/wwwroot/tanvas.cn/backend/credit-repair-backups/legacy-referral-consumption-v1-8f41209a1bd7de7d09361ae6f4a795626da78ae10554cacade1154cb352179e7.json。含个人账务信息，仅服务器留存，不提交仓库。

## Scope

未修改全站消费排序、未批量修复其他用户、未对历史“充值翻倍”gift 分类及既有 850/250 分流水差异作无证据调整。当前新邀请奖励发放代码已创建 gift 批次；其他未分批次历史奖励及通用免费优先排序仍需独立审计/修复。本次结论仅为指定两用户旧邀请奖励已正确归属消费，不再因这几笔奖励衰减。

## 后续：用户要求本地逻辑修复

已在本地加入免费批次优先的不变量、四个个人消费入口的旧奖励迁移、衰减入口迁移及旧流水直接衰减分支移除。余额内迁移不等于历史账务审计：不确定的旧奖励只优先消费，不自动衰减或返还历史扣款。新增实际衰减服务与消费/退款回归，后端构建通过。此后续代码尚未部署；上文 Scope 描述前一步生产数据矫正的范围。
