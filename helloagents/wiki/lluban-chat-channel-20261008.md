# 鲁班对话渠道（2026-10-08，本地待部署）

## 范围与来源

目标是 Tanvas 的 `t-api.tanvas.cn`，源码 `new-api/`、构建入口 `backend/docker-compose.yml`。新增 `lluban-chat`，上游为 `https://tt-api.lluban.com`，type=1，复用 OpenAI Chat Completions 及既有 streaming 处理。两个服务独立，不把上游添加到它自己。

导入范围为本轮授权密钥 `/v1/models` 与上游 `/api/pricing` 启用 default 分组、`model_kind=chat` 的交集，共 22 个原始模型 ID。图片、视频、embedding、未分类型号和不可访问型号不导入；不创建模型别名。快照是本次部署配置，不是前端选项常量，也不意味着会自动接入上游以后新增且尚未定价的模型。

当前新版 Electron 的 `frontend/electron/platform-model-gateway.mjs` 通过 `/v1/models` 动态列举模型，执行前再次核验目录，本次不改为静态列表。new-api 新渠道的 `abilities` 对 default/vip/svip 三个现有组发布。已有同名模型的资料及禁用/软删除状态保留，新模型资料才补齐。旧网页/旧 desktop-chat 的固定模型入口不由这次渠道配置改写。

## 人民币定价

按用户明确指定的渠道政策：**采购成本 = 上游公开基准 CNY 价格 × 0.2；本渠道售价 = 采购成本 × 2 = 基准价格 × 0.4**。公开接口的 `model_ratio × 2` 已经是人民币/百万 tokens，不再乘汇率。上游公开目录不暴露此密钥的实际渠道折扣，本次 0.2 来自用户指示，没有通过付费调用独立确认采购账单。

`setting.text_cost_per_million_cny` 保存采购成本和长上下文档位，`text_sale_multiplier=2`。请求受理时冻结定价快照，预估及实际 usage 分别选对应档位；不会被同名模型的旧固定价、全局 ModelRatio 或 DeepSeek 峰谷重写。输入、输出、已声明缓存/模态费率均使用同一倍率，缺少专门缓存报价的维度显式按普通输入价配置，不编造免费缓存。既有用户/组折扣仍执行。

不修改其他渠道或全局价格选项。`/api/pricing.channel_text_prices` 返回已乘 2 的最终人民币价格，使用方不得再乘此字段的倍率；只由新合同渠道服务且没有全局价格的新模型，同时补齐兼容现有目录消费者的报价摘要（内存计算，不写 options）。管理页保存渠道时保留这些合同字段。

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

原始公共目录、版本号、折扣依据和完整成本快照在 `new-api/patches/2026-10-08/lluban-chat-pricing-snapshot.json`；SQL 嵌入相同合同。

## 用户自行部署

1. 将本次源码和 `new-api/patches/2026-10-08/` 一起同步到服务端。Go 代码和 SQL 必须同时部署，旧程序不会识别新定价合同。
2. 在服务端私有 `backend/.env` 配置 `LLUBAN_API_KEY`，值使用本轮提供的渠道密钥。密钥不在 Git、SQL、前端或镜像内。
3. 在 `backend/` 运行日常部署命令 `docker-compose up -d --build`。本次未执行该命令或更改任何生产配置。
4. 查看 `docker-compose logs new-api-patch`。新 SQL 缺密钥会 Deferred 且不登记完成，补密钥后重跑 patch 服务；其他失败保持非零状态。SQL 内用 `\getenv` 导入环境变量，psql 参数不传密钥；这条带凭据的 SQL 屏蔽原始错误 detail/statement，日志只保留失败状态，避免泄漏 key。
5. SQL 使用事务与业务键锁，重复/并发执行不重复建渠道，重跑不覆盖管理员后续修改的密钥、状态和计数。同名但不同上游则整个事务失败。
6. patch 在 new-api healthy 后运行；运行时每 60 秒同步渠道/定价，公开目录另有 60 秒缓存。最多等待约 120 秒，确认 `/v1/models` 与 `/api/pricing` 出现相应渠道和价格，再在应用中刷新模型目录。健康检查本身不证明这一步通过。

如部署时缺 key 而暂缓，补好服务端环境后可执行 `docker-compose run --rm --no-deps new-api-patch`，无需重复执行用户对话。

## 本地验证

- `node backend/scripts/test-lluban-patch-runner.cjs`：缺密钥、成功、失败、已应用跳过，密钥不出现在参数与日志。
- `python3 backend/scripts/test-lluban-channel-patch.py`：在独立、无网络、临时内存数据盘 PostgreSQL 16 容器运行真实 SQL；22 个模型、66 条组路由、价格快照一致、缺密钥不写入、引号转义、重复与并发幂等、冲突回滚、旧 options/渠道/模型资料不变。测试结束删除自身容器，不连接线上或本机业务库。
- Go 合同与预估/实际结算、长上下文、缓存、快照、公开目录及管理页保存 roundtrip 验证记录见本轮交付说明。

未部署，未执行真实付费推理；本地测试不等于生产供应商连通、实际账单或应用完整对话验收。此次接入只配置 new-api 的收费，未改业务层另外的积分兑换/加价规则，也未处理上一轮讨论的冻结策略。
