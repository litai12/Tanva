# ToAPIs VIP 图片模型与 Nano Banana 2.1

## 接入范围

new-api 的现有 `toapis` 渠道（生产 ID 31，type 59）追加 `gpt-image-2.5-flare-vip`、`gpt-image-2.5-sunburst-vip`、`gemini-nano-banana-2.1`，继承渠道分组和优先级。后续按用户要求补齐 Tanva 画布与业务后端：在原 GPT Image 2.5 / Nano Banana 2 节点内选择新型号，保留旧普通版默认与旧节点身份。

VIP 零售价按用户提供截图的 TANVAS 栏配置；Nano Banana 2.1 经用户确认沿用现有 Nano Banana 2 售价。1 元 = 100 积分。

| 质量 | 1K 积分 | 2K 积分 | 4K 积分 |
| --- | ---: | ---: | ---: |
| low | 20 | 30 | 40 |
| medium | 30 | 40 | 50 |
| high | 40 | 60 | 80 |
| xhigh | 60 | 100 | 140 |
| max | 150 | 300 | 450 |
| Nano Banana 2.1 | 30 | 40 | 50 |

VIP 的 `ModelPrice` 基价为 CNY 0.2，Nano 为 CNY 0.3；实际规格倍率和公开价格使用同一份矩阵。组倍率仍遵循现有渠道设置，生产 default/vip 均为 1。上游 VIP 按实际 token 计费，与本项目固定零售价分开。

## 参数合同

- VIP 上游发送真实像素 `size`、顶层 `quality`、`n=1`，省略普通版的 `resolution` / `aspect_ratio`。网关可接受宽高比与 1K/2K/4K 组合并转换像素；显式像素也可输入。质量控件提供五档，缺失/auto 归一 high 并实际发送 high。
- 自定义像素的零售分档是本地合同，不能视为供应商 token 价格承诺；最大边不超过 1536/3072/4096 分别计入 1K/2K/4K。显式分辨率与像素档不一致时返回参数错误，避免价格与输出脱离。
- Nano 2.1 上游使用比例 `size` 与 `metadata.resolution`，1K/2K/4K，最多 14 张远程 HTTP(S) 参考图。
- 生图与参考图使用现有同步 Images → ToAPIs 异步提交/原 task ID 轮询链路。参考图不下载、不转 base64；不自动重新提交。
- new-api 文档页的规格标签同时显示质量和分辨率，生成的 curl 示例携带匹配参数。

官方合同：[VIP](https://docs.toapis.com/docs/cn/api-reference/images/gpt-image-2.5-vip/generation)、[Nano Banana 2.1](https://docs.toapis.com/docs/cn/api-reference/images/gemini-nano-banana-2.1/generation)。

## 上游 curl 证据

三个请求均从生产主机使用渠道 31 现有凭据，经 curl 提交并查询原 task ID 至 `completed`，各返回一个远程图片 URL。凭据未进入脚本、仓库或回执文件。

| 模型 | task ID | 参数 | 用时 |
| --- | --- | --- | ---: |
| Flare VIP | `tsk_img_01M4QFK0538T9NHY2PEAG3CFZF` | low / 1024x1024 / n=1 | 30 秒 |
| Sunburst VIP | `tsk_img_01M4QFK0EVKT6Q9A6J2AMJAXX2` | low / 1024x1024 / n=1 | 202 秒 |
| Nano Banana 2.1 | `tsk_img_01M4QFK0RP4EX57NAKQ7A5YGDR` | 1:1 / metadata.resolution=1K / n=1 | 19 秒 |

原始请求与完整回执位于服务器 `/opt/tanva-releases/toapis-vip-20261012/`。只有完成上述验证之后才执行模型注册。

## 变更与回退

注册工具 `new-api/cmd/register-toapis-image-models` 默认 dry-run，显式 `--apply --backup-dir` 后在单个数据库事务内追加模型、能力与三项价格；使用 GORM 支持 SQLite/MySQL/PostgreSQL。保留旧渠道模型顺序、无关价格、现有启停和已有能力状态，备份不读取渠道密钥。

生产配置备份：`/opt/tanva-backups/toapis-vip-20261012/config-before.dump`，仅包含 models/channels/abilities/options，已验证 archive 可读。旧镜像保留为 `backend-new-api:pre-toapis-vip-20261012`。不得运行全量 patch 服务，避免执行与本任务无关的待处理迁移。

## 本地验证与生产部署

- `go test ./dto ./relay/channel/apimart ./model ./relay` 通过；`go test ./relay/helper -run 'TestToAPISImage'` 通过，包含 33 组实际预扣价格与 HTTP 参数校验。
- 注册工具 SQLite 集成验证通过：dry-run 不写、事务应用、重跑 no-op、禁用状态保留、无关配置保留、备份权限与失败不部分写入。Linux amd64 编译通过。
- 文档页 Node 测试 10/10 通过；Bun/Vite 生产构建和 Go Linux 静态编译通过。前端构建仍有已有的循环 chunk / 体积警告。
- helper 全包另有两个未通过的流式 ping 测试：`TestStreamScannerHandler_PingSentDuringSlowUpstream`、`TestStreamScannerHandler_PingInterleavesWithSlowUpstream`，均收到 0 个 ping。对应源码未在本任务修改，未在干净基线验证，不能将其声明为已证实的基线失败。
- 等待图片 active jobs 与近 30 分钟未落消费/错误日志的网关请求清零后发布，仅重建 `tanva-new-api`；随后恢复原图片队列。环境变量与原容器完全一致，未修改密钥或后端业务服务。
- 当前镜像 `backend-new-api:toapis-vip-20261012`，二进制 SHA-256 `bb89f319768cde395b3459ccf474abd7ab0a85299602ac530f7f22fead5394c3`。源码已同步生产，`/api/status` 正常。
- 生产注册成功：三个型号各有 default/vip 两条启用能力；三项 ModelPrice 为 0.2/0.2/0.3，二次 dry-run 的 actions 为空。逐事务 JSON 备份存于 `/opt/tanva-backups/toapis-vip-20261012/transaction-backup/`。

## 生产网关验收

通过 `POST /v1/images/generations` 的三个 curl 请求均 HTTP 200，并有真实远程图片。直接读取图片文件头核对输出尺寸；网关请求追踪确认质量、尺寸和参考图实际传至 toApi，消费日志均为渠道 31。

| 模型 | 实测参数 | 图片尺寸 | 耗时 | 实扣 CNY / 积分 | request ID |
| --- | --- | --- | ---: | --- | --- |
| Flare VIP | medium / 2K / 1 张远程参考图 | 2048×2048 | 43 秒 | 0.4 / 40 | `202610120734277662220018268d9d6agd6c3li` |
| Sunburst VIP | low / 1K | 1024×1024 | 28 秒 | 0.2 / 20 | `202610120734277660093708268d9d6vMQnG1su` |
| Nano Banana 2.1 | metadata.resolution=2K | 2048×2048 | 33 秒 | 0.4 / 40 | `202610120734277661468518268d9d6jKp1nGob` |

- 公网 `/api/pricing` 的两套 15 规格逐项与截图矩阵一致，Nano 三档一致；`/api/models/params` 实际返回 VIP 五档质量与三档分辨率。
- 使用现有 default token 读取 `/v1/models` 共 96 个，三新型号全部可见。
- 公网 HTML 的 JS/CSS 引用与本轮构建完全相符，容器 healthy、重启次数 0，Tanva `/api/health` 正常。
- 完整网关请求/响应在服务器发布目录的 `gateway-*.json`，图片文件头核对在 `output-dimensions.json`。本轮共 6 次授权实测生成（上游直连三次、网关三次），没有自动重投。
- AI Metadata 同步脚本 `/Users/libiqiang/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs` 在本机缺失；知识库与 Changelog 已人工同步。

## Tanva 画布接入

- GPT Image 2.5 型号下拉追加 Flare VIP / Sunburst VIP，质量提供 low/medium/high/xhigh/max，默认 high；Nano Banana 2 下拉追加 2.1。保留原型号、节点结果和连线。
- 三个新型号固定走 `new_api` 的 toApi 普通线路；全局 stable/ultra 不改变供应商和价格。前端报价、生成任务、Provider 请求保留同一模型、分辨率与质量。
- Tanva 积分预览、预扣与最终计费使用上表零售价；新 Nano 2.1 为 30/40/50，旧 Nano 2 的原普通/尊享价格不追溯变更。
- 公共节点目录与托管模型默认配置补齐缺失模型，已有管理员禁用状态继续生效。使用现有异步图片任务、幂等和结果持久化合同，参考图及保存结果使用远程 URL。
- 发布前备份：`/opt/tanva-backups/toapis-canvas-20261012/`，包含前后端 dist 与相关 SystemSetting / NodeConfig。源码、构建验证和生产验收记录在发布完成后补充。

### 画布本地验证

- 前端 `test:toapi-image-models` 覆盖模型切换、VIP 30 个价格规格、Nano 三线路报价、小T协议，以及旧 Nano 托管模型键保留。
- `verify:toapi-image-controls` 使用真实 Nano2Node React 控件：两个 VIP 选 xhigh/2K，捕获报价与异步提交参数；Nano 2.1 切换并刷新后保留型号和已有结果，再提交 4K。该浏览器测试拦截 API，无付费生成。
- 后端 `verify:toapis-canvas-models` 验证 99 组最终有效报价（同步/异步参数形状均覆盖），以及目录升级、禁用保留、固定 toApi 路由、原始远程参考图与参数拒绝。
- 前后端生产构建通过。后端目录、旧图片定价、new-api 请求、DTO 既有回归通过。前端全量 lint 仍有 2,563 errors / 199 warnings，原基线为 2,563 / 200；未新增错误，不能声明全量 lint 通过。
