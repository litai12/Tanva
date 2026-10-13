# 画布横向显示控件

## 问题与行为

独立色盘曾固定在 `bottom:160px`，眼睛固定在 `bottom:120px`。左侧工具栏居中且高度随模式变化，短屏下其底部会覆盖色盘。显示控件现由 `CanvasViewControls` 统一布置，默认仅显示折叠入口，点击后向右横向展开眼睛与色盘，眼睛仍切换专注模式。

- 网页保持默认 Tab 专注模式快捷键；收起时 `FocusModeButton` 仍挂载快捷键监听。输入框、弹层、输入法及控件内键盘导航沿用现有隔离规则。
- 色盘不改变已有明暗主题独立偏好、预置色、HSV、HEX、重置与本地持久化行为。
- 显示控件为画布容器内绝对定位，按图层面板偏移和真实 ToolBar、ZoomIndicator 边界避让。容器与工具栏尺寸改变或位移动画结束时重新计算。
- 水平空间不足时优先采用紧凑横排（24px 按钮）；仍不足时使用工具栏下方或上方空位，不改工具栏或缩放控件原布局。
- 桌面插件保留既有无网页专注模式按钮的行为，只横向展开色盘；控件和色盘弹层不会固定到整个桌面窗口。
- 色盘点击外部、Escape、窗口失焦关闭；收起控件和最大化聊天时卸载色盘，恢复聊天尺寸时不重开旧弹层。Escape 在色盘内先关闭色盘，在显示控件入口处收起横排。
- 整条控件行带 `data-canvas-control`，点击、滚轮及编辑不会流入画布事件总线。

## 实现范围

`frontend/src/components/canvas/CanvasViewControls.tsx` 管理折叠状态、工具栏/缩放避让与主题外观；`FocusModeButton.tsx` 管理原专注行为和快捷键；`CanvasBackgroundPicker.tsx` 管理色盘与容器边界定位；`canvasBackground.css` 管理横排样式；`Canvas.tsx` 统一挂载。

不修改 FlowOverlay，不改设计 JSON，不提交媒体任务，也不改变已有 ToolBar 与 ZoomIndicator 的布局。

## 验证

- `node scripts/verifyCanvasBackgroundBrowser.mjs`：通过。挂载真实 ToolBar、ZoomIndicator、GridRenderer、React Flow 和显示控件，开启 Flow 入口后网页工具栏实测 419px，桌面 459px。验证 700px / 600px 高度下折叠/展开与图层开关的几何无交叠、横向同排、默认折叠 Tab、眼睛点击、Escape、颜色/HEX/主题/刷新/重置、画布事件隔离、聊天最大化关闭状态。
- 450px 宽网页画布且图层展开：横排位于 `(328,517.5)`，尺寸 `114×42`，与工具栏及缩放控件无交叠。
- 450px 宽桌面画布且图层展开：横排本地坐标 `(380,366)`，尺寸 `62×34`，按钮为 24px，保留工具栏右侧 8px 间距。360px 宽桌面容器中的色盘完整位于画布边界内。
- 背景色 4 个纯函数测试、新控件与色盘的定向 ESLint 通过。
- 浏览器截图：`/tmp/tanva-canvas-view-controls-700.png`、`/tmp/tanva-canvas-view-controls-600.png`、`/tmp/tanva-canvas-view-controls-embedded-layers.png`、`/tmp/tanva-canvas-view-controls-embedded-dark.png`。

## 2026-10-13 发布到 101

- 运行时代码：`46557338b7fc97d463954dad980291a8434eb54c`，已推送 main。使用该提交的独立归档构建，未包含工作区其他未提交功能。
- TypeScript/Vite 生产构建、已提交版本的背景/横向布局浏览器回归与自定义快捷键浏览器回归通过。原仓库全量 lint 存在既有错误；此次新控件定向 ESLint 通过。
- 2026-10-13 14:14:36 UTC 发布至 `101.96.227.228`，48 个文件哈希校验通过。14:14:47 UTC 公网 HTML、主 JS/CSS 哈希、版本 `46557338b7fc` 和 `/api/health` 均通过，旧主 JS 仍可访问。
- 发布记录：`/opt/tanva-releases/canvas-dock-20261013-46557338/`；回退备份：`/opt/tanva-backups/canvas-dock-20261013-46557338/frontend-dist/`。后端未重启，无数据库变更。
