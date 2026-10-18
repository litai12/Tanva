# 水印权益全链路统一（2026-10-17）

## 问题

Nano Banana 2.1 专属节点走同步 `/ai/generate-image`，会经过 `canSkipWatermark` 并加水印；正常生图节点（`generate` / `generatePro`）以及 GPT Image 2.5、Seedream 5、Generate 4、小T生图走异步 `/ai/generate-image-async`，`ImageTaskService` 落 OSS 前从不调用水印，也不判断权益。结果是同一个模型因入口不同而水印表现不一致。

## 权益规则

用户确认：**有效会员期限内、统一白名单“去水印”、管理员均免水印；去水印是会员权限**。

- 有效会员：`UserMembershipSubscription` 满足 `status=active`、`currentPeriodStartAt <= now < currentPeriodEndAt`
- 白名单：`User.noWatermark=true`（统一白名单“去水印”）；`vipEntitlementWhitelist=true` 通过 `resolveEffectiveMembershipPlan` 解析为最高档年卡套餐
- 管理员：`admin` / `normal_admin`
- 其他用户（含未登录 / API Key 匿名请求）：加水印
- 权益查询异常：按加水印处理（fail closed）

实现位于 `backend/src/ai/services/watermark-entitlement.service.ts`，同步图像/视频与异步图片任务共用同一判断。

## 链路覆盖

| 链路 | 入口 | 处理 |
| --- | --- | --- |
| 同步图片 | `generate-image` / `edit-image` / `blend-images` / `expand-image` | `AiController.canSkipWatermark` → 权益服务；base64 与远程 URL 均加水印 |
| 同步/异步视频 | Sora2 等已接入水印的路径 | 同一 `canSkipWatermark` |
| 异步图片 | `ImageTaskService.uploadImagePayloadToOss` / `uploadRemoteImageToOss` | 落 OSS 前按 `task.userId` 查询权益；加水印后重新推断 MIME（PNG）；`resultMetadata.watermarkSkipped` 回执 |
| 异步图片覆盖模型 | GPT Image 2.5、Seedream 5、Generate 4 / Pro 4、小T生图、Nano 2.1 异步入口 | 与同步链路一致 |

水印图仍为 `frontend/public/tanvas_ai.png`（或 `WATERMARK_PATH`），找不到或 sharp 失败时静默回退原图。

## 本地验证

- `cd backend && npm run test:watermark-entitlement`：管理员、normal_admin、白名单、有效会员（即使套餐 metadata 无 `noWatermarkAccess`）、年卡白名单、免费用户、匿名、查询失败、异步 base64/远程 URL 加水印与跳过均通过。
- `npm run test:image-reference-preparation`、`npm run test:image-generation-dto`、`npm run build` 通过。

## 生产发布（101）

- 提交 `af14c582` 已推送 `main`；101 `/www/wwwroot/tanvas.cn` 已 fast-forward 拉取。
- `backend && npm run test:watermark-entitlement` 通过；`npm run build` 通过；`pm2 reload tanvas-api` 后 `online`，restarts 14，`Nest application successfully started`，图片队列/worker 正常初始化。
- 公网 `https://tanvas.cn/api/health` 返回 `{"status":"ok"}`。
- 生产只读核验：有效会员 `true`、`noWatermark` 白名单 `true`、随机免费用户 `false`。
- 生产真实水印处理核验：300×200 PNG 经 `applyWatermarkToBuffer` 后字节变化、仍为 300×200 PNG，确认水印图可定位且 sharp 正常。
- 发布目录新增文件 `dist/ai/services/watermark-entitlement.service.{js,d.ts}` 已修正为 `www:www`。

## 回退

`git revert af14c582`（或 checkout 上一提交）后重新 `npm run build` 并 `pm2 reload tanvas-api`。无数据库迁移、无历史数据变更；已生成图片不回填。
