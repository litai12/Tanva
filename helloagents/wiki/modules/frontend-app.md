# 前端模块：应用入口与路由（frontend-app）

## 作用
- 负责应用入口渲染、路由定义与受保护路由的初始化策略。

## 关键文件
- `frontend/src/main.tsx`：路由表（Home/Login/Register/Workspace/App/Admin/MyCredits 等）
- `frontend/src/routes/ProtectedRoute.tsx`：延迟初始化认证状态，避免首页加载即请求 `/api/auth/me`
- `frontend/src/App.tsx`：主应用（工作区/画布等以实现为准）

## 路由约定（节选）
- 公开：`/`、`/auth/login`、`/auth/register`、`/oss`、`/runninghub-test`
- 受保护：`/workspace`、`/app`、`/admin`、`/my-credits`

