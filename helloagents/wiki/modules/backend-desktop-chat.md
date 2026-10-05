# Tanva 独立桌面对话与积分（2026-10-05）

状态：实现及本机隔离 PostgreSQL / Nest HTTP 验证通过；未部署，未请求生产付费模型，未完成桌面截图真实端到端任务。

## 身份、模型与真实价格

独立 `tanvas-desk` 只使用本站 `/api/auth/desktop/*` 授权所得 HttpOnly Cookie。`DesktopChatModule` 明确导入 `AuthModule`，复用 `JwtAuthGuard` / `JwtStrategy`；账号状态及团队成员资格以数据库当前记录为准，不读取享语 token 或钱包，不引入第二份余额。

默认允许 `deepseek-v4.1-flash`。视觉与工具声明源于 `new-api/patches/2026-09-16/001-add-deepseek-official-v41-flash.sql` 的 `text,vision,tool_calls`，Chat Completions DTO 由 `new-api/relay/channel/deepseek/adaptor.go` 完整透传。目录运行期检查 `NEW_API_KEY` / `NEW_API_TOKEN` 及只读 `/v1/models`，不可用明确 `available=false`。该本地注册证据不等于已验证生产供应商行为。此路线没有确认可接受的 reasoning_effort 值，目录返回空数组；不宣称 native streaming 支持。

零售积分复用 `CreditsService.previewCredits` 与现有 DeepSeek 覆盖价：当前 **每次模型请求 30 积分**，工具回传后的下一次模型调用是另一笔；不是每条消息、整段对话固定30，不伪造输入/输出 token 单价。请求冻结价格，实际 usage 保留供审计。后台既有来源消费排序、批次过期和退款规则继续由 `CreditsService.deductExact/refundCredits` 执行。

## API

所有路径以 `/api/desktop/v1` 开头，Cookie 鉴权；读写回执返回 `Cache-Control: no-store`。

| 方法/路径 | 返回 |
|---|---|
| GET `/billing` | `{scope,balance,availableCredits,frozenCredits,unit:'credits',canCharge,wallets}` |
| GET `/models` | `{models:[{id,name,available,supportsTools,supportsVision,reasoningEfforts:[],streaming:false,pricing:{unit:'call',creditsPerCall,currency:'credits'}}]}` |
| GET `/billing/receipts?taskId=&conversationId=` | `{receipts:[...]}`，当前用户个人/团队历史均保留，最多最新100笔 |
| POST `/chat/completions` | 完整 Chat Completions JSON（tools、reasoning、usage、finish_reason）与 `tanvaReceipt` |
| GET `/chat/requests/:requestId` | 回执；完成时含原完整 `response`；已获得真实成功结果的未结算记录只重试原记账 |

`X-Tanva-Team-Id` 省略为个人，显式团队必须为非 personal / active 团队及实时成员；非法团队绝不回退个人。POST 必须携带 `Idempotency-Key`、`X-Tanva-Task-Id`、`X-Tanva-Conversation-Id`。三个ID各限128字节ASCII可标识字符。POST体保留完整多轮消息、工具定义和图像 URL/内联运行期输入，限制4 MiB；本机文件路径须由桌面先转可提交素材，不能宣称服务端能读本机文件。模型 allowlist、stream=false 与未声明 reasoning 参数在计费之前校验。模型目录/回复采用流式读取2/8 MiB上限及有界取消，不先全量读入再检查。

回执字段：`requestId,apiUsageId,taskId,conversationId,model,scope,status,creditsCharged,creditsReserved,unit,createdAt,completedAt?,errorCode?,response?`，金额非负整数，时间ISO字符串。scope 为 `{kind:'personal'}` / `{kind:'team',teamId}`。

重复原key：completed重放原JSON；pending / reconciliation_required返回409 `{code:'TANVA_REQUEST_PENDING',receipt}`；已确认失败返回409 `TANVA_REQUEST_FAILED`。相同key但正文/扣费scope/任务/对话不同，409 `TANVA_IDEMPOTENCY_CONFLICT`。GET任何状态返回200。钱包切换只作用于桌面后续任务快照，不改变旧账单scope。

## 原子性、恢复与失败

无需新增表或迁移。`ApiUsageRecord.id` 已是数据库主键；新记录使用 `desktop-chat:` + SHA256(userId,requestId) 为唯一身份，正文与scope/任务归属的规范JSON哈希另存 `requestParams.desktopChat.bodyHash`。受理事务先拿 PostgreSQL事务 advisory lock，再复查主键，再在同一事务内调用现有个人积分扣费或团队预留及保存回执，失败全部回滚。费用服务只增加可选外部事务参数，未创建另一个钱包。个人 pending已扣、团队 pending仅预留；成功回执与团队确认扣除同一事务提交。团队余额广播复用TeamCreditsPublisher，并在外部事务提交后发送，回滚不提前广播。

服务端不会因桌面客户端关闭连接而取消已受理工作，不自动重发供应商请求。收到明确拒绝的400/401/402/403/404/405/413/415/422/429才原子记录失败并恢复个人批次/释放团队预留；408、409、425、5xx、断线、读取超时、空/不完整工具回复、SSE合同不匹配与保存失败均保留原费用/预留待核对。原key不因年龄或失败而重用。用户明确另发新尝试须由桌面给新scope/key；不可把原请求对账误作自动重跑。

已取得有效完整成功回复但团队结算/回执事务失败：另一事务保存 `knownResponse` 为 reconciliation_required；之后GET或原POST重复只重试原钱包结算，成功后重放原回复，不再发供应商请求。已确认上游拒绝但退款事务失败，同样保存拒绝证据，后续只重试原退款，不再调用供应商。若数据库连保存knownResponse都失败，或进程在受理提交到发送/收回复/存回执之间崩溃，没有可信供应商查询接口，此时保守保留费用/团队预留；deadline后展示reconciliation_required，必须按原请求身份人工核对，不能按超时退款。现有供应商没有可用的请求状态查询协议，不能宣称该未知窗口可自动恢复。团队预留过期cron只释放实际FAILED用量，未知仍保留。

## 验证与配置

macOS arm64，本机Docker PostgreSQL16，实际Prisma schema与CreditsService/TeamCreditLedger，仅HTTP模型上游为fixture：

- `cd backend && npm run test:desktop-chat`：自动创建只绑定127.0.0.1的无volume临时容器、db push真实schema、执行测试、finally删除容器。
- `cd backend && npm run build`。
- `TANVA_DESKTOP_TRANSPORT_FILE=/absolute/path/to/tanvas-desk/apps/desktop/src/main/tanvasModelTransport.ts npm run test:desktop-chat`：另验证真实桌面传输源代码 → Cookie Nest/Fastify → PostgreSQL，全身份/金额/tools/usage合同及重复仅一次POST；临时ESM编译后清理，不修改桌面源码。
- 测试包括8并发同key仅一模型提交/一次扣费，签到/充值批次消费退款、工具/视觉/usage完整回执、重启重放、正文/团队冲突、未知409/425/503/空回复/断线、团队预留确认/释放/成员quota原子回滚、个人余额竞争、PG trigger真实结算失败与只补账恢复、流读取超限与取消。
- 同一套真实Nest/Fastify Controller + JwtAuthGuard/JwtStrategy以Cookie（无Bearer）验证models/billing/completion/receipt/list200、未登录401、冲突/未知409和完整多轮工具JSON。

上线前需自行部署本后端，配置正确 `DATABASE_URL`、桌面授权用 `REDIS_URL`、JWT/Cookie站点设置、可用 `NEW_API_BASE_URL` 和 `NEW_API_KEY`；`/v1/models`必须提供本型号。还需真实截图+工具模型调用、个人/团队到账及生产异常对账验收。未调用生产付费API，也未部署。

helloagents约定的ai-metadata-sync工具在本机目录不存在；已手工核对schema主键、模型注册能力、价格覆盖和模块导入，未声称运行metadata同步。
