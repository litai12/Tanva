# New API 权威消费订单闭环

状态：本地源码与隔离验证；不部署、不联系真实供应商、不追改未登记的旧记录。

`ApiUsageRecord` 继续作为消费订单，个人lot和团队钱包沿原资金预留/差额结算原语。新增四个可空字段：`consumptionStatus`、`consumptionEventId`（实例名前缀与稳定事件ID唯一）、`consumptionReceipt`、`consumptionNextCheckAt`，以及消费状态/下次检查索引。迁移为 `backend/prisma/migrations/202610050002_gateway_consumption_orders/migration.sql`。不新增钱包，不把旧记录自动登记为新合同。

## 权威依据与输出分离

最终费用来自网关实际结算回执：人民币 `costCny = quota / quotaPerUnit`，乘本订单冻结的1.5倍率和100积分/元后，每个真实网关请求积分向上取整。所有金额是十进制字符串并用BigInt精确换算；usage/cache仅供审计，不再从模型响应usage生成收费事实。网关整数quota舍入后的人民币消费是此次合同的基价，例如9656/500000=0.019312元，精确2.8968积分，实际扣3积分。

消费状态为 `pending`、`settled`、`rejected`、`reconciliation_required`，与模型输出 `responseStatus` 和各入口保存的body分离。真实正文已回来时可继续工具链，即使消费仍待核对；消费已扣但正文丢失时不制造模型成功结果。此核心服务不写模型正文或输出状态。

`consumptionReceipt` 保存注册时的 `version,orderHash,gatewayInstanceId,userId,teamId,markup,creditsPerYuan,creditsReserved,registeredAt`，以及可信 `receipt,payloadHash`；结算后追加 `creditsCharged,exactCredits,exactCreditNanos`，查询失败追加受限错误码与重试次数。不保存API key、HMAC secret或Authorization。

注册和钱包预留在同一事务。通知先独立持久化可信证明，再在订单advisory锁与钱包锁内结算；账务失败回滚扣款，但证明仍在。之后仅根据原证明补账，网关暂不可用也可收敛。不允许回执切换原用户/团队、模型归属或orderHash，不向供应商重发。

## 签名与自动补偿

启用配置：后端与该Tanva New API使用相同 `TANVA_CONSUMPTION_SECRET`；`TANVA_CONSUMPTION_INSTANCE_ID` 默认 `tanva-new-api`。后端继续使用 `NEW_API_BASE_URL` 和服务端 `NEW_API_KEY` / `NEW_API_TOKEN`。上线要明确启用新协议；配置缺失只保留原兼容合同，不能宣称权威订单闭环已生效。已登记订单配置失效不会降级为响应usage扣费。

供应商请求由后端生成 `X-Tanva-Order-Id`、`X-Tanva-Order-Hash`、`X-Tanva-Timestamp`、`X-Tanva-Signature`。HMAC-SHA256文本依次为timestamp、HTTP METHOD、escaped path、orderId、orderHash、sha256(rawBody)，用换行连接，仍携带服务端Bearer。orderHash是后端原业务正文与钱包身份摘要，由网关原样留存，不由渠道映射后正文重新生成。

`POST /api/internal/new-api/consumptions` 接受 `{timestamp,payload,signature}`；payload为base64url编码UTF-8 JSON，签名为HMAC(secret, timestamp + 换行 + payload)，使用恒时比较，时间窗口±300秒。payload包含version1、稳定eventId、单调revision、订单/网关身份、model、状态、CNY金额/quota、开始/结算时间与usageEvidence。usageEvidence可为 `upstream_tokens`、`gateway_estimated_usage`、`gateway_fixed_price` 或 `unknown`；估算不是供应商真实token，不混称。重复同事件版本仅结算一次，旧版本不能覆盖终态，同版本内容冲突及终态修改拒绝。

网关必须在实际quota结算完成后持久保存消费回执与通知outbox。每次投递重新生成时间戳签名，数据库稳定eventId/revision不变。单次通知丢失由网关outbox重试和后端每分钟cron双向补偿。后端通过 `GET /v1/tanva/consumptions/:orderId` 拉同一签名envelope，使用原orderId，不重新提交模型。每批100条、并发5个、有界HTTP大小/超时及持久退避；多实例依数据库锁和唯一事件幂等。

只有明确权威 `rejected` 且quota和cost均为0，才能退回原预扣/释放团队预算。pending、not_found、HTTP失败、配置中断、超时及未知结果保留资金待核对。通用自动退款、团队过期释放也不能用模型failed覆盖登记的消费状态。个人原lot有效期与团队额度周期保持原语义。

## 服务接口与验证

`GatewayConsumptionOrdersModule` 导出 `GatewayConsumptionOrdersService`：`isEnabled()`；`register(apiUsageId,tx)`；`gatewayHeaders(apiUsageId,{method,path,rawBody})`；`getState(apiUsageId)`；`reconcile(apiUsageId)`。注册仅允许新PENDING订单；输出保存由各入口负责。controller、cron和显式恢复共同使用同一可信证明及幂等结算路径。

`cd backend && npm run test:desktop-chat` 创建隔离的localhost PostgreSQL16容器并运行消费订单、桌面协议回归，结束删除容器。新增测试覆盖签名篡改/过期、跨语言固定签名、并发Webhook仅一次扣款、真实个人lot/团队quota、正文状态独立、未知费用不退款、PG触发器造成钱包结算失败后保留证明并跨重启恢复、权威GET/cron补偿、固定价小T费用与历史排除。

设置 `TANVA_CONSUMPTION_GO_INTEGRATION=1` 可运行跨真实Go relay与本地供应商fixture、网关账务/outbox、签名HTTP回调、Nest/Fastify到真实PG钱包的额外测试。该开关仅用于本地隔离runner，不启动生产网关或发送真实供应商请求。桌面原传输源可用 `TANVA_DESKTOP_TRANSPORT_FILE=/absolute/path/to/tanvasModelTransport.ts` 同时验证。
