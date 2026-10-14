# 101 图片上游合同与失败回执修复（2026-10-14）

## 证据与根因

审计窗口 UTC 2026-10-13 08:40 至 2026-10-14 08:40：1201 个唯一图片网关请求，1117 成功、82 失败、2 未终态；82 个失败均来自渠道 31 ToAPIs。其中 29 个是已受理后终态失败被适配器合成为 502，25 个是供应商直接 400，19 个审核、6 个参考图超 20MiB、2 个处理失败、1 个繁忙。不能把全部 502 当作网络故障，也不能把全部问题归咎于渠道。

已确认的本地问题：旧 Nano2 的 resolution/search 字段应放入 metadata；Gemini 3.1 编辑输入缺少按真实字节大小准备参考图；VIP 4K 不能统一按 4096 长边推算；异步失败缺少任务与退款回执。

## 修复合同

- 生成、编辑、融合共用远程参考图准备。已知 Gemini 3.1 上游限额为 20MiB；普通 GPT Image 2 为 50,000,000 字节。其他未确认模型不套用该限额。合规 HEAD 直接保留原 URL；未知长度回落有界下载。超限时生成新的远程派生资产，不覆盖原素材或裁剪引用，不持久化 base64。优先保尺寸，保留真实透明度；必要时按比例缩小。下载上限 64MiB，40M 像素，处理并发 2，HEAD 并发 8，每跳校验并绑定公网 DNS 地址。
- ToAPIs 旧 Nano2 与 Nano2.1 把分辨率、搜索开关放入 metadata，保留显式 false 与自定义 metadata，512 归一为 0.5K；其他 APIMart 渠道保持原合同。
- 仅修正已实测的 VIP 4K 比例映射：Sunburst 1:1 → 2880×2880，Flare 16:9 → 3840×2160。保留用户显式像素、quality 和 4K 报价档；重复归一化不得误按 2K 计费。
- 错误保留供应商 code/reason/upstream_code，以及 provider/task_id/request_id/status/accepted/terminal/billing_status。只有确切任务失败或取消且已退款才作为明确失败即时结算；轮询异常、费用未知或仍计费保留原任务核账，禁止自动重提。非 200 flat error 保留原始错误码。
- 带结构化上游回执的任务不得按年龄推定退款，需按原回执核账；无回执历史失败保留既有孤儿处理。用户手动重跑入口不变，原任务、提示词和素材不自动改写或重跑。

## 最小供应商验证及限制

四次独立中性文本请求，无用户素材、无用户钱包扣款，全部已终态；实际上游总成本 USD 0.02484。Flare VIP low 3840×2160 与 Sunburst VIP low 2880×2880 成功，并检查实际 PNG 尺寸。Flare VIP low 2880×2880 终态 invalid_input/invalid_request_error 并退款；普通 Flare 4K 1:2 只传 size 仍直接 400/fail_to_fetch_task，排除重复 aspect_ratio 是该例根因。

这只能证明上述两个型号/比例的低质量档可用，不能证明所有质量、比例与用户提示词都成功。其余供应商拒绝、审核与繁忙无法由本地补丁保证消除；不静默降级、不替换模型、不隐藏手动入口。探测证据保存在 101 的 /opt/tanva-releases/image-rootfix-20261014/probes/audit-summary.json，未向第三方发送用户任务。

官方合同来源：[旧 Nano2](https://docs.toapis.com/docs/cn/api-reference/images/gemini-3.1-flash/generation)、[GPT Image 2 编辑](https://docs.toapis.com/docs/cn/api-reference/images/gpt-image-2/edits)、[2.5 VIP](https://docs.toapis.com/docs/cn/api-reference/images/gpt-image-2.5-vip/generation)。普通 2.5 尺寸表不外推为 VIP 全比例保证。

## 验证与发布

定向 Go DTO、APIMart、relay、types、service 与 ToAPIS helper 回归通过；完整 helper 套件另有既存 StreamScanner ticker interval<=0 失败，不属于本次改动。后端验证覆盖参考图实文件、三入口、参数与回执透传、即时/延期退款边界及 VOD 回归。

发布遵循先提交推送、101 fast-forward、按提交隔离构建、等待在途图片任务结束、定向替换后端模块与网关镜像、校验健康与哈希。无数据库迁移，无前端发布，不连带发布已在源码但未上线的图片对比功能。发布实绩待部署后补录。
