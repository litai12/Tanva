# 年卡积分分期发放修复（2026-10-08）

## 问题与原因

新版分期年卡正常支付开通会生成 `membership_grant` 首期流水，并固化 `annualCycleStartAt`、`annualInstallmentIndex=1` 与 `annualInstallmentCount=12`。自动刷新原先只读取 `membership_yearly_installment` 和 `membership_admin_change`，漏掉真实支付首期；随后又因发现 `membership_grant` 而将该订阅误判为历史一次性发全年积分，导致后续各期一直跳过。

## 修复后的行为

- 自动刷新、账户锁内复查、管理员下一期发放、分期展示与剩余价值抵扣共用五种发放业务类型：`membership_grant`、`membership_yearly_installment`、`membership_cycle_switch`、`membership_upgrade_prorated`、`membership_admin_change`。
- 仍以当前订阅 ID、周期开始时刻和期号识别已发积分，其他周期或订阅的记录不参与当前期去重。旧版没有分期标签、且有原一次性首期流水的年卡保持跳过。
- 每日 4 点按策略刷新周期（默认 30 天）计算应到期数；可补齐多个历史漏期，最多 12 期，末期补齐取整余数。默认 9 月 2 日开通的第二期在 10 月 2 日达到到期条件，由之后的定时扫描入账；发放批次到期日仍为会员周期结束日。
- 自动补发在账户锁内重新检查期号。管理员显式发下一期也先锁账户再确定期号，与定时任务共用串行顺序；连续两个手动操作仍可分别提前发两期，不重复发同一期。
- 无数据库结构或历史流水改写。本次修复上线后的常规定时任务会处理符合条件的到期漏期；需要立即对账时可使用既有管理员全量刷新入口 `POST /api/admin/membership/ops/refresh-yearly-quota`。

## 验证

- `cd backend && npm run verify:membership-yearly-installments`：实际调用 `MembershipService`，使用隔离内存账本与模拟账户锁；覆盖五类真实首期、旧版无标签保护、重复运行、周期/订阅隔离、锁前锁后去重一致性、30 天到期边界、多期补齐、12 期上限与余数、手动并发及手动与定时任务竞争。
- 将同一回归加载修复前的服务源码，首个正常支付场景出现 `0 !== 200`，证明测试可捕获本次漏发；修复后通过。
- `cd backend && npm run verify:membership-cycle`、`npm run verify:membership-coverage-upgrade` 与 `npm run build` 通过。

## 101 生产补发

- 已定向替换会员服务源码与对应编译产物。执行真实服务前保存备份与预演回执，目录为 `/opt/tanva-backups/yearly-installments-20261008/`。
- 扫描 29 个生效年卡订阅，事务回滚预演核验后正式补齐 2 户、2 期，共 29,350 分。用户反馈的账号补发 7,350 分，余额由 140 变为 7,490；另一户补发 22,000 分，余额为 26,300。
- 正式执行后再次刷新，新增批次与积分均为 0，已核验本次补发幂等。
- 用户随后明确要求“本地修改就好，我来部署”，已停止全部服务器操作。此前因图片任务正在运行，两次重载前检查均退出，未执行 PM2 reload；对应文件已替换，但常驻进程仍运行旧代码。后续部署、重载与健康验收由用户接手，不再自动续跑。已提交的补发流水保持原样。
- 本地 AI Metadata 同步命令已尝试，但配置的 `~/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs` 不存在，未完成该辅助同步。
