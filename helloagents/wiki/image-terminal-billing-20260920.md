# 图片重复提交与终态计费（2026-09-20）

## 原因

new-api 图片 Provider 在超时/断连后最多发三次 POST，控制器对结果解析和资产保存错误还有一层重试；一次预扣可能触发多个上游任务。同步 withCredits 没有阻止 duplicate 句柄继续生成。异步 Worker 仅检查读取时的 queued 快照，两个执行者可以同时通过；15 分钟 Promise.race、状态查询和积分定时清理又把本地超时当成失败，底层生成未停止却释放节点并退款。

## 执行合同

- new-api 网关 Images generations/edits 限制单模型、零渠道重试，避免网关在提交响应丢失后换渠道再次生成；其他协议策略不变。当前 buildModelsChain 已只返回原模型，显式策略也防止未来回退扩展影响图片。
- 生成、编辑、融合控制器和 new-api 图片 Provider 都只提交一次，不以网络、超时、空结果或保存失败作为重发理由。
- 同步重复预扣直接返回 409 和原 apiUsageId，不调用上游，不回滚原扣费。异步重复句柄结束当前冗余 job，不退款、不生成原任务。
- Worker 在预扣前执行 queued → processing 条件更新，只有抢占成功的执行者继续。apiUsageId 在上游调用前写入 ImageTask.requestData；队列重投递及进程重启不得重放 processing 任务。
- 图片使用稳定 task 幂等键；显式幂等键对 pending/success 不过期。同内容 pending 指纹不按 15 秒过期，同用户/项目/节点 pending 互斥不按年龄失效。多图 parallelGroupIndex 按槽位隔离，允许不同槽位各生成一次。
- 请求上下文保存调用结果是否明确被拒绝。new-api/Seedream HTTP 400/401/403/404/413/422 按明确拒绝回滚；断连、408、429、5xx、空结果、上游成功后的保存失败保留预扣/团队预留并标记 reconciliation_required。new-api 本地校验/缺少配置在 POST 前失败可退款。其他原生 Provider 无法证明拒绝的错误保守保留待核实。
- 团队预留过期只触发核对：仅关联用量已经 FAILED 时可释放，pending/success/无记录不能按 20 分钟 TTL 释放。批次按 ID 轮转，避免前 200 条待核实记录阻塞其他记录。
- 去掉 Worker 的外层超时竞速和查询侧超时失败；new-api 与 Seedream 请求本身有 15 分钟传输上限。停止图片仅按年龄自动退款。
- 已收到的上游远程 URL 在处理图片/上传 OSS 前保存到用量参数 upstreamImageUrls，不保存 base64。日志以 IMAGE_RECONCILIATION_REQUIRED + taskId/apiUsageId 关联。
- 前端只有服务端终态才结束生成等待；15 分钟后改为 30 秒轮询。排队超时必须得到服务端取消确认才结束，取消返回冲突/断网继续查询原任务。

## 未知结果与运维

同步 Images API 丢失响应时没有可查询 taskId，不能凭时间推断失败。这类任务保留待核实，不能自动重提或退款；可能需要人工核对网关请求追踪与供应商账单。无 nodeId 的旧客户端只能依靠幂等键或相同请求指纹，不能推断修改过内容的两次请求是同一个节点。

排查时先读取 ApiUsageRecord 的用户、模型、requestParams.taskId / upstreamImageUrls / imageSubmissionState，再读取对应 ImageTask.requestData.apiUsageId 和错误日志。已有远程 URL 的任务优先恢复既有产物；未知请求核实真实上游结果后再按原账本结算。不得重新运行生成接口来“恢复”旧任务，不得直接全量清理 pending。这次不改历史账本，不证明 9 月 19 日任务来源，也不保证外部网关或供应商自身不会重复执行。

需要一起发布前端、后端并重建/更新 new-api 网关容器；无 schema 迁移。按用户指示本地提交推送，未 SSH 部署、未确认 101 自动部署结果。旧进程中的在途请求不受新版本追溯控制。

## 验证

- `backend/scripts/verify-image-terminal-billing.ts`：重复句柄不调用/退款；断连、504 单次 POST；明确拒绝退款；成功后 OSS 失败保留预扣及 URL；并发 Worker 只有一次抢占、预扣与提交；旧 pending 查询不改终态；取消按年龄退款；图片节点/幂等键/指纹不超时释放；团队 pending/success/未知预留不按 TTL 释放，确认失败可释放。
- `frontend/scripts/verify-image-poller.cjs`：生成超时不结束，排队取消冲突不结束，确认取消才结束。
- new-api/controller 图片尝试策略与原模型路由测试。
- 视频终态计费、图片 payload、文本终态计费回归及前后端构建。

验证结果：图片/视频终态计费、图片请求格式、文本计费、前端轮询测试、前后端构建与改动轮询文件 ESLint 通过；new-api 图片尝试策略定向测试及 relay/apimart/tencent 三包通过。controller 全包存在两个模型目录测试失败（veo-3.1 / veo3.1-pro），使用 HEAD 原文件 overlay 单独复现同样失败，属于既有问题。
