# new-api 腾讯 VOD 视频任务：使用日志 + 扣费

日期：2026-05-31
状态：设计已确认，待落实现计划

## 背景与问题

后端（NestJS）的 Vidu Q2/Q3、Seedance 视频任务，不直连腾讯云，而是经过 new-api 的「签名透传代理」端点 `POST /proxy/tencent/vod`：

- 路由 `router/tencent-proxy-router.go` 只挂了 `middleware.RouteTag("relay")` + `middleware.TokenAuth()`。
- 控制器 `controller/tencent_proxy.go` 的 `proxyTencent` 只做：取渠道密钥 → TC3-HMAC 签名 → 转发 `vod.tencentcloudapi.com` → 原样返回。

它**不调用任何计费/日志逻辑**，因此：

1. 这些视频任务在 new-api 的「日志/消费记录」里完全看不到。
2. 调用方 apikey 的额度也不扣减。

图片节点走 new-api 标准 relay（有日志+计费），视频经此透传代理（无），形成观测盲区。

## 目标

让经 `/proxy/tencent/vod` 创建的 Vidu/Seedance 任务，**和现在 new-api 原生 Seedance 一样**同时产出两样东西：

1. **调用日志**（消费记录）：在 new-api 消费视图/统计里能看到，并**真实扣减** apikey（token）+ user 的额度，更新用量统计与渠道用量。
2. **视频记录**（`model.Task` 行）：在「视频/任务」视图里能看到这条任务，并随生命周期推进（排队 → 处理中 → 成功/失败、带结果 URL）。

> 现状对比：原生 Seedance 走 new-api 的任务子系统（`relay/relay_task.go` + `service/task_polling.go`），自动产出这两样。经 `/proxy/tencent/vod` 的 Vidu/Seedance 两样都没有。本设计补齐。

## 关键约束与决策（已与用户确认）

- **过渡期双轨**：后端自己的 credits 系统仍是面向终端用户的真实计费。new-api 这里的扣费是**网关侧成本核算**，与后端 credits 互相独立、不冲突，主要为运营侧统计服务。
- **定价方案 = A（new-api 自维护近似价格表）**：不在 new-api 复刻后端那几百行精确积分逻辑（过渡期不追求分毫对账）。new-api 维护一张独立、近似、可调的价格表，含时长/分辨率系数。
- **换算固定**：本站人民币:美元 = 1:1，`QuotaPerUnit = 500000`（$1 = 500000 quota），后端定价 100 积分 = 1 元。
  因此 **`quota = 积分 × 5000`**（500000 ÷ 100）。
- **真扣余额**：与标准 relay 一致，`DecreaseUserQuota` + `DecreaseTokenQuota`，并更新用量统计。
- 渠道：复用名为 `tencent` 的渠道（`getChannelByName("tencent")`），`ch.Id` 作日志/任务的 `channel_id`。
- **视频记录 = 被动镜像（new-api 不抢轮询）**：后端始终是任务生命周期/轮询/OSS 的拥有者。创建（`CreateAigcVideoTask`）和轮询（`DescribeTaskDetail`）**都经过 `/proxy/tencent/vod`**，所以 new-api 只需在透传时**旁路观察**，把状态镜像进一条 `model.Task` 行即可——无需在 new-api 实现 Tencent 任务适配器、无需重复轮询、后端零改动。
  （对比放弃的方案 Y：把 Vidu/Seedance 改成 new-api 原生任务通道，需后端改调 new-api 任务接口并交出自有 OSS/轮询管线，与「video→native video-provider.service（own keys）」现状冲突，过渡期不做。）

## 范围

- ✅ 仅改动 new-api（Go）。后端无需改动（方案A 不依赖后端传价；创建/轮询本就经过 proxy）。
- ✅ 只对**任务创建**计费 + 插入视频记录：`X-TC-Action == CreateAigcVideoTask` 且上游成功返回 `TaskId`。
- ✅ 轮询 `DescribeTaskDetail` 只用来**被动镜像**视频记录状态，**永不计费**。
- ❌ 不在 new-api 实现 Tencent 任务适配器、不让 new-api 自身轮询这些任务（后端仍是唯一轮询/OSS 拥有者）。
- ❌ 不引入实时汇率、不改 `QuotaPerUnit`、不动后端 credits 体系。

## 架构

### 计费钩子位置

在 `controller/tencent_proxy.go` 的 `proxyTencent` 中，把上游响应**先读进内存**（当前是 `io.Copy` 直接透传，需改为读 body → 解析 → 再写回客户端），然后在「转发成功」之后插入计费判定。新增独立函数 `billTencentVodTaskIfNeeded(c, ch, action, reqBody, respStatus, respBody)`，与转发逻辑解耦、便于单测。

计费触发条件（全部满足才扣一次）：

1. `action == "CreateAigcVideoTask"`（大小写规范化比较）。
2. `respStatus` 为 2xx。
3. 解析 `respBody` 的 `Response.TaskId`（或兼容 `TaskId`），非空。

任一不满足 → 不计费，原样返回（计费失败绝不能影响透传结果）。

### 定价：new-api 自带近似价格表

从**请求 body**（`reqBody`，即透传给腾讯的 payload）取定价维度：

- `ModelName`：`Vidu` / `Seedance`
- `ModelVersion`：`q2` / `q3` / `1.5-pro` / `2.0` / `2.0-pro` / `2.0-lite` / `2.0-mini` …
- `OutputConfig.Duration`（数字，秒）
- `OutputConfig.Resolution`：`480P` / `720P` / `1080P`
- `OutputConfig.AudioGeneration`：`Enabled` / `Disabled`

定价公式：

```
credits = baseCredits(ModelName, ModelVersion)
          × durationFactor(ModelName, ModelVersion, Duration)
          × resolutionFactor(Resolution)
          × audioFactor(AudioGeneration)      // 默认 1.0
quota   = round(credits × 5000)
```

价格表为 Go 内独立常量文件（如 `controller/tencent_vod_pricing.go`），便于过渡期调整。**初始值（近似、可调）**，基础价取自后端 `credits.config.ts` / `credits.service.ts` 的真实数：

| ModelName | ModelVersion | baseCredits | 参考时长 |
|-----------|--------------|-------------|----------|
| Vidu | q2 | 600 | 5s |
| Vidu | q3 | 600 | 8s |
| Seedance | 1.5-pro | 600 | 5s |
| Seedance | 2.0 | 600 | 5s |
| Seedance | 2.0-pro | 1100 | 5s |
| Seedance | 2.0-lite | 700 | 5s |
| Seedance | 2.0-mini | 500 | 5s |

- `durationFactor` = `Duration / 参考时长`（线性，缺失/非法时取 1.0）。
- `resolutionFactor`（初值，可调）：`480P → 0.6`、`720P → 1.0`、`1080P → 1.8`、未知 → 1.0。
- `audioFactor`：`Enabled → 1.0`、其余 → 1.0（后端 Vidu/Seedance 经腾讯线实际为有声不另计，保留旋钮但默认 1.0）。
- **兜底**：表里查不到的 `ModelName/ModelVersion` → 用一个保守默认基础价（如 600）并打 `SysLog` 警告，避免漏计且可被发现。

> 注：后端这条线的真实定价多为「按变体定额、对时长/分辨率不敏感」。系数机制按用户要求保留，初值给出合理近似；因「定价不真正生效，仅统计」，分毫对账非目标，数值后续可在该常量文件直接调。

### 记账动作（真扣 + 统计 + 日志）

从 gin context 取（`TokenAuth` 已注入）：`id`(userId)、`token_id`、`token_key`、`token_name`、`group`/`user_group`、`username`。

按标准 relay 的「消费」语义，依次执行：

1. `model.DecreaseUserQuota(userId, quota, true)`
2. `model.DecreaseTokenQuota(tokenId, tokenKey, quota)`
3. `model.UpdateUserUsedQuotaAndRequestCount(userId, quota)`
4. `model.UpdateChannelUsedQuota(ch.Id, quota)`
5. `model.RecordConsumeLog(c, userId, model.RecordConsumeLogParams{...})`：
   - `ModelName`：规范化的展示名，如 `vidu-q3` / `seedance-2.0-pro`（便于在日志/统计里按模型聚合）。
   - `Quota`：上面算出的 quota。
   - `ChannelId`：`ch.Id`；`TokenName`/`Group` 取自 context。
   - `Content`：人类可读，如 `"Tencent VOD 视频任务 vidu-q3 8s/1080P, TaskId=xxx"`。
   - `Other`：放 `task_id`、`model_name`、`model_version`、`duration`、`resolution`、`audio`、`credits`、原始 `ratio` 便于审计。

所有记账动作放在转发**返回之后**（或对客户端响应无影响的前提下），任一记账步骤报错只 `SysLog`，**不影响**已成功的透传响应。

### 视频记录：被动镜像 `model.Task`

复用 new-api 现成的 `model.Task` 表（即原生 Seedance「视频记录」用的同一张表），由 proxy 旁路维护。

**新增平台常量**：`constant/task.go` 加 `TaskPlatformTencentVod TaskPlatform = "tencent_vod"`。

**创建时（`CreateAigcVideoTask` 成功 + 有 TaskId）** —— 与计费同一处，插入一行 `model.Task`：

| 字段 | 值 |
|------|----|
| `TaskID` | 上游返回的 TaskId |
| `Platform` | `tencent_vod` |
| `UserId` / `ChannelId` / `Group` | 取自 context / `ch.Id` |
| `Quota` | 与消费日志同一 quota |
| `Action` | 规范化模型名，如 `vidu-q3` / `seedance-2.0-pro` |
| `Status` | `QUEUED`；`Progress` = `0%` |
| `SubmitTime` / `CreatedAt` | 当前时间 |
| `Properties` | `{UpstreamModelName, Resolution, Duration, AspectRatio}` |
| `PrivateData` | `{TokenId, TokenKey}`（供失败退还时反向扣减 token；复用 `TaskPrivateData.TokenId` + `resolveTokenKey`） |
| `Data` | 初始可空，成功后写结果 URL |

**轮询时（观察到 `DescribeTaskDetail` 透传）** —— 这是被动镜像的关键：

1. 从**请求 body** 取 `TaskId`，`model.GetByOnlyTaskId(taskId)` 找到镜像行（platform=tencent_vod；非本平台/找不到则跳过）。
2. 从**上游响应**解析 `Status`（兼容 `Status`/`TaskStatus`/`TaskDetail.Status`/`AigcVideoTask.Status` 等多路径，与后端 `extractStatus` 一致）+ 结果视频 URL。
3. 规范化状态并更新该行（CAS/幂等，重复 poll 安全）：

   | 上游状态（小写归一） | TaskStatus | Progress | 备注 |
   |---|---|---|---|
   | finish/finished/success/succeed/.../done | `SUCCESS` | `100%` | 写 `FinishTime` + 结果 URL 到 `Data` |
   | failed/fail/error/cancel/exception/timeout | `FAILURE` | `100%` | 写 `FailReason` + **退还创建时扣的 quota**（见下） |
   | 其余（处理中/空） | `IN_PROGRESS` | `50%` | 终态前一直处理中 |

   因为后端会一直轮到终态，**终态那次 poll 也经过 proxy**，所以 new-api 能观察到 success/fail 并据此收尾——不依赖自身轮询。

**失败退还**：与 new-api 其他视频任务一致，镜像首次转入 `FAILURE` 时退还创建时扣的 quota：`model.IncreaseUserQuota(userId, task.Quota, true)` + `model.IncreaseTokenQuota(tokenId, tokenKey, task.Quota)`，并写一条退费日志（`RecordConsumeLog`，quota 取负 / 或 task 退费日志）。退还必须**幂等且只退一次**——用 `model.Task` 的状态机做 CAS（只在「非终态 → FAILURE」这一跳里退），重复 poll 不重复退；userId/tokenId/quota 从镜像行 `model.Task` 自身取（创建时已存），不依赖本次 poll 的 token 上下文。

**关键：把 `tencent_vod` 排除出 new-api 自身的任务轮询器**。`service/task_polling.go` 的 `TaskPollingLoop` 会捞所有未完成任务按平台分发，default 分支走 `UpdateVideoTasks` → `GetTaskAdaptorFunc(platform)`，而 `tencent_vod` 没有注册适配器 → 会每轮报 `video adaptor not found` 且任务永不收尾。
解决：在 `model.GetAllUnFinishSyncTasks` 查询里加 `platform != 'tencent_vod'`（new-api 不是这些任务的轮询者，统一由 proxy 被动镜像驱动）。`sweepTimedOutTasks` 的超时清理可保留（超时仍可置 FAILURE，作兜底），或一并排除——实现计划里二选一确认。

### 幂等

- 每个 HTTP 请求至多触发一次扣费（一次成功 create 响应 → 一次扣费），天然不会因「同一响应」重复扣。
- 为防极端的重复处理，按 `TaskId` 在带 TTL 的缓存（`common` 现有缓存/Redis）里做 best-effort 去重：同一 `TaskId` 已记账则跳过。
- 后端因 fallback 在不同 vendor 各自成功创建出的**不同** TaskId，视为不同任务、各自计费（符合真实成本）。
- v1 不引入持久化幂等表；如后续需要强一致再加 DB 唯一键。

## 数据流

```
backend → POST /proxy/tencent/vod (TokenAuth: 注入 userId/tokenId/...)
        → proxyTencent: TC3 签名 → 转发腾讯 → 读回 (status, respBody)
        → observeTencentVodTask:
            ├─ action==CreateAigcVideoTask && 2xx && TaskId 非空 ?
            │    是 → 解析 reqBody 定价 → quota=credits×5000
            │       → 【调用日志】Decrease(User,Token)Quota + UpdateUsed(User,Channel) + RecordConsumeLog
            │       → 【视频记录】INSERT model.Task(platform=tencent_vod, status=QUEUED, ...)
            │    否 → 跳过
            └─ action==DescribeTaskDetail ?
                 是 → 取 reqBody.TaskId → GetByOnlyTaskId → 解析 respBody.Status/URL
                    → 【视频记录】UPDATE model.Task 状态/进度/结果（被动镜像，不扣费）
                 否 → 跳过
        → 原样写回客户端响应

new-api TaskPollingLoop（自身轮询器）：跳过 platform=tencent_vod（不抢轮询）
```

## 错误处理

- 计费链路任何失败（解析、查表、扣费、日志）一律 `common.SysLog` 记录并**吞掉**，绝不改变对客户端/后端的透传响应。优先保证视频功能可用，统计可后补。
- 上游非 2xx / 无 TaskId：不扣费、不写消费日志（可选写一条 error 日志便于排查，非必须）。
- 余额不足：`Decrease*Quota` 会返回错误；过渡期策略为**仅记录告警**、不阻断（因当前透传已发生、任务已在腾讯侧创建，阻断无意义）。后续如需「预扣 + 阻断」再单独设计。
- 任务失败：镜像首次转入 `FAILURE` 时**退还**创建时扣的 quota（`IncreaseUserQuota` + `IncreaseTokenQuota` + 退费日志），靠 `model.Task` 状态机 CAS 保证只退一次；与 new-api 其他视频任务行为一致。

## 测试

- 单测 `billTencentVodTaskIfNeeded`：
  - `CreateAigcVideoTask` + 2xx + 有 TaskId → 计算 quota 正确、调用各记账原语（用接口/mock 断言）。
  - `DescribeTaskDetail` → 不计费。
  - 非 2xx / 无 TaskId → 不计费。
  - 各 ModelName/ModelVersion/Duration/Resolution → quota 计算符合价格表。
  - 未知模型 → 兜底价 + 告警。
- 定价纯函数 `computeTencentVodQuota(reqBody)` 抽出，独立表驱动单测覆盖矩阵。
- 视频记录镜像单测：
  - 创建成功 → 插入 `model.Task`（platform/status/quota/properties 正确）。
  - `DescribeTaskDetail` 返回 processing/success/failed → 对应行更新为 IN_PROGRESS / SUCCESS(+URL) / FAILURE(+FailReason)。
  - TaskId 找不到对应镜像行 → 安全跳过。
  - `GetAllUnFinishSyncTasks` 不返回 tencent_vod 行（轮询器不抢）。
- 手测：真实跑一个 vidu-q3 任务，确认 (1) new-api 消费日志出现该记录、apikey 余额减少、渠道用量增加；(2)「视频/任务」视图出现该任务并最终变为成功、带视频结果。

## 影响文件（预估）

- `new-api/controller/tencent_proxy.go`（改透传为「读回 reqBody/respBody → 观察记账 → 写回」，新增 `observeTencentVodTask`：创建时计费+插任务、轮询时镜像任务）
- `new-api/controller/tencent_vod_pricing.go`（新增：价格表 + `computeTencentVodQuota` 纯函数）
- `new-api/controller/tencent_vod_task.go`（新增：插入/更新 `model.Task` 镜像 + 状态映射，可与上文合并）
- `new-api/constant/task.go`（新增 `TaskPlatformTencentVod`）
- `new-api/model/task.go`（`GetAllUnFinishSyncTasks` 加 `platform != 'tencent_vod'` 排除）
- `new-api/controller/tencent_proxy_test.go`（新增单测）
- 后端：**无需改动**（方案A 不依赖后端传价；创建/轮询本就经过 proxy）。

## 非目标 / 后续

- 不追求与后端 credits 分毫对齐（过渡期）。
- 不做预扣+阻断、不做持久化幂等表、不引入实时汇率。
- 失败退还采用「创建全扣 + 失败整退」，不做按进度的差额结算。

## 已知限制（过渡期可接受，codex 评审标注）

- **去重非原子**：`GetByOnlyTaskId → Insert` 非原子，`task_id` 仅普通索引。理论上两个并发 create 观察到**同一** TaskId 可能重复插入+重复扣费。实际上腾讯每次 create 返回**唯一** TaskId、且一次 HTTP 请求只触发一次 observe，故概率接近 0。不加全局唯一约束（`task_id` 在其它平台允许为空/重复，加约束有回归风险）。如将来需要强一致，再加 `(platform, task_id)` 唯一索引 + upsert。
- **计费非事务**：扣 user/token、用量统计、写日志不在同一事务；若其中一步扣费失败（多为余额不足/DB 错误，apikey 余额充足时罕见），失败退还按全额退可能在该侧多退。过渡期定价仅统计、不追求分毫对账，可接受。如需精确：记录实际扣成功金额，退款只退实际扣款。
- 双轨结束后若要「new-api 成为唯一计费源」，再评估迁移到 codex 推荐的「后端传 `X-Billing-Credits`，new-api 单一事实源记账」方案。
