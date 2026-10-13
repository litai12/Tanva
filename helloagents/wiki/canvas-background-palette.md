# 画布背景色盘

## 行为

- 左下角缩放/眼睛控件上方提供背景色盘；图层侧栏展开时跟随位移，桌面插件中约束在画布容器内。
- 交互参考 TapCanvasPro：各主题 7 个预置色、实时饱和度/明度色盘与色相滑条、HEX 输入（失焦/Enter 提交，非法值退回当前颜色）、恢复当前主题默认。
- `tanva-canvas-background` 本地偏好仅保存 `byScheme.light/dark`，明暗主题分别恢复选择，不写入项目设计 JSON，不参与云端保存/协作。
- 未设置和重置使用 `null`，保留 Tanva 原白色/黑色底色及旧网格设置，不把上游默认渐变覆盖进 Tanva。
- 弹层使用 `role=dialog`，继承全局快捷键的弹层保护；Escape、点击外部和窗口失焦关闭。
- 色盘控件的 `data-canvas-control` 标记由全局事件入口识别，阻止其鼠标/滚轮事件流入画布；弹层打开期间 `isShortcutSuppressed` 抑制捕获阶段快捷键，聚焦色盘或页面其他位置都不会改变画布。关闭后恢复。待连接状态的 Escape 同样遵守该保护。

## 实现

`CanvasBackgroundPicker.tsx` 与 `canvasBackgroundStore.ts` 独立承载交互和偏好；`useCanvasBackgroundStyle` 在画布根容器输出背景/网格 CSS 变量。CSS 在显式选择时覆盖深色主题 `!important` 底色规则，React Flow 保持透明以透出 Paper 内容，只改变网格的点/线颜色，不改变节点和工具条主题。

Paper `GridRenderer` 使用所选底色覆盖旧的纯色矩形底色，并按实际背景亮度选择黑/白网格。自定义底色时保留弱网格透明度；颜色变化触发一次重绘，不依赖下一次平移。网格显隐与样式沿用原设置。

## 验证

- `node --test src/utils/canvasBackground.test.ts`
- `node scripts/verifyCanvasBackgroundBrowser.mjs`：独立临时 Vite cache，验证色盘/HEX/重置/主题隔离/刷新持久化/关闭与快捷键保护、Paper 真正绘制像素与 Flow 网格颜色。
- 2026-10-13：4 个纯函数单测、独立浏览器回归通过；新运行时模块定向 ESLint 通过。浏览器包括网格关闭后改色再重开、三种 Flow 图案、事件总线隔离、打开期间 Tab/G/Delete 不作用画布及关闭后恢复。

## 2026-10-13 发布

已随 `a18b67b5` 推送并部署 101。隔离源码单测、浏览器回归和生产构建通过，公网版本、主资源哈希和健康检查通过；发布范围与回退路径见 [发布记录](canvas-controls-release-20261013.md)。
