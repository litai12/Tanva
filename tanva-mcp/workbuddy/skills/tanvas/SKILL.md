---
name: tanvas
display_name: Tanva 画布
display_name_en: Tanva Canvas
description: 操作用户的 Tanva（tanvas.cn）AI 设计画布账号：查询积分、浏览/管理项目、AI 生成图片，以及调用任意 Tanva 接口。触发词：Tanva、tanvas、画布项目、生成图片、积分余额。
description_zh: 在对话中直接使用 Tanva：查积分、管项目、AI 生图
description_en: Use Tanva in chat — credits, projects and AI image generation
version: 1.0.0
author: Tanva
examples_zh:
  - "看看我的 Tanva 积分"
  - "用 Tanva 生成一张极简风格的咖啡品牌海报"
examples_en:
  - "Check my Tanva credits"
  - "Generate a minimalist coffee brand poster with Tanva"
---

# Tanva 画布

Tanva 连接器以**用户在浏览器中 OAuth 授权的身份**访问其 Tanva 账号，权限与用户网页登录完全相同。

## 授权

首次使用时 WorkBuddy 会自动打开 Tanva 授权页：用户登录 Tanva 后点击「授权」即可。若工具返回「需要授权 / 授权已失效」，请提示用户在连接器中重新点击「连接」。

## 工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `tanva_whoami` | 当前授权账号 | 无 |
| `tanva_credits_balance` | 积分余额与明细 | 无 |
| `tanva_list_projects` | 项目列表 | `scope`: personal / team（可选），`teamId`（scope=team 时必填） |
| `tanva_get_project` | 项目详情 | `projectId`（必填），`includeContent`（默认 false，画布 JSON 很大） |
| `tanva_generate_image` | AI 生成图片（**消耗积分**） | `prompt`（必填），`aspectRatio` 如 1:1 / 16:9，`imageSize` 如 1K/2K/4K，`aiProvider`，`imageUrls` 参考图（公网 URL），`waitSeconds` ≤ 20 |
| `tanva_get_image_task` | 查询生图任务 | `taskId`（必填），`waitSeconds` ≤ 20 |
| `tanva_list_endpoints` | 搜索 Tanva 全部接口 | `keyword`，`method`，`limit` |
| `tanva_describe_endpoint` | 查看接口参数 / 请求体 | `method`，`path`（如 `/api/projects/{id}`） |
| `tanva_api_request` | 调用任意 `/api/*` 接口 | `method`，`path`（路径参数直接填入），`query`，`body`，`teamId` |

## 使用规则

1. **生图**：调用 `tanva_generate_image` 后，若返回 `status` 不是 `succeeded` 而是带 `taskId` 的进行中结果，用 `tanva_get_image_task` 轮询，**不要重复提交**（每次提交都会扣积分）。成功后把 `imageUrl` 以图片形式展示给用户。
2. **内置工具优先**；内置工具覆盖不到时：`tanva_list_endpoints` 搜索 → `tanva_describe_endpoint` 看参数 → `tanva_api_request` 调用。
3. **高风险操作必须先向用户确认**：删除（DELETE）、覆盖保存项目内容、分享 / 转移到团队、支付 / 会员、批量或高价生成（视频、4K 等）。确认时说明操作对象和预计积分消耗（可先调用 `POST /api/credits/preview` 预估）。
4. 生成类耗时接口优先用 `*-async` 版本并轮询任务，单次工具调用需在 30 秒内返回。
5. 团队空间操作需传 `teamId`。

## 错误处理

- `isError: true` 且含 `status` / `message`：把 `message` 转述给用户；403 表示无权限，404 表示资源不存在，402/积分相关提示需引导用户充值。
- 「授权已失效」：请用户在 WorkBuddy 连接器中重新连接 Tanva。
- 超时：改用异步接口，或稍后用任务 ID 查询。
