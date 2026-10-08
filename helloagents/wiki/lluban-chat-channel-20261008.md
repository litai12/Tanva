# 鲁班对话渠道（2026-10-08，本地待部署）

## 范围与来源

目标是 Tanvas 的 `t-api.tanvas.cn`，源码 `new-api/`、构建入口 `backend/docker-compose.yml`。新增 `lluban-chat`，上游为 `https://tt-api.lluban.com`，type=1，复用 OpenAI Chat Completions 及既有 streaming 处理。两个服务独立，不把上游添加到它自己。

导入范围为本轮授权密钥 `/v1/models` 与上游 `/api/pricing` 启用 default 分组、`model_kind=chat` 的交集，共 22 个原始模型 ID。图片、视频、embedding、未分类型号和不可访问型号不导入；不创建模型别名。其他渠道中可识别的对话模型能力由独立补丁停用，混合渠道保留图片、视频等能力；同时从其模型配置中移除对话条目，避免普通保存重建旧路由。快照是本次部署配置，不是前端选项常量，也不意味着会自动接入上游以后新增且尚未定价的模型。

桌面 `/api/desktop/v1/models` 读取鉴权后的 `/v1/models` 与 new-api 的 `model_kind=chat`、有效渠道报价的交集，保留旧 `models` 并提供 `data` 字段以兼容客户端。新请求按新鲜目录校验模型；历史请求先回放原回执，不因模型后来下线而重发或丢弃。UI 不写死 22 个模型 ID；22 是这次导入的上游启用快照。new-api 对 default/vip/svip 发布路由，媒体能力不加入桌面对话目录。

桌面对话签名消费模式的新订单不预扣或冻结积分，按照 new-api 最终人民币金额 × 100 换算积分，不再追加 1.5 倍。个人只登记待结算回执，团队保留金额为 0 的独立执行台账。结算不足或回执未确认时保留原结果与订单待核对，不重发模型请求。历史订单仍使用其记录的旧倍率；非签名旧模式不把新模型套用为 DeepSeek 价格。

`tanvas-desk` 对话区域不显示实时积分；打开左侧账号菜单或积分页时读取余额，主动刷新仍保留。网页旧入口不在本次动态桌面接口范围。

## 单一官价倍率

最终配置只有一个可编辑倍率：**`text_price_multiplier=0.4`，售价 = 人民币官价基准 × 官价倍率**。在渠道管理页修改这个倍率，不再要求管理员设置采购折扣和销售倍数。`text_base_per_million_cny` 保存人民币/百万 tokens 基准和上下文档位；所有输入、输出、缓存及已支持的模态维度只乘一次倍率，既有组折扣另按原规则执行。

官价数据和同步方式参考 TapCanvasPro：同步内置、带来源 URL 与核验日期的官方价格快照，保留当前倍率；普通保存不会静默更换官价。官方快照为 USD 时按记录的基准汇率转换一次到 CNY，已有人民币基准不重复换汇。20 个已核验模型可同步；两款豆包在参考项目中没有官价绑定，保留鲁班公开人民币基准并明确列为跳过，不冒充已核验官价。同步不会导入渠道未启用的新模型。

部署补丁将初始采购合同迁移为单倍率基准合同。`001` 保存原始导入记录，后续迁移负责转为最终格式，重跑不会覆盖管理员之后设置的倍率。上游公开目录不提供本密钥的实际账单，本次不通过付费调用确认供应商采购价。

请求受理时冻结定价快照，按实际 usage 选择上下文档位；换渠道重试只刷新所选渠道报价，不重复预扣。`/api/pricing.channel_text_prices` 返回最终人民币价格，消费者不再乘官价倍率或汇率；仅由合同渠道提供的模型，其兼容摘要也采用实际售价。模型详情动态展示官价来源、渠道售价和上下文档位。

基础档售价（CNY / 百万 tokens；超长上下文见快照中的 tiers）：

| 模型 | 输入 | 输出 |
| --- | ---: | ---: |
| claude-fable-5.1 | 29.2 | 146 |
| claude-opus-5 | 14.6 | 73 |
| claude-opus-5-5 | 11.68 | 58.4 |
| claude-sonnet-5-5 | 5.84 | 29.2 |
| deepseek-v4.1-flash | 0.876 | 3.504 |
| doubao-seed-2-0-lite-260428 | 0.36 | 2.16 |
| doubao-seed-2-1-turbo-260628 | 1.8 | 9 |
| gemini-3.6-flash | 2.19 | 10.95 |
| gemini-3.7-flash | 2.19 | 10.95 |
| gemini-3.8-flash | 2.19 | 10.95 |
| glm-5.3 | 4.088 | 12.848 |
| glm-5.3-flash | 0.438 | 1.46 |
| gpt-5.6-luna | 0.584 | 3.504 |
| gpt-5.6-sol | 11.68 | 58.4 |
| gpt-5.6-terra | 5.84 | 35.04 |
| gpt-6-astra | 29.2 | 146 |
| gpt-6-luna | 0.292 | 1.46 |
| gpt-6-sol | 5.84 | 29.2 |
| grok-4.6 | 5.84 | 17.52 |
| grok-4.7 | 5.84 | 17.52 |
| kimi-k3 | 8.76 | 43.8 |
| qwen3.8-max | 5.84 | 17.52 |

原始公共目录、版本号和导入快照在 `new-api/patches/2026-10-08/lluban-chat-pricing-snapshot.json`；最终启用单一官价倍率，原始快照仅用于追溯。

## 用户自行部署

1. 将本次源码和 `new-api/patches/2026-10-08/` 一起同步到服务端。Go 代码和 SQL 必须同时部署，旧程序不会识别新定价合同。
2. 在服务端私有 `backend/.env` 配置 `LLUBAN_API_KEY`，值使用本轮提供的鲁班上游渠道密钥。`NEW_API_KEY` / `NEW_API_TOKEN` 继续使用 Tanvas 自己的 new-api 访问凭据，不拿上游密钥替换。密钥不在 Git、SQL、前端或镜像内。
3. new-api 在 `backend/` 运行日常部署命令 `docker-compose up -d --build`。本次未执行该命令或更改任何生产配置。这个 Compose 只包含 new-api、数据库和 Redis，不会发布 NestJS 后端或桌面安装包；桌面动态目录/结算还需按现有方式构建发布 `backend/` 并重启其服务，隐藏积分的界面需随 `tanvas-desk` 更新。
4. 后端与 new-api 的 `TANVA_CONSUMPTION_SECRET` / `TANVA_CONSUMPTION_INSTANCE_ID` 必须一致，回调地址使用现有内部结算端点；本机后端目前未声明消费签名密钥；没有签名配置时保留旧模式并拒绝新模型，不会伪称开启动态结算。请在私有环境中设置同一随机长密钥，再发布两端。查看 `docker-compose logs new-api-patch`。`001` 缺密钥会 Deferred；`002` / `003` 必须等待 `001` 及渠道校验通过，暂缓时均不登记完成，补密钥后重跑 patch 服务；其他失败保持非零状态。SQL 内用 `\getenv` 导入环境变量，psql 参数不传密钥；这条带凭据的 SQL 屏蔽原始错误 detail/statement，日志只保留失败状态，避免泄漏 key。
5. SQL 使用事务与业务键锁，重复/并发执行不重复建渠道，重跑不覆盖管理员后续修改的密钥、状态和计数。同名但不同上游则整个事务失败。
6. patch 在 new-api healthy 后运行；运行时每 60 秒同步渠道/定价，公开目录另有 60 秒缓存。最多等待约 120 秒，确认 `/v1/models` 与 `/api/pricing` 出现相应渠道和价格，再在应用中刷新模型目录。健康检查本身不证明这一步通过。

如部署时缺 key 而暂缓，补好服务端环境后可执行 `docker-compose run --rm --no-deps new-api-patch`，无需重复执行用户对话。

## 本地验证

- `node backend/scripts/test-lluban-patch-runner.cjs`：缺密钥、成功、失败、已应用跳过，密钥不出现在参数与日志。
- `python3 backend/scripts/test-lluban-channel-patch.py`：在独立、无网络、临时内存数据盘 PostgreSQL 16 容器运行真实 SQL；22 个模型、66 条组路由、价格快照一致、缺密钥不写入、引号转义、重复与并发幂等、冲突回滚、旧 options/渠道/模型资料不变。测试结束删除自身容器，不连接线上或本机业务库。
- `python3 backend/scripts/test-lluban-chat-only-patch.py`：真实 001 → 002 → 003 串跑，媒体保护、模型映射/循环、元数据冲突、关闭旧路由、管理员倍率/模型子集/禁用能力保持，通过。
- `cd new-api && go test ./setting/official_pricing ./types ./dto ./model ./service ./middleware -count=1`：通过；包含最终 22 模型、20 官价绑定、`.4` 默认与 `.6` 修改后同步、2 个未核验基准保留、输入/输出/缓存/长上下文、公开目录与原子失败回滚。
- 真实 Go HTTP 转发 / 消费签名测试：新模型 `gpt-6-luna` 在 0.4 合同下只调用一次 fixture 供应商，`quota=564` 对应 `CNY=0.001128`；经签名查询确认原模型及金额。停用后的旧订单重放保持原 consumed 回执；新停用/媒体/未定价请求不派发并生成 rejected 零费证明。空基准合同不得回退全局旧价格。
- `cd new-api && go test ./controller ./router -run RelayChannelRetry -count=1`：通过；换渠道重新报价且不重复预扣。相关 8 个包 `go vet` 通过。
- `cd new-api/web && bun run build`：通过；两个价格 helper 的 Node 测试与相关 ESLint 通过。已检查的构建产物保存在 `/tmp/tanva-lluban-web-dist-verified-final`，不把生成 bundle 混进源码变更；Docker 默认重新构建 web，勿使用旧 `NEW_API_SKIP_WEB_BUILD=1`。
- `cd new-api && go build -o /tmp/tanva-lluban-new-api-final .`：通过，使用本轮新管理页构建产物编译，不安装或启动服务。
- `cd backend && npm run build`：通过。
- `cd backend && node scripts/test-desktop-chat.cjs`：通过。独立 PostgreSQL 16、真实 Prisma schema/服务、JWT Cookie 的 Nest/Fastify HTTP 路由，模型网络仅 fixture；覆盖目录动态变化/媒体排除、0 预留、CNY × 100、历史 1.5 倍、签名 webhook/查询/cron、重复请求、个人与团队余额不足后仅恢复原证明、不重发供应商调用。
- `tanvas-desk`：`node --experimental-strip-types --test apps/desktop/tests/credits-refresh.test.mjs` 10 项通过，`pnpm --filter @tanvas/desktop typecheck` 通过。

`relay/helper` 的两个 SSE ping 时序测试（`TestStreamScannerHandler_PingSentDuringSlowUpstream`、`TestStreamScannerHandler_PingInterleavesWithSlowUpstream`）和 `controller` 的两个旧 Veo 目录测试（`TestBuildCanonicalModelList`、`TestBuildCanonicalModelParamsCatalog`）仍失败；在未修改的 HEAD 对照也复现，不能宣称全量测试通过。没有为本次价格改动放宽这些断言。仓库要求的 AI metadata 同步脚本在指定路径不存在，未伪造执行成功。

未部署，未执行真实付费推理；本地测试不等于生产供应商连通、实际账单或应用完整对话验收。新桌面对话取消预冻结和额外 1.5 倍，仅保留原有 1 元 = 100 积分换算；其他业务及历史订单的计费合同不追溯更改。
