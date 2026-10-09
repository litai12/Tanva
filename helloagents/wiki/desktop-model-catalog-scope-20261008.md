# 桌面模型目录的签名结算范围（2026-10-08，已上线）

桌面动态模型目录依赖消费签名配置。`TANVA_CONSUMPTION_SCOPE=desktop` 将新签名订单限定为独立桌面对话；网页 DeepSeek、小T及其他原业务保留原计费模式。未设置范围时维持原有全局签名行为，未设置 `TANVA_CONSUMPTION_SECRET` 时维持旧模式。

`GatewayConsumptionOrdersService.isEnabled()` 继续表示签名凭据可用，后台补偿、原订单查询及 webhook 不被范围开关关闭。`isWebEnabled()` 只影响新网页订单的受理；`register()` 先保留已有消费订单，随后拒绝在 desktop 范围为非桌面请求注册新订单。历史回执仍按原合同恢复。

本机已通过 `cd backend && npm run build` 和 `npm run verify:deepseek-chat-billing`。隔离 PostgreSQL 的消费订单测试增加新网页订单不注册、既有网页订单在 desktop 范围仍可结算的断言；动态桌面 HTTP 回归以 desktop 范围运行，核验网页签名模式未被开启。

生产只读核实：Nest 源文件及已编译产物已有动态目录，消费订单四字段已存在；两端签名配置均未设置。new-api 的公共报价有 22 个对话渠道报价，但鉴权 `/v1/models` 仍因只识别旧全局价格而遗漏其中 18 个，新旧目录交集只有 4 个。网关目录修复由用户另一个聊天负责，本次不替换其产物。

最小 Nest 发布只涉及 `src/consumption-orders/gateway-consumption-orders.service.ts`、`src/ai/services/deepseek-chat-billing.service.ts` 及其编译文件。私有环境为后端和 new-api 设置相同签名凭据、相同 instance，后端另设置 `TANVA_CONSUMPTION_SCOPE=desktop`；按现有 PM2 配置更新后端，并仅更新 new-api 容器环境。不得为此运行全量 `new-api-patch` 或补丁 `002`。源码、运行产物及环境须先备份；完成目录与签名只读验证后才能记录为已上线。

以上为上线前记录；实际发布结果见下节。尚未进行真实付费推理验收。


## 2026-10-08 17:52（Asia/Taipei）生产切换完成

- 用户明确授权修改线上使桌面模型生效。发布前实测 `/api/desktop/v1/models` HTTP 200，仅 1 个模型；现有 new-api 网关已由另一轮修复为 93 个模型，其中鲁班 22 个完整可见。
- 再次运行 `npm run verify:deepseek-chat-billing` 和 `node scripts/test-desktop-chat.cjs` 均通过；后者在独立 PostgreSQL 16 中验证消费订单、旧桌面及 dynamic Cookie HTTP 场景，无真实模型调用。
- 核对两份 TS 与四份 JS/d.ts 候选文件哈希一致；只部署这两个模块，未全量覆盖后端 dist。服务器原件及私有环境备份：`/opt/tanva-backups/desktop-models-20261008095146/`，环境备份权限 0600。
- 生产两端原消费签名为空。通过服务器随机生成共享密钥并原子写入私有后端环境文件，双方 instance 一致，Nest 限定 `TANVA_CONSUMPTION_SCOPE=desktop`。密钥未写入源码、Git、命令输出或发布清单。
- 暂停 BullMQ 图片队列领取新任务，保留受理及排队，等待现有任务自然完成。模型 pending、图片 processing、视频活动及 image active 均归零后执行发布；无任务取消或重新提交。部署/验证结束后已恢复队列。
- 仅重建 new-api 环境并 PM2 reload 后端；保留网关镜像 `sha256:57883fc124831a7aee34c1c84cbf2b0487474267148135b3c10e06d9599070de`，没有重新编译网关、执行 SQL 或运行 new-api-patch / 002。
- 用内存中生成的短时鉴权令牌实测公网桌面接口：HTTP 200，`models`/`data` 返回 **22 个鲁班模型**。签名有效的不存在订单查询返回 404 `tanva_order_not_found`；篡改签名返回 401，证明共享签名校验生效且未创建消费订单。容器 healthy，后端健康 200，队列暂停状态 false。
- 发布和验证回执：服务器 `/opt/tanva-releases/desktop-models-20261008/deployment-result.json`。网页新请求仍采用原计费模式，历史签名订单恢复入口保持可用。本次验证目录和鉴权链路，不声明已逐模型进行真实付费推理。
