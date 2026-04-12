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
- `DELETE users/:userId`
- `PATCH users/:userId/status` / `PATCH users/:userId/role`
- `POST users/:userId/credits/add` / `POST users/:userId/credits/deduct`
- `GET api-usage/stats` / `GET api-usage/records`
- `GET pricing`
- `GET settings` / `GET settings/:key` / `POST settings`
- `POST templates` / `GET templates` / `GET templates/:id` / `PATCH templates/:id` / `DELETE templates/:id`
- `GET templates/categories` / `POST templates/categories`

## 注意事项
- 认证/鉴权细节以 Guard 与具体实现为准（通常依赖 JWT + 用户 role/status）。
- 删除用户时，后端会在事务内先清理用户积分账户下的 `CreditTransaction`、`CreditLot`、`CreditAnomalyRecord`，再删除 `CreditAccount`；同时清理会员订阅相关表（`UserMembershipSubscription`、`MembershipSubscriptionChange`、`MembershipEntitlementSnapshot`），避免外键冲突或孤儿数据。
- 系统设置中与供应商切换相关的 key：
  - `banana_provider`：Banana 图像链路供应商
  - `banana_text_provider`：Banana 文本链路供应商（text-chat/tool-selection）
  - `seedream5_provider`：Seedream 5.0 图像链路供应商（`doubao` / `watcha`）
- Sora2 不再通过系统设置切换供应商，统一在 `model_provider_mapping_v2` 中配置路由。
- `model_provider_mapping_v2.models[].vendors[]` 现支持正式 `pricing` 结构：
  - 推荐使用 `pricing.defaults` 维护默认价，支持 `credits`、`priceYuan` 等多价格字段。
  - 推荐使用 `pricing.rules[]` 维护规格组合价，按 `when` 条件匹配。
  - 视频模型支持 `pricing.formula` 维护“基础价 + 增量项”计价；适合配置“每秒基础价 + 某分辨率/模式额外加价”这类线性报价。
  - 视频模型支持 `pricing.defaultAvailable=false`，表示“未命中规则/公式时默认不可用”；仅当运营显式勾选“允许回退默认价”时，`pricing.defaults` / `creditsPerCall` 才会作为兜底价格生效。
  - 视频模型管理页已将复杂条件收口为业务维度下拉：`resolution`、`duration`、`inputType`、`hasAudio`、`aspectRatio`。运营应优先使用这些 canonical 语义，而不是手写底层请求字段名。
  - 管理台内置“定价预览面板”：支持当前模型条件试算与全部模型默认规格总览，直接展示来源、积分、价格和公式拆解，便于运营自查配置结果。
  - 旧 `creditsPerCall` 与 `metadata.specPricing` 仍兼容读取，管理台保存时会同步写入新结构。
  - Flow 前端会优先采用模型管理里的默认线路价格；若用户手动切换线路，则回显并传递对应 vendor 的价格/标识。
- 模型管理配置 key `model_provider_mapping_v2` 中的 `models[]` 允许“真删除”：
  - 前端管理页不会再在归一化时把默认模型目录补回已保存配置。
  - 后端读取该设置时，仅在整项配置缺失时回退默认目录；若设置已存在，则以保存内容为准，不自动复活被删除模型。
