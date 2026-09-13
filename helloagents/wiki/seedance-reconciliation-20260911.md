# 2026-09-11 Seedance 用量对账（101）

2026-09-12 只读核验生产服务器；时间范围为 Asia/Shanghai 2026-09-11 00:00（包含）至 2026-09-12 00:00（不包含）。未修改服务器配置、账单、余额或服务。

## 结论

new-api 的 48 条任务包含 Seedance 成功 41 条、youchuan 成功 1 条、toapis 失败 6 条。Seedance 41 条按 task_id 与两站 ApiUsageRecord.requestParams.taskId 去除 newapi: 前缀后逐条匹配，正式站 6 条、测试站 35 条，未归属 0 条。

| 来源 | Seedance 成功 | 失败 | 成功积分 / 净扣 | new-api quota |
| --- | ---: | ---: | ---: | ---: |
| tanvas.cn | 6 | 19 | 18,375 | 40,000,000 |
| test.tanvas.cn | 35 | 7 | 65,400 | 175,000,000 |
| 合计 | 41 | 26 | 83,775 | 215,000,000 |

两站均使用 new-api token_id=1、token_name=tanvas，Seedance 渠道为 24 / ark-doubao。测试站 35 条均属于 w820529。正式站成功来自用户-Z3DOLQ（3 条，10,125 分）、w820529（2 条，7,500 分）、LEYANG（1 条，750 分）。

正式站积分流水：25 条 spend 合计 -78,994，19 条 refund 合计 +60,619，净扣 18,375。测试站：42 条 spend 合计 -80,550，7 条 refund 合计 +15,150，净扣 65,400。流水按当日 Seedance usage id 关联查询，不把退款时间限制在同日。

new-api Seedance consume 日志（type=2）：2.0 共 37 条、quota=185,000,000；2.5 共 4 条、quota=30,000,000。这些是网关扣费单位，不是平台积分，也不直接等于供应商真实结算成本。当前源码 QuotaPerUnit=500000，对应网关标准额度 430（正式站 80、测试站 350）；本核验不把额度直接认定为人民币。

## 证据与统计口径

- new-api PostgreSQL tasks（submit_time）与 logs（created_at），按同一个 UTC+8 自然日查询。
- 两站独立 Prisma ApiUsageRecord 与关联 CreditTransaction。
- 正式站 getApiUsageModelStats 查询本站 ApiUsageRecord.createdAt，不聚合测试站数据库。
- 示例 task_MnZOC9JkQxzX8omPYgS5ZAqdLQPzXWXv：new-api 9 月 11 日 00:45:27 提交，匹配测试站 usage a0ed348b-493c-48d2-8544-8886cb9b9465，成功 2,250 分；main-out__2026-09-12_00-00-00.log 中该任务查询的 hostname 为 test.tanvas.cn。

## 建议

两站使用独立且明确命名的 new-api 令牌；需要余额隔离时使用独立网关账号。对账同时展示环境、模型、任务 ID、网关额度、平台净扣积分，并按这些维度分别汇总。上述建议尚未实施。
