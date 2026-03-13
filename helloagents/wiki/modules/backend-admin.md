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
- `PATCH users/:userId/status` / `PATCH users/:userId/role`
- `POST users/:userId/credits/add` / `POST users/:userId/credits/deduct`
- `GET api-usage/stats` / `GET api-usage/records`
- `GET pricing`
- `GET settings` / `GET settings/:key` / `POST settings`
- `POST templates` / `GET templates` / `GET templates/:id` / `PATCH templates/:id` / `DELETE templates/:id`
- `GET templates/categories` / `POST templates/categories`
- API 健康与深度监测：
- `GET api-health/configs` / `GET api-health/nodes`
- `POST api-health/check` / `POST api-health/check/:nodeKey`（兼容旧入口）/ `POST api-health/check-by-node/:nodeKey`
- `PATCH api-health/nodes/:nodeKey/binding`（写入/清除 `metadata.apiHealth.configId`）
- `POST api-health/e2e/:provider`（兼容入口）
- `POST api-health/e2e-by-id/:id` / `POST api-health/e2e-by-node/:nodeKey`（推荐按业务节点触发）

## 注意事项
- 认证/鉴权细节以 Guard 与具体实现为准（通常依赖 JWT + 用户 role/status）。
- 供应商深度拨测（`SupplierTestService`）会对 API Key 做标准化（去掉 `Bearer ` 前缀和空白），并对 Doubao 进行多 endpoint 回退（含 `401/403/404`）以适配代理路由差异。
- `VIDU_NATIVE` 在代理网关场景支持多路径提交回退（`/ent/v2/text2video`、`/vidu/ent/v2/text2video`、`/v2/text2video`），并按命中提交路径动态生成轮询地址（`/tasks/:taskId/creations`）。
- API 节点监测配置支持 `modelName`（模型标识）字段；L2 深度拨测 Payload 将优先使用该字段注入协议请求体，不再仅依赖协议内硬编码模型名。
- API 健康日志已下沉到节点级主键 `configId`：L1/L2 写日志、最新 E2E 结果、历史趋势聚合均按 `configId` 处理，避免同 provider 多模型互相覆盖。
- `GET api-health/nodes` 返回 `bindingStrategy`（`MANUAL` / `METADATA` / `MATCH` / `FALLBACK`），用于说明当前节点与底层通道的绑定来源。
