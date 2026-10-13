# 画布横向显示控件

## 问题与行为

独立色盘曾固定在 `bottom:160px`，眼睛固定在 `bottom:120px`。左侧工具栏居中且高度随模式变化，短屏下其底部会覆盖色盘。显示控件现由 `CanvasViewControls` 统一布置，默认仅显示折叠入口，点击后横向展开眼睛与色盘，眼睛仍切换专注模式。

- 网页保持默认 Tab 专注模式快捷键；收起时 `FocusModeButton` 仍挂载快捷键监听。输入框、弹层、输入法及控件内键盘导航沿用现有隔离规则。
- 色盘不改变已有明暗主题独立偏好、预置色、HSV、HEX、重置与本地持久化行为。
- 显示控件为画布容器内绝对定位，箭头中心对齐真实 ToolBar 中心线，正常网页位置与 ZoomIndicator 共同为 `x=33px`，图层开启时跟随工具栏为 `x=347px`。容器与工具栏尺寸改变或位移动画结束时重新计算。
- 按钮保持 `32×32px`，箭头与眼睛图标均为 `16×16px`。横排外壳无背景、边框、阴影与内边距；箭头悬停也保持透明，键盘 `focus-visible` 保留焦点轮廓。色盘弹层保留独立的背景和阴影。
- 优先使用工具栏下方的真实空隙，通常保留 8px 间距，空隙紧张但仍有 32px 时减少间距；不足 32px 时移到工具栏上方并保持中心线。右侧空间不足时向左横向展开，折叠与展开不移动箭头，方向图标跟随实际展开方向；只有箭头本身超出画布时才约束到容器边界。
- 桌面插件保留既有无网页专注模式按钮的行为，只横向展开色盘；控件和色盘弹层不会固定到整个桌面窗口。
- 色盘点击外部、Escape、窗口失焦关闭；收起控件和最大化聊天时卸载色盘，恢复聊天尺寸时不重开旧弹层。Escape 在色盘内先关闭色盘，在显示控件入口处收起横排。
- 整条控件行带 `data-canvas-control`，点击、滚轮及编辑不会流入画布事件总线。

## 实现范围

`frontend/src/components/canvas/CanvasViewControls.tsx` 管理折叠状态、工具栏/缩放避让与主题外观；`FocusModeButton.tsx` 管理原专注行为和快捷键；`CanvasBackgroundPicker.tsx` 管理色盘与容器边界定位；`canvasBackground.css` 管理横排样式；`Canvas.tsx` 统一挂载。

不修改 FlowOverlay，不改设计 JSON，不提交媒体任务，也不改变已有 ToolBar 与 ZoomIndicator 的布局。

## 验证

- `node scripts/verifyCanvasBackgroundBrowser.mjs`：通过。挂载真实 ToolBar、ZoomIndicator、GridRenderer、React Flow 和显示控件，开启 Flow 入口后网页工具栏实测 419px，桌面 459px。验证 800px / 730px / 700px / 600px / 520px 网页高度下折叠/展开与图层开关的几何无交叠、中心线对齐、展开不移位、横向同排、32px 按钮/16px 图标与透明外观；保留默认折叠 Tab、眼睛点击、Escape、颜色/HEX/主题/刷新/重置、画布事件隔离、聊天最大化关闭验证。
- 450px 宽网页画布且图层展开：横排位于 `(331,517.5)`，尺寸 `104×32`，与工具栏及缩放控件无交叠。420px 宽时横排向左展开到 `(259,517.5)`，箭头仍保持 `x=331px`。
- 700px 高桌面视口的 450px 宽嵌入画布且图层展开：横排本地坐标 `(331,547.5)`，尺寸 `68×32`。360px 宽桌面容器验证向左展开及色盘完整位于画布边界内。
- 极低嵌入画布仍受现有工具栏尺寸限制：520px 高画布中 459px 工具栏上方仅有 30.5px，缩放控件占据下方，没有完整 32px 空位。此时入口尽量贴上边界并保持尺寸与中心线，无法同时保证与工具栏完全无交叠；不改变原工具栏/缩放控件布局。
- 背景色 4 个纯函数测试、新控件与色盘的定向 ESLint 通过。
- 浏览器截图：`/tmp/tanva-canvas-view-controls-800.png`、`/tmp/tanva-canvas-view-controls-730.png`、`/tmp/tanva-canvas-view-controls-700.png`、`/tmp/tanva-canvas-view-controls-600.png`、`/tmp/tanva-canvas-view-controls-embedded-layers.png`、`/tmp/tanva-canvas-view-controls-embedded-dark.png`。

## 2026-10-13 发布到 101

- 运行时代码：`46557338b7fc97d463954dad980291a8434eb54c`，已推送 main。使用该提交的独立归档构建，未包含工作区其他未提交功能。
- TypeScript/Vite 生产构建、已提交版本的背景/横向布局浏览器回归与自定义快捷键浏览器回归通过。原仓库全量 lint 存在既有错误；此次新控件定向 ESLint 通过。
- 2026-10-13 14:14:36 UTC 发布至 `101.96.227.228`，48 个文件哈希校验通过。14:14:47 UTC 公网 HTML、主 JS/CSS 哈希、版本 `46557338b7fc` 和 `/api/health` 均通过，旧主 JS 仍可访问。
- 发布记录：`/opt/tanva-releases/canvas-dock-20261013-46557338/`；回退备份：`/opt/tanva-backups/canvas-dock-20261013-46557338/frontend-dist/`。后端未重启，无数据库变更。
