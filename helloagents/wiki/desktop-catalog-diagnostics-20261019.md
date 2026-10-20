# 桌面模型目录诊断（2026-10-19，本地）

## 已核实的故障路径

`GET /api/desktop/v1/models` 经原 `JwtAuthGuard` 与用户/团队 scope 检查。配置非空 `TANVA_CONSUMPTION_SECRET` 后，`DesktopChatService.gatewayModels` 并行读取网关鉴权 `/v1/models` 和 `/api/pricing`，取实时可执行 ID、明确 `chat` 类型和有效 CNY 渠道价格的交集；没有有效签名配置时保持旧单 DeepSeek 兼容目录。未为新模型套用旧定价，没有在目录读取时提交模型或产生消费订单。

此前动态目录将上游 HTTP 401/404/429/500、格式错误、超时和网络故障全部吞成同一句 HTTP 503，桌面端无法据此区分配置问题与暂态故障。本轮只改善诊断和响应资源清理，不宣称已经取得用户原故障的生产根因。

## 安全错误契约

所有以下诊断均返回 HTTP 503 与 `{code,message,upstreamStatus?}`。`upstreamStatus` 仅允许 100–599 整数；不返回上游错误正文、网络异常字符串、网关地址或凭据。上游 401/403 使用配置错误 code，不能让客户端据此注销 Tanva 登录；Tanva 自身 JWT 401 与团队权限 403 仍按原 guard/scope 路径返回。

| code | 固定 message |
| --- | --- |
| `TANVA_MODEL_GATEWAY_UNCONFIGURED` | 模型网关凭据未配置，请联系管理员检查服务配置。 |
| `TANVA_MODEL_GATEWAY_AUTH_FAILED` | 模型网关鉴权失败，请联系管理员检查网关凭据与权限。 |
| `TANVA_MODEL_GATEWAY_ENDPOINT_MISSING` | 模型网关未提供模型或报价接口，请联系管理员检查网关版本与地址。 |
| `TANVA_MODEL_GATEWAY_RATE_LIMITED` | 模型目录请求频率受限，请稍后重试。 |
| `TANVA_MODEL_GATEWAY_UNAVAILABLE` | 模型网关暂不可用，请稍后重试。 |
| `TANVA_MODEL_CATALOG_INVALID` | 模型网关目录或报价格式无效，请联系管理员检查网关版本与计价配置。 |
| `TANVA_MODEL_CATALOG_TIMEOUT` | 读取模型目录超时，请稍后重试。 |
| `TANVA_MODEL_CATALOG_NETWORK_FAILED` | 无法连接模型网关，请稍后重试或联系管理员检查网络。 |

合法空目录仍返回 200 和空数组；只展示具备真实执行与报价依据的模型，不降级伪造可用模型。用户手动重试只重复目录 GET；计费请求、钱包归属、已受理模型任务与原订单查询不变。

## 配置与兼容核对

- `backend/docker-compose.yml` 仅运行 new-api/PG/Redis 和 patch 服务，不运行 Nest；new-api 已显式引用消费签名、instance 与 callback 配置。它未引用 Nest 的 `NEW_API_*` 并不是遗漏。
- Nest 由 `backend/ecosystem.config.js` 的 PM2 配置运行。`app.module.ts` 通过 ConfigModule 依次读取 `.env`、`backend/.env`、`../.env`，PM2 未显式列出密钥不等于进程缺少配置。不能为了补目录自动生成、切换或覆盖现有签名。
- 本机 `backend/.env` 的 `NEW_API_BASE_URL`、`NEW_API_KEY` 非空；`TANVA_CONSUMPTION_SECRET`、`TANVA_CONSUMPTION_SCOPE` 与 instance 缺失/空。只核存在性，未打印值。本地因此采用旧兼容目录；这不代表生产当前配置。历史 10-08 生产切换记录不能代替今天的运行态核对。
- 源码存在分组兼容限制：new-api `/api/pricing` 使用 `TryUserAuth`，只识别浏览器 session；后端发出的 Bearer 不会赋予该公开报价接口 token 用户身份。`/v1/models` 则按 token 身份和可用路由返回。特殊分组若仅在鉴权目录中可见、没有匿名报价，会被交集排除并表现为空目录。未取得当前用户的运行时分组证据，不将其认定为原故障根因，也未擅自修改网关鉴权或扩大报价可见范围。

## 验证与未覆盖

`cd backend && npm run test:desktop-catalog`：22 项独立检查通过，覆盖两条上游路径的 401/403/404/405/429/500/503、安全正文隔离与取消、缺失凭据、连接失败、无效 JSON/schema、4 MiB 上限、读取超时、手动重试恢复及合法空目录；全部使用 GET-only 内存 fixture，无数据库与付费推理。该检查也加入原 `test:desktop-chat` 入口。

完整隔离 PostgreSQL 计费套件本轮未运行；未读取生产环境密钥、访问生产模型、修改账号、重跑用户任务或部署。`cd backend && npm run build` 与 `git diff --check` 通过；日志 `/tmp/tanva-desktop-catalog-20261019-build.log`、`/tmp/tanva-desktop-catalog-20261019-tests.log`。
