# Wan 3.0 视频接入

本次开放官方示例已明确的文生视频，模型 ID 为 `wan3.0-video`。
官方依据：https://www.qianwenai.com/models/wan3.0-video（2026-09-07 核对）。

## 画布

在视频节点菜单中选择 **Wan3.0 视频**，连接 TextPrompt，选择分辨率和时长后运行。
默认 `480P / 5 秒 / adaptive`；分辨率可选 480P、720P、1080P，时长菜单提供 5、10、15、20、25、30 秒。
结果支持播放、下载、历史记录及下游视频连接。异步任务身份写入节点，刷新只查询原任务；查询中断保留任务，不按查询超时退款。
当前没有开放图片、音频、参考视频和编辑入口：官方介绍提到这些能力，但当前引用页面的请求样例仅给出 `input.prompt`，其他输入需按后续官方字段文档另行接入。

## 渠道

`POST /api/ai/dashscope/generate-wan3-0-video` → new-api `POST /v1/videos` → type=17 阿里百炼 → `/api/v1/services/aigc/video-generation/video-synthesis`。
Tanva 只读取 `NEW_API_BASE_URL`、`NEW_API_KEY`。阿里密钥保留在 new-api 渠道中。
任务使用 `newapi:` 前缀；并发重复请求复用任务或返回 `usage:` 查询别名，避免重复提交和扣费。

## 定价

按用户确认的 **官方标准价 × 1.5**，不使用未明确结束时间的限时七折价。

| 分辨率 | 官方标准价（元/秒） | 用户价格（元/秒） | 积分/秒 | 5秒积分 |
| --- | ---: | ---: | ---: | ---: |
| 480P | 0.30 | 0.45 | 45 | 225 |
| 720P | 0.60 | 0.90 | 90 | 450 |
| 1080P | 1.20 | 1.80 | 180 | 900 |

前端统一通过 `/api/credits/preview` 报价；后端 `wan30-video` 按分辨率×时长扣费。托管模型 `wan-3.0` 使用独立的同价定价模板。new-api `ModelPrice` 基价为每秒 0.45 元，适配器乘以秒数及分辨率倍率 1 / 2 / 4，catalog 参数报价使用相同单价。

## 部署注册

除前后端发布外，需要发布 new-api 更新，并在部署环境注册模型。
新增命令位于 `new-api/cmd/register-wan30`，支持 PostgreSQL、MySQL、SQLite，只复制已启用的 type=17 Wan2.7 渠道能力，不创建或复制凭据，不改其他渠道。

在 new-api 目录运行（`SQL_DSN` 由部署环境注入）：

```sh
go run ./cmd/register-wan30 -driver postgres -apply
```

MySQL/SQLite 分别使用 `-driver mysql` / `-driver sqlite`。随后重启 new-api 以刷新渠道和价格缓存。
该命令可重复运行；保留已有 Wan3.0 ability 的人工启停状态，并把该模型的 `ModelPrice` 更新为已确认的单价。需确保 Tanva token 的 default 分组已在原 Wan2.7 阿里渠道启用。
Tanva 节点初始化会补齐 Wan3.0；后台托管模型菜单提供 Wan 3.0 配置模板。

## 验证

- Backend：`npm run build`、`npm run verify:dashscope-new-api-routing`、`npm run verify:wan30`。
- Frontend：`npm run build`、`npm run lint`。
- new-api：`go test ./cmd/register-wan30 ./relay/channel/task/ali ./model ./setting/ratio_setting`。
- mock 验证不调用付费上游。真实出片验收需在发布并完成渠道注册后进行。
