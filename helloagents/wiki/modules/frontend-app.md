# 前端模块：应用入口与路由（frontend-app）

## 作用
- 负责应用入口渲染、路由定义与受保护路由的初始化策略。

## 关键文件
- `frontend/src/main.tsx`：路由表（Home/Login/Register/Workspace/App/Admin/MyCredits 等）
- `frontend/src/routes/ProtectedRoute.tsx`：延迟初始化认证状态，避免首页加载即请求 `/api/auth/me`
- `frontend/src/App.tsx`：主应用（工作区/画布等以实现为准）

## AI 对话框右键菜单
- 对话框内容区有文本选中时，放行浏览器默认右键菜单用于复制文本。
- 无选中文本时保留自定义右键菜单（复制对话 JSON/文本等）。

## 离开保护（上传中/待上传）
- 编辑器（`/app`）内若存在上传中/待上传图片（含 Flow 内联图片引用），在离开页面/切换项目/退出登录/浏览器前进后退时会弹出确认提示，避免误操作导致图片丢失或无法保存到云端。

## 路由约定（节选）
- 公开：`/`、`/auth/login`、`/auth/register`、`/oss`、`/runninghub-test`
- 受保护：`/workspace`、`/app`、`/admin`、`/my-credits`
