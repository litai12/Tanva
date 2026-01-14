# 前端模块：状态管理（frontend-stores）

## 作用
- 使用 Zustand 管理全局状态，例如认证态、项目列表、工作区状态等。

## 关键目录
- `frontend/src/stores/`：各类 store 定义（以文件实现为准）

## 交互要点
- `ProtectedRoute` 在首次挂载时触发 `authStore.init()`，避免无意义的“每次打开页面就请求一次 /api/auth/me”。

