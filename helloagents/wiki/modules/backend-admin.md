# 后端模块：管理后台（backend-admin）

## 作用
- 提供管理侧的用户、API 使用、定价、系统设置、模板管理等接口。

## 关键文件
- `backend/src/admin/admin.controller.ts`：`/admin/*`
- `backend/src/admin/admin.service.ts`
- `backend/src/admin/services/template.service.ts`
- `backend/src/admin/dto/*`

## API（前缀 `/api/admin`，节选）
- `GET dashboard`
- `GET users` / `GET users/:userId`
- `POST users`: full-admin user creation using phone, password, name, and optional email; creates the personal team and credit account just like registration.
- `DELETE users/:userId`
- `POST users/:userId/unbind-wechat`
- `PATCH users/:userId/status` / `PATCH users/:userId/role`
- `POST users/:userId/credits/add` / `POST users/:userId/credits/deduct`
- `GET api-usage/stats` / `GET api-usage/model-stats` / `GET api-usage/records`
- `GET pricing`
- `GET settings` / `GET settings/:key` / `POST settings`
- `GET /api/settings/login-notice`：公开读取登录后用户提醒弹窗配置
- `POST templates` / `GET templates` / `GET templates/:id` / `PATCH templates/:id` / `DELETE templates/:id`
- `GET templates/categories` / `POST templates/categories`

## Admin RBAC
- `admin` is the highest admin-console role. It bypasses admin permission checks and can see/use all admin tabs and operations.
- `normal_admin` can enter the admin console; this is based on `User.role` and is independent of team roles/permissions.
- `normal_admin` keeps non-sensitive admin views including dashboard, user list, user details, order list, credit records/anomalies, API stats/records, public templates, team list, and team credit history.
- `normal_admin` is blocked from paid-user management, watermark whitelist, system settings, node management, user creation/deletion, user credit add/deduct, and user membership operations. Team credit add/deduct and team deletion are also backend-blocked because they mirror the same sensitive recharge/deduct/delete operations.

## API usage model monitoring
- `GET api-usage/model-stats` returns model-node usage monitoring data for the admin stats tab.
- Query params: `startDate`, `endDate`, `modelNode`, `channel`.
- Model/provider/service labels are merged into one uppercase `modelName`; Sora is not listed as a default monitored model node.
- Default monitored nodes include NANO BANANA GEMINI IMAGE GENERATION / EDIT / BLEND, NANO BANANA GEMINI IMAGE ANALYSIS, GPT-IMAGE-2 IMAGE GENERATION, DOUBAO SEEDREAM 5.0 IMAGE GENERATION, MIDJOURNEY V7 / V8 / NIJI 7 IMAGE GENERATION, GEMINI AI TEXT CHAT, GEMINI PROMPT OPTIMIZE / STORYBOARD TEXT, SEEDANCE 1.5 / SEEDANCE 2.0 / SEED 2.0 VIDEO, KLING 2.6 / KLING 3.0 / KLING O1-O3 VIDEO, VIDU Q2 / VIDU Q3 VIDEO, WAN 2.6 / WAN 2.7 VIDEO, HAPPYHORSE 1.0 R2V VIDEO, OMNI FLASH EXT VIDEO, GEMINI VIDEO ANALYSIS, SEED3D / 2D-TO-3D MODEL GENERATION, and MINIMAX / TENCENT AUDIO GENERATION.
- Fast/Pro/Ultra or version variants are grouped into the same model node where they share the same product family; `channels[]` keeps provider/channel breakdowns separately. Seedance grouping is limited to the Seedance/Seed video node family, while Kling, Seed3D/2D-to-3D, Wan, Vidu, and HappyHorse are resolved before the Seedance fallback.
- `topUsers` is limited to the Top10 users per model node and is sorted by consumed credits, then call count.
- User deletion probes production table/column presence before optional cleanup, so databases missing newer tables can still delete the account. It also clears `TeamProjectShare` rows for the user's projects and owned-team child rows before deleting owned `Team` records.

## 注意事项
- 认证/鉴权细节以 Guard 与具体实现为准（通常依赖 JWT + 用户 role/status）。
- 删除用户时，后端会在事务内先清理用户积分账户下的 `CreditTransaction`、`CreditLot`、`CreditAnomalyRecord`，再删除 `CreditAccount`；同时清理会员订阅相关表（`UserMembershipSubscription`、`MembershipSubscriptionChange`、`MembershipEntitlementSnapshot`），避免外键冲突或孤儿数据。
- 系统设置中与供应商切换相关的 key：
  - `login_notice`：登录后用户提醒弹窗配置，值为 JSON 字符串，支持 `contentHtml` 受限富文本、顶部 `mediaType/mediaUrl/posterUrl` 和底部主/次按钮配置；`content` 为兼容用纯文本
  - `banana_provider`：Banana 图像链路供应商
  - `banana_text_provider`：Banana 文本链路供应商（text-chat/tool-selection）
  - `seedream5_provider`：Seedream 5.0 图像链路供应商（`doubao` / `watcha`）
- Sora2 不再通过系统设置切换供应商，统一在 `model_provider_mapping_v2` 中配置路由。
- `model_provider_mapping_v2.models[].vendors[]` 现支持正式 `pricing` 结构：
  - 推荐使用 `pricing.defaults` 维护默认价，支持 `credits`、`priceYuan` 等多价格字段。
  - 推荐使用 `pricing.rules[]` 维护规格组合价，按 `when` 条件匹配。
  - 旧 `creditsPerCall` 与 `metadata.specPricing` 仍兼容读取，管理台保存时会同步写入新结构。
  - Flow 前端会优先采用模型管理里的默认线路价格；若用户手动切换线路，则回显并传递对应 vendor 的价格/标识。
- 模型管理配置 key `model_provider_mapping_v2` 中的 `models[]` 允许“真删除”：
  - 前端管理页不会再在归一化时把默认模型目录补回已保存配置。
  - 后端读取该设置时，仅在整项配置缺失时回退默认目录；若设置已存在，则以保存内容为准，不自动复活被删除模型。
