# 后端模块：模板（backend-templates）

## 作用
- 管理公共模板（`PublicTemplate`）的读写与分类。
- 提供用户私有模板（`UserTemplate`）的鉴权 CRUD，支撑“我的模板”跨设备同步。

## 关键文件
- `backend/src/templates/templates.controller.ts`：`/templates/*`（公共模板）
- `backend/src/admin/services/template.service.ts`（公共模板管理）
- `backend/src/user-templates/user-templates.controller.ts`：`/user-templates/*`（用户模板）
- `backend/src/user-templates/user-templates.service.ts`

## 数据模型关联
- `PublicTemplate`
- `UserTemplate`
