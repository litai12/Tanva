# Wan 3.0 视频接入

开放文生视频、首帧/首尾帧图生视频、多图参考，以及参考视频生成/编辑/延长，模型 ID 为 `wan3.0-video`。
官方依据：https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference（2026-09-07 核对）。

## 画布

在视频节点菜单中选择 **Wan3.0 视频**，连接 TextPrompt，选择分辨率和时长后运行。

界面复用 Seedance 的 `GenericVideoNode`，统一运行按钮、积分提示、预览和历史操作；连线校验及输入容量规则允许连接或替换提示词。时长统一写入 `clipDuration`，兼容旧节点的 `duration`，无需重建节点。
默认 `480P / 5 秒 / adaptive`；分辨率可选 480P、720P、1080P，时长菜单提供 5、10、15、20、25、30 秒。
结果支持播放、下载、历史记录及下游视频连接。异步任务身份写入节点，刷新只查询原任务；查询中断保留任务，不按查询超时退款。
连接方式：
- 只接提示词：文生视频。
- 单张图接 `image`：按 `first_frame` 提交；再接 `image-2` 则为首尾帧。
- 多张图接 `image`（最多 10 张）：按 `reference_image` 提交。
- 视频接 `video`（最多 5 段）：按 `reference_video` 提交；同时连接的图片按参考图提交。提示词描述生成、编辑或延长意图。

首尾帧不可与参考视频/多参考图混用；尾帧必须有首帧。节点根据连接显示当前模式。素材统一使用已上传的远程引用，裁剪图先按当前显示内容解析并上传。后端只接受素材白名单域名，拒绝 data/blob/base64。

提示词和媒体至少提供一项；输出时长须为 2–30 秒。后端复用参考视频时长探测服务：每段 1–15 秒、总长 ≤15 秒、输入与输出合计 ≤30 秒，校验通过后才扣费提交。当前不提供音频、文件或网页输入。

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

使用 `backend/docker-compose.yml` 完整启动时，`new-api-patch` 会自动扫描并执行新增的
`new-api/patches/2026-09-07/001-add-wan3-0-video.sql`，无需单独运行 Go 注册工具。

在仓库根目录执行：

```sh
docker compose -f backend/docker-compose.yml up --build -d
docker compose -f backend/docker-compose.yml logs new-api-patch
```

日志应包含 `Applying 2026-09-07/001-add-wan3-0-video.sql` 和 `Patches done`；后续完整启动按 `schema_migrations` 中的文件名记录跳过已执行补丁。
仅启动指定的 `new-api` 服务不会启动 `new-api-patch`；可用下面的命令补跑：

```sh
docker compose -f backend/docker-compose.yml run --rm new-api-patch
```

补丁会注册模型目录，在已有启用的 type=17 Wan2.7 渠道中追加模型并复制分组、优先级和权重，同时合并 `ModelPrice["wan3.0-video"]=0.45`。其他模型价格、渠道和已经人工禁用的 Wan3.0 ability 保持原状。
必须已有启用的阿里 Wan2.7 渠道；没有时补丁会明确失败并回滚，不记入已执行记录，配置好渠道后重新运行补丁即可。Tanva token 的 default 分组也应在原 Wan2.7 渠道启用。
补丁在 new-api 健康后执行，渠道与价格缓存随后按 `NEW_API_SYNC_FREQUENCY` 自动同步（Compose 默认 60 秒）；需立即刷新可重启 new-api。

非 Compose 部署或 MySQL/SQLite 环境保留跨数据库 Go 注册工具，在 new-api 目录运行（`SQL_DSN` 由部署环境注入）：

```sh
go run ./cmd/register-wan30 -driver postgres -apply
```

MySQL/SQLite 分别使用 `-driver mysql` / `-driver sqlite`。该工具与 PostgreSQL 补丁采用同一注册和定价口径。
Tanva 节点初始化会补齐 Wan3.0；后台托管模型菜单提供 Wan 3.0 配置模板。

## 验证

- Backend：`npm run build`、`npm run verify:dashscope-new-api-routing`、`npm run verify:wan30`。
- Frontend：`npm run build`、`npm run lint`。
- 连线回归：`cd frontend && node scripts/verifyWan30Connections.mjs`，直接执行画布实际校验回调，检查提示词接入、替换及非法媒体连线。
- new-api：`go test ./cmd/register-wan30 ./relay/channel/task/ali ./model ./setting/ratio_setting`。
- Compose SQL 补丁：`sh new-api/scripts/verify-wan30-patch.sh`，使用隔离的 PostgreSQL 16 容器验证真实补丁与 `_apply.sh`，不访问业务数据库。
- mock 验证不调用付费上游。真实出片验收需在发布并完成渠道注册后进行。

本次多模态更新需要重建前端、后端与 new-api 镜像；沿用原模型和渠道，不增加新的 SQL 注册项。new-api 已补齐无提示词、有媒体请求的入口校验。
