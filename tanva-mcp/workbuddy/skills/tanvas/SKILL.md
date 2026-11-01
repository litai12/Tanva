---
name: tanvas
display_name: Tanvas
display_name_en: Tanvas
description: 操作用户的 Tanvas（tanvas.cn）账号：一键成片、爆款复刻、生成视频与图片、查询积分、管理项目，以及调用任意 Tanvas 接口。触发词：Tanvas、tanvas、一键成片、爆款复刻、生成视频、生成图片、画布项目、积分余额。
description_zh: 在对话中直接使用 Tanvas：一键成片、爆款复刻、AI 生视频与生图
description_en: Use Tanvas in chat — one-click films, viral remakes, AI video and image generation
version: 1.1.1
author: Tanvas
examples_zh:
  - "用 Tanvas 把这段故事做成 30 秒竖屏短片"
  - "用 Tanvas 复刻这个爆款视频 https://…/demo.mp4"
  - "用 Tanvas 生成一张极简风格的咖啡品牌海报"
examples_en:
  - "Check my Tanvas credits"
  - "Generate a minimalist coffee brand poster with Tanvas"
---

# Tanvas

Tanvas 连接器以**用户在浏览器中 OAuth 授权的身份**访问其 Tanvas 账号，权限与用户网页登录完全相同。

## 授权

首次使用时 WorkBuddy 会自动打开 Tanvas 授权页：用户登录 Tanvas 后点击「授权」即可。若工具返回「需要授权 / 授权已失效」，请提示用户在连接器中重新点击「连接」。

## 工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `tanva_list_models` | 可用模型（规划 / 生图 / 视频）、是否可用、参考价格 | `category`：plan / image / video（可选） |
| `tanva_make_video` | **一键成片 / 爆款复刻**（服务端全自动：规划 → 参考图 → 视频 → 合成，**消耗积分**） | `mode`：film（`story` 必填）/ remake（`referenceVideoUrl` 必填）；`referenceImageUrls`、`requirements`、`planModel` / `imageModel` / `videoModel`、`aspectRatio`、`resolution`、`targetSeconds` |
| `tanva_generate_video` | 单段生视频（**消耗积分**） | `prompt` 必填；`model`、`durationSeconds`、`aspectRatio`、`resolution`、`firstFrameUrl` 或 `referenceImageUrls` |
| `tanva_video_job` | 查询成片 / 视频进度与结果 | `jobId`，`waitSeconds` ≤ 20 |
| `tanva_video_produce` | 余额不足暂停后继续（可改分镜） | `jobId`，`clipEdits` |
| `tanva_video_retry` / `tanva_video_cancel` | 只重跑失败部分 / 取消 | `jobId` |
| `tanva_list_video_jobs` | 最近的成片任务 | `limit` |
| `tanva_whoami` | 当前授权账号 | 无 |
| `tanva_credits_balance` | 积分余额与明细 | 无 |
| `tanva_list_projects` | 项目列表 | `scope`: personal / team（可选），`teamId`（scope=team 时必填） |
| `tanva_get_project` | 项目详情 | `projectId`（必填），`includeContent`（默认 false，画布 JSON 很大） |
| `tanva_generate_image` | AI 生成图片（**消耗积分**） | `prompt`（必填），`aspectRatio` 如 1:1 / 16:9，`imageSize` 如 1K/2K/4K，`aiProvider`，`imageUrls` 参考图（公网 URL），`waitSeconds` ≤ 20 |
| `tanva_get_image_task` | 查询生图任务 | `taskId`（必填），`waitSeconds` ≤ 20 |
| `tanva_list_endpoints` | 搜索 Tanvas 全部接口 | `keyword`，`method`，`limit` |
| `tanva_describe_endpoint` | 查看接口参数 / 请求体 | `method`，`path`（如 `/api/projects/{id}`） |
| `tanva_api_request` | 调用任意 `/api/*` 接口 | `method`，`path`（路径参数直接填入），`query`，`body`，`teamId` |

## 使用规则

1. **一键成片 / 爆款复刻 / 生视频**：调用 `tanva_make_video` 或 `tanva_generate_video` 后拿到 `jobId`，之后每次用 `tanva_video_job`（`waitSeconds: 20`）轮询，向用户简要汇报进度（规划完成后可用文字展示分镜 `storyboard` 和预估积分 `estimate`）。整条片约 5–15 分钟，**不要重复提交**。完成后把 `finalVideoUrl` 以视频形式发给用户。
   - 用户要求指定模型时，先 `tanva_list_models` 再传 `planModel` / `imageModel` / `videoModel`；`available: false` 的模型不可用，把 `reason` 告诉用户。
   - `status: paused`（余额不足）：告诉用户预估积分与当前余额，用户充值并同意后调用 `tanva_video_produce`。
   - `status: failed`：转述 `error`；用户同意后调用 `tanva_video_retry` 只重跑失败部分。
   - 素材只接受**公网 URL**（图片 / 视频），本地文件请让用户先上传到可公开访问的地址。
2. **生图**：调用 `tanva_generate_image` 后，若返回 `status` 不是 `succeeded` 而是带 `taskId` 的进行中结果，用 `tanva_get_image_task` 轮询，**不要重复提交**（每次提交都会扣积分）。成功后把 `imageUrl` 以图片形式展示给用户。
3. **内置工具优先**；内置工具覆盖不到时：`tanva_list_endpoints` 搜索 → `tanva_describe_endpoint` 看参数 → `tanva_api_request` 调用。
4. **高风险操作必须先向用户确认**：删除（DELETE）、覆盖保存项目内容、分享 / 转移到团队、支付 / 会员、批量或高价生成（视频、4K 等）。确认时说明操作对象和预计积分消耗（可先调用 `POST /api/credits/preview` 预估）。
5. 生成类耗时接口优先用 `*-async` 版本并轮询任务，单次工具调用需在 30 秒内返回。
6. 团队空间操作需传 `teamId`。

## 错误处理

- `isError: true` 且含 `status` / `message`：把 `message` 转述给用户；403 表示无权限，404 表示资源不存在，402/积分相关提示需引导用户充值。
- 「授权已失效」：请用户在 WorkBuddy 连接器中重新连接 Tanvas。
- 超时：改用异步接口，或稍后用任务 ID 查询。
