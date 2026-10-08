# Tanva 独立桌面对话与积分（2026-10-05）

> 2026-10-08 本地更新：签名消费模式的桌面模型目录改为 new-api 实时可用 ID 与明确 chat/渠道价格的交集；新订单不预冻结，按最终 CNY × 100 积分结算，不再追加 1.5 倍。返回 `data` 和 `models` 兼容客户端；历史回执仍按原合同恢复。未配置签名的路径保留下文 DeepSeek 兼容行为，不向新模型套用旧价格。渠道仅启用鲁班对话能力、官价单倍率默认 0.4，部署范围与验收见 [鲁班渠道说明](../lluban-chat-channel-20261008.md)。

状态：旧固定价版本已由用户部署并实测一次。2026-10-05 本次按量计费修正仅改本地源码，不部署、不自动重跑，也不追改旧回执或生产积分。桌面截图真实端到端任务仍未验收。

后续新增[网关权威消费订单闭环](backend-gateway-consumption-orders.md)：配置 `TANVA_CONSUMPTION_SECRET` 后以网关实际quota人民币费用结算，模型输出与账单状态分离，签名通知和cron补偿不依赖此次模型HTTP响应。下文usage快照收费为未启用新协议的兼容模式；新合同需部署消费字段迁移和两端通知/查询协议，不能仅部署一端即声称生效。

## 身份、模型与真实价格

独立 `tanvas-desk` 只使用本站 `/api/auth/desktop/*` 授权所得 HttpOnly Cookie。`DesktopChatModule` 明确导入 `AuthModule`，复用 `JwtAuthGuard` / `JwtStrategy`；账号状态及团队成员资格以数据库当前记录为准，不读取享语 token 或钱包，不引入第二份余额。

默认允许 `deepseek-v4.1-flash`。视觉与工具声明源于 `new-api/patches/2026-09-16/001-add-deepseek-official-v41-flash.sql` 的 `text,vision,tool_calls`，Chat Completions DTO 由 `new-api/relay/channel/deepseek/adaptor.go` 完整透传。目录运行期检查 `NEW_API_KEY` / `NEW_API_TOKEN` 及只读 `/v1/models`，不可用明确 `available=false`。该本地注册证据不等于已验证生产供应商行为。此路线没有确认可接受的 reasoning_effort 值，目录返回空数组；不宣称 native streaming 支持。

新请求按[DeepSeek官方人民币单价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)计算真实输入缓存命中／未命中与输出用量。遵循用户最终明确选择的**官方人民币价 ×1.5 ×100积分/元**，不使用美元价或展示汇率7.3，也不直接拿new-api静态峰值quota当官方费用。Flash高峰输入未命中/缓存命中/输出每百万token为¥2/¥0.04/¥8，低峰为¥1/¥0.02/¥4。

高峰为UTC周一至周五01:00–04:00和06:00–10:00，且北京时间日期不是中国公共假期；其余时间低峰。2026假期日历采用[国务院公布通知](https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html)，补班周末仍低峰。日历可注入，未知年份报价明确失败，不默认高峰。请求冻结价格、UTC时间、日历版本和零售倍率。

受理按保守未命中输入预算和输出上限预扣/预留；纯文字按UTF-8字节及消息框架估计、图像用官方1M上下文上限；显式max_tokens/max_completion_tokens保持原值，省略时用官方384K输出最大值仅计算资金预算，绝不注入截短参数。预算收据清楚列出，最终实际usage退回差额；它不是固定零售价。

用户最终要求**每个物理模型请求向上取整**：按官方实际token费用×1.5×100得到精确积分，再ceil为该请求实际扣款，不跨请求累计余数，不新增钱包字段或迁移。精确值以decimal字符串留在回执供对账。个人差额从原预扣lot尾部恢复，实际费用保留最高优先级来源；已过期赠送lot按原有效期立即失效，不延长权益。团队同时释放全部原冻结额并将成员额度改为真实扣费；跨额度周期结算按实际费用计入新周期，失败释放不误减新周期其他用量。结算、流水与回执在同一事务内提交。

实测样本18171输入、285输出、缓存0，国庆低峰官方费用¥0.019311，零售费用¥0.0289665，精确费用2.89665积分、实际扣款3积分；历史30积分回执仍原样保留，不由本改动退款。

## API

所有路径以 `/api/desktop/v1` 开头，Cookie 鉴权；读写回执返回 `Cache-Control: no-store`。

| 方法/路径 | 返回 |
|---|---|
| GET `/billing` | `{scope,balance,availableCredits,frozenCredits,unit:'credits',canCharge,wallets}` |
| GET `/models` | `{models:[{id,name,available,supportsTools,supportsVision,reasoningEfforts:[],streaming:false,pricing:{unit:'token',priceCurrency:'CNY',rounding:'ceil',markup:1.5,creditsPerYuan:100,inputCnyPerMillion,cachedInputCnyPerMillion,outputCnyPerMillion,period,pricingVersion,currency:'credits'}}]}` |
| GET `/billing/receipts?taskId=&conversationId=` | `{receipts:[...]}`，只读列出当前用户个人/团队历史，最多最新100笔；不会触发补账恢复 |
| POST `/chat/completions` | 完整 Chat Completions JSON（tools、reasoning、usage、finish_reason）与 `tanvaReceipt` |
| GET `/chat/requests/:requestId` | 回执；完成时含原完整 `response`；已获得真实成功结果的未结算记录只重试原记账 |

`X-Tanva-Team-Id` 省略为个人，显式团队必须为非 personal / active 团队及实时成员；非法团队绝不回退个人。POST 必须携带 `Idempotency-Key`、`X-Tanva-Task-Id`、`X-Tanva-Conversation-Id`。三个ID各限128字节ASCII可标识字符。POST体保留完整多轮消息、工具定义和图像 URL/内联运行期输入，限制4 MiB；本机文件路径须由桌面先转可提交素材，不能宣称服务端能读本机文件。模型 allowlist、stream=false 与未声明 reasoning 参数在计费之前校验。模型目录/回复采用流式读取2/8 MiB上限及有界取消，不先全量读入再检查。

回执保留`requestId,apiUsageId,taskId,conversationId,model,scope,status,creditsCharged,creditsReserved,unit,createdAt,completedAt?,errorCode?,errorMessage?,upstreamStatus?,response?`。错误诊断仅含服务端安全枚举与固定中文说明，`upstreamStatus` 为原HTTP整数状态码，不保存上游裸消息、错误body、地址或凭据。新回执追加billing：mode、snapshot、reservation、markup、creditsPerYuan、priceCurrency、rounding:'ceil'、period、pricingVersion；成功时有officialCostCny/exactCredits十进制字符串、exactCreditNanos整数字符串及usage={inputTokens,cachedInputTokens,outputTokens}。上游X-Oneapi-Request-Id经白名单保存为billing.upstreamRequestId。新pending个人/团队均creditsCharged=0、creditsReserved=原预算；成功creditsCharged为实际整数、reserved=0，未知保留预算。旧无billing回执沿原语义。时间ISO字符串。scope 为 `{kind:'personal'}` / `{kind:'team',teamId}`。

重复原key：completed重放原JSON；pending / reconciliation_required返回409 `{code:'TANVA_REQUEST_PENDING',message,receipt}`。已确认失败返回 `{code:'TANVA_REQUEST_FAILED',message,receipt}`，HTTP按安全诊断映射：参数400/422→422，超大413→413，限流429→429；上游鉴权401/403、额度402、型号404、协议405/415及旧无细节失败→502。上游401不变成Tanva账号401，避免错误登出。已核实的Flash价格配置未同步错误严格识别固定字符串，映射 `UPSTREAM_PRICING_NOT_CONFIGURED`、HTTP502、`upstreamStatus:400`，提示管理员同步价格配置。错误body读取最多16KiB/2秒，除精确白名单code或已核实固定字符串外仅按HTTP归类，绝不转发原文。首次失败和原key失败重放保持同一诊断及请求身份，不再提交模型。相同key但正文/扣费scope/任务/对话不同，409 `TANVA_IDEMPOTENCY_CONFLICT`。GET任何状态返回200。钱包切换只作用于桌面后续任务快照，不改变旧账单scope。

## 原子性、恢复与失败

无需新增钱包、表、字段或迁移。`ApiUsageRecord.id` 已是数据库主键；新记录使用 `desktop-chat:` + SHA256(userId,requestId) 为唯一身份，正文与scope/任务归属的规范JSON哈希另存 `requestParams.desktopChat.bodyHash`。受理事务先拿 PostgreSQL事务 advisory lock，再复查主键，再在同一事务内调用现有个人积分扣费或团队预留及保存回执，失败全部回滚。费用服务只增加可选外部事务参数，未创建另一个钱包。个人pending已预扣预算、团队pending仅冻结预算；成功原子退回个人差额或释放团队预算并扣实际整数。两者均将按次ceil整数扣款与成功回执同事务提交。缺失输入/输出或缓存证据、计数冲突不能虚构0缓存成功扣费，保留原结果/预算待对账。团队余额广播复用TeamCreditsPublisher，并在外部事务提交后发送，回滚不提前广播。

服务端不会因桌面客户端关闭连接而取消已受理工作，不自动重发供应商请求。收到明确拒绝的400/401/402/403/404/405/413/415/422/429才原子记录失败并恢复个人批次/释放团队预留；408、409、425、5xx、断线、读取超时、空/不完整工具回复、SSE合同不匹配与保存失败均保留原费用/预留待核对。原key不因年龄或失败而重用。用户明确另发新尝试须由桌面给新scope/key；不可把原请求对账误作自动重跑。

已取得有效完整成功回复但团队结算/回执事务失败：另一事务保存 `knownResponse` 为 reconciliation_required；之后GET或原POST重复只重试原钱包结算，成功后重放原回复，不再发供应商请求。已确认上游拒绝但退款事务失败，同样保存拒绝证据，后续只重试原退款，不再调用供应商。若数据库连保存knownResponse都失败，或进程在受理提交到发送/收回复/存回执之间崩溃，没有可信供应商查询接口，此时保守保留费用/团队预留；deadline后展示reconciliation_required，必须按原请求身份人工核对，不能按超时退款。现有供应商没有可用的请求状态查询协议，不能宣称该未知窗口可自动恢复。团队预留过期cron只释放实际FAILED用量，未知仍保留。

## 验证与配置

macOS arm64，本机Docker PostgreSQL16，实际Prisma schema与CreditsService/TeamCreditLedger，仅HTTP模型上游为fixture：

- `cd backend && npm run test:desktop-chat`：自动创建只绑定127.0.0.1的无volume临时容器、db push真实schema、执行测试、finally删除容器。
- `cd backend && npm run build`。
- `TANVA_DESKTOP_TRANSPORT_FILE=/absolute/path/to/tanvas-desk/apps/desktop/src/main/tanvasModelTransport.ts npm run test:desktop-chat`：另验证真实桌面传输源代码 → Cookie Nest/Fastify → PostgreSQL，全身份/金额/tools/usage合同及重复仅一次POST；临时ESM编译后清理，不修改桌面源码。
- 测试包括8并发同key仅一模型提交/一次扣费，签到/充值批次消费退款、工具/视觉/usage完整回执、重启重放、正文/团队冲突、未知409/425/503/空回复/断线、团队预留确认/释放/成员quota原子回滚、个人余额竞争、PG trigger真实结算失败与只补账恢复、流读取超限与取消。
- 同一套真实Nest/Fastify Controller + JwtAuthGuard/JwtStrategy以Cookie（无Bearer）验证models/billing/completion/receipt/list200、未登录401、冲突/未知409和完整多轮工具JSON。
- 桌面诊断回归覆盖十类明确4xx的HTTP/安全code/message映射、签名拒绝及Flash计价配置专门提示、敏感错误body不返回/不落库、首次与重放同原身份且只调用一次、Fastify上游401映射502而保留Tanva登录。费用与退款语义沿现有原单协议；签名消费模式不因模型HTTP拒绝绕过权威消费证明退款。本轮诊断代码仅本地修改，未部署、未新发付费请求。
- Flash计价错误匹配允许已核验的标准 ` (request id: ID)` 后缀，ID严格限 `[A-Za-z0-9_.:-]{1,128}`，完整字符串锚定；裸句与合法后缀均识别，前后追加文本、含空格或超长ID不识别专门诊断。指定真实桌面传输源码的隔离集成还覆盖价格配置502、参数422、安全message/code/receipt_failed传递、已失败原请求重放不重复调用供应商及不进入pending轮询；测试只读桌面源码，不修改桌面或访问生产模型。

上线前需自行部署本后端，配置正确 `DATABASE_URL`、桌面授权用 `REDIS_URL`、JWT/Cookie站点设置、可用 `NEW_API_BASE_URL` 和 `NEW_API_KEY`；`/v1/models`必须提供本型号。还需真实截图+工具模型调用、个人/团队到账及生产异常对账验收。本次修正没有调用额外生产付费API，没有部署；主任务保留原唯一实测记录作为旧版本证据。

helloagents约定的ai-metadata-sync工具在本机目录不存在；已手工核对schema主键、模型注册能力、价格覆盖和模块导入，未声称运行metadata同步。
