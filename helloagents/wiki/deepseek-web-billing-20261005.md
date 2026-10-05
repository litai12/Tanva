# DeepSeek 网页对话按量计费（2026-10-05）

## 最终合同

启用 `TANVA_CONSUMPTION_SECRET` 后的新合同以[网关权威消费订单](modules/backend-gateway-consumption-orders.md)为收费依据：实际人民币quota费用×1.5×100后按单ceil，usage只审计；以下token快照算法保留给未启用新协议的兼容模式。模型输出和消费结算分开，收到正文可正常返回，丢正文不能因已扣款伪装任务完成。

配置 `TANVA_CONSUMPTION_SECRET` 后启用消费订单模式：唯一最终积分为 New API 已落账人民币 `costCny ×1.5×100`，每个网关物理请求向上取整。模型 usage 与本地价格仅可作预留和审计，不重算已落账费用。签名消费回调 `/api/internal/new-api/consumptions` 与主动查询复用 `GatewayConsumptionOrdersService` 幂等结算；正文/工具输出状态与消费状态独立。未配置及历史旧回执保留下面的原计费合同，不自动迁移或改旧账。

未配置签名及历史回执的原合同：网页文本对话、提示词优化与桌面对话共用 `backend/src/desktop-chat/deepseek-pricing.ts` 的官方人民币价格快照。高峰未缓存输入/缓存输入/输出为 2/0.04/8 元每百万 token，空闲为 1/0.02/4 元；每个真实物理请求的官方成本乘 1.5，再按 100 积分兑 1 元换算，单次向上取整。不累计小数，不使用美元数值或美元汇率。

峰谷按[供应商人民币价格表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)公布的北京时间周一至周五 9–12、14–18 时段及中国假期表决定；2026 年国庆 10 月 1–7 日全天为空闲。配置冻结于实际请求开始，每个物理请求保留自己的价格快照与原始 token/cache usage。

## 入口与归属

- `POST /api/ai/text-chat` 的 DeepSeek 账号请求经过 `DeepSeekChatBillingService`，绕过原 `withCredits` 固定 30 分；既有业务安全审核与正文分别产生独立调用回执，分别按实际 usage 向上取整。非 DeepSeek 价格保持既有合同。
- 消费订单模式中，网页审核、正文与带图片对话的 Gemini 3.5 Flash 事实提取各有独立订单；订单号、模型、请求摘要及最终 serialized body 分别绑定。只有对话内部事实提取接入新子单，不重复计费已有图片生成/视频流程。
- 小T消费订单以 `AgentRuntime.run.id` 固定根身份，每次上下文续接 POST 为独立单；durable status/events 续读只取原结果，不新建消费单。新模式关闭旧成功回合直接扣 2 分，按网关最终实际金额结算。现 `.01` 元固定网关价经倍率后每单 `ceil(1.5)=2` 积分；记录 `gateway_fixed_price`，不冒充底层官方 token 成本。未配置签名时保留旧完整成功回合 2 分兼容合同。
- 普通 `AgentRuntimeService` 的聊天工具选择交给前端调用既有 text-chat，因此已覆盖；其研究草稿/关键词及媒体工作流内部调用未在本轮新增收费，避免重复计算整体产品费用。
- 明确团队请求先核验团队状态与成员，使用团队预留及成员额度；不能因团队无效或余额不足改扣个人钱包。同幂等身份的请求体摘要包含模型、团队与业务服务，不能换钱包重放。

`/api/public/ai/chat` 当前是无需认证的既有外部接口，直接调用 provider，没有可归属的用户积分账本。它与静态 API-key 免个人积分合同未在本轮突然迁移；完成用户账号计费不代表这个公开接口已实施积分扣费。后续需确认外部调用方和身份迁移合同。

## 网页价格展示

Flow 的文字对话与提示词优化节点当前都解析为 `deepseek-v4.1-flash`；HTML PPT 同样提交 `billingTag:'text_chat'`，由后端解析到该模型。三者原先通过 `useBackendCreditsPreview` 请求旧 `/api/credits/preview`，并以节点 `creditsPerCall` 兜底，可能把旧固定积分显示为真实费用。本轮停止这三节点使用该固定报价：运行按钮显示“按量”，提示按实际 token 用量、官方人民币价 ×1.5、100积分/元、每个请求向上取整。不会拿旧固定金额作运行前余额拦截；钱包资金预算仍由后端受理事务核验，HTML PPT 多次物理请求分别结算。

通用 `/api/credits/preview`、`/api/credits/pricing` 的旧数值协议本轮未扩展，它们仍服务于其他固定价业务；本次按量节点不再消费这份旧报价。公开及静态API-key入口保持原合同。消费订单模式的新最终费用取网关落账金额，官方单价与本地 token 计算仅作为成本参考/预留，不能替代最终回执。

## 小T供应商合同核实

本机独立 TapCanvas-pro 源码 `apps/hono-api/src/modules/task/public-openai-compat.ts` 的 `buildUsage` 明确把 `prompt_tokens` 写成 0，把 `completion_tokens/total_tokens` 写成该服务已扣积分，读数失败还会写 0。这不是底层 DeepSeek token；其 `computeConsumedCredits` 来自会话 quota，并可能包含内部工具成本。该旧值不能按 DeepSeek 价格再计算一次。Tanva 此次仅读取该独立项目源码，没有修改或部署它。

本轮不改该独立上游。小T消费订单直接采用网关 `.01` 按次费用，绕过伪 token；这闭合 Tanva 到 New API 的实际消费结算，但不代表已根治 façade 内多次底层模型与工具成本计量。未来若迁移底层官方 token 成本，仍需逐物理模型请求清单和工具费用归属。

## 回执与失败

共享服务保存 `ApiUsageRecord.requestParams.deepseekBilling`：请求摘要、价格快照、预留依据、分类 usage、精确金额及实际整数积分。所有成功结算复用现有个人批次返差和团队预留结算原语，保留实际扣费历史。

订单模式中，结果保存 `outputStatus/response`，消费列保存权威回执与结算状态。已知正文及宿主工具成功照常交付，费用暂慢通过独立 `metadata.billingOrders` 表示；输出失败但网关实际消费仍需结算。HTTP 202/5xx、缺失 usage 或正文失败不能决定退款，未知只查询原订单。已注册单不能因签名配置故障变为未签名提交；签名信息仅在 HTTP header，不进入模型 body。

重复同一已完成请求重放保存的响应，不重新调用模型或再次扣费。已知响应遇到账务失败保留原结果；再次查看同一身份只尝试结算原结果。HTTP 202、断流、缺失 usage、5xx 等未知付费结果留为 `reconciliation_required`，不自动退款或重新发起供应商操作。只有明确供应商拒绝才在同一事务标为失败并退回原预留。用户自行新建重试保持独立身份；本轮不部署、不重跑、不修改旧线上账本。

## 证据

原桌面样本输入 18,171、输出 285、缓存 0；国庆空闲官方成本为 0.019311 元，乘 1.5 后 0.0289665 元，换算 2.89665 积分，按最终规则应扣 3 分。原执行确实扣 30 分，原回执保留，未自动回溯改账。

本机验证包括：共享服务真实 usage/cache 提取、回执重放不重复提交、同身份不能切换钱包、团队结算边界、缺失 usage 与 202/5xx 保留预留、明确 402 拒绝退款与退款失败恢复；网页直连路由/202 合同及小T旧固定价回归通过。该证据不代表新的线上计费已部署或完成再次付费验证。

共享服务可用 `cd backend && npm run verify:deepseek-chat-billing` 复验。网页展示改动已通过 `cd frontend && npm run build`；HTML PPT 按量提示加入后再执行 `npx tsc -b --pretty false` 通过。四个相关组件的 ESLint 除 HTML PPT 原有非组件导出规则错误外通过，原 HEAD 可复现同一错误；不改动本次计价无关的导出结构。
