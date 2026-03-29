# 前端模块：应用入口与路由（frontend-app）

## 作用
- 负责应用入口渲染、路由定义与受保护路由的初始化策略。

## 关键文件
- `frontend/src/main.tsx`：路由表（Home/Login/Register/Workspace/App/Admin/MyCredits 等）
- `frontend/src/routes/ProtectedRoute.tsx`：延迟初始化认证状态，避免首页加载即请求 `/api/auth/me`
- `frontend/src/App.tsx`：主应用（工作区/画布等以实现为准）

## AI 对话框右键菜单
- 对话框内容区使用浏览器默认右键菜单。

## AI 对话框图片模式可用性
- 手动模式会根据当前图片数量自动禁用不支持选项，并在不兼容时回退到 Auto。
- 发送按钮在模式不支持当前图片数量时禁用并提示原因。

## 离开保护（上传中/待上传）
- 编辑器（`/app`）内若存在上传中/待上传图片（含 Flow 内联图片引用），在离开页面/切换项目/退出登录/浏览器前进后退时会弹出确认提示，避免误操作导致图片丢失或无法保存到云端。

## 路由约定（节选）
- 公开：`/`、`/auth/login`、`/auth/register`、`/oss`、`/runninghub-test`
- 受保护：`/workspace`、`/app`、`/admin`、`/my-credits`

## 我的积分（`/my-credits`）
- 积分流水在“项目”列支持显示 AI 渠道与模型（如 `渠道：A · 模型：gemini-2.5-flash-image-preview`），用于定位实际执行链路。
- 概览卡片右上角提供“立即充值”文字按钮；点击后在当前页弹出 `PaymentPanel` 充值面板。
- `PaymentPanel`（`frontend/src/components/payment/PaymentPanel.tsx`）核心交互文案已接入 `useLocaleText`（订单状态、筛选、支付提示、二维码状态、手动核对按钮）。

## 双语适配（画布侧）
- `LayerPanel`（`frontend/src/components/panels/LayerPanel.tsx`）已接入 `useLocaleText`：面板标题、操作 tooltip、上下文菜单、待上传标识与底部统计文案均按语言切换。
- `LibraryPanel`（`frontend/src/components/panels/LibraryPanel.tsx`）已接入 `useLocaleText`：上传/删除/发送提示、详情面板字段、全局历史筛选和分页文案按语言切换。
- `ToolBar`（`frontend/src/components/toolbar/ToolBar.tsx`）已接入 `useLocaleText`：主工具 tooltip、线条样式面板、清空画布确认等高频交互文案双语化。
- `AIChatDialog`（`frontend/src/components/chat/AIChatDialog.tsx`）底部参数栏与上传菜单、历史会话工具条、图片/视频预览操作 tooltip 已按中英文切换（组件内通过 `i18n.language` + `lt()` 本地文案映射实现）。

## 工作区顶部帮助入口（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：问号按钮改为 hover 展开下拉菜单，不再直接点击跳转。
- 菜单项：`用户手册`（飞书文档）与 `更新日志`（仓库 `frontend/docs/06-变更日志.md`）。

## 工作区顶部积分入口（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：右上角工具区新增“积分”按钮（图标 + 当前余额），点击后新开页进入 `/my-credits`。
- 数据：复用顶部已加载的 `getMyCredits()` 结果（加载中显示 `...`，暂无数据显示 `--`）。

## 工作区设置弹窗（`/app`）
- 组件：`frontend/src/components/layout/FloatingHeader.tsx`
- 交互：切换左侧设置分组时，右侧内容滚动区域会回到顶部（不保留上一次分组的滚动位置）。
- 保存状态提示（如“有未保存更改”）放在设置首页用户信息区显示，不再在画布顶部常驻显示。
