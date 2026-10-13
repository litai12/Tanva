# 图片放大预览复用（2026-10-12）

## 问题与范围

画布图片和图片节点双击后共用 `frontend/src/components/ui/ImagePreviewModal.tsx`。原组件只用 `object-fit: contain` 展示静态图片，无法继续缩放或拖动。

按用户要求复用 TapCanvas-pro `apps/web/src/ui/PreviewModal.tsx` / `PreviewModal.css` 的完整图片预览布局与交互，并适配 Tanva 明暗主题。保留 Tanva 的图片集合、时间排序、切图及加载更多回调；仅修改预览，不改变图片资产、生成执行或设计 JSON。

## 实现约定

- 使用参考项目相同版本的 `react-zoom-pan-pinch@4.0.3`，精确锁定依赖：适配视窗为初始视图，缩放范围 0.25–10，滚轮步长 0.006，按钮步长 0.18，双击复位，拖动关闭惯性。
- 复用模糊遮罩、胶囊工具栏、信息面板、缩放百分比和对数滑杆、左右旋转、下载、关闭按钮及底部历史缩略图。百分比相对图片原像素计算，初始视图不保证显示 100%。
- 使用 Tanva 现有 `SmartImage` 与下载工具，图片内联输入仅在运行时转为 Blob；预览不写回项目，下载使用当前预览资源。
- 通过现有 `.dark` 主题及 CSS 变量适配明暗外观；切图与重新打开恢复初始视图。
- `GlobalEventCapture` 在 window capture 阶段识别 `data-image-preview-modal`，不把预览滚轮、鼠标、手势和键盘事件发送给画布事件总线，保留预览自身的 DOM 交互。
- 缩放库依赖 window 原生 mouse 事件，预览不能在其之前截断 mouse 冒泡；图片需要显式 `pointer-events: auto` 覆盖库默认样式，保证图片单击不关闭、双击能复位。预览自身使用非 passive wheel 监听阻止浏览器缩放/滚动，历史栏将滚轮转为横向滚动。

## 验证与发布

- `cd frontend && node scripts/verifyImagePreviewBrowser.mjs`：真实生产组件和 `GlobalEventCapture`，同源 SVG fixture，通过滚轮/Ctrl+滚轮、真实拖拽位移、双击复位、按钮和滑杆上下界、`+/-/0`、旋转/信息/下载内容、切图/历史分页、关闭重开、Escape、画布事件及 Portal 宿主事件隔离。
- 浏览器截图检查覆盖浅色、深色、缩放后及 390×844 无历史集合；窄屏将工具栏分成两排并隐藏冗余 Esc 键帽，避免重叠。
- 修改的两个 TypeScript 文件 scoped ESLint 通过；`npm run build`（TypeScript + Vite）通过。全量 `npm run lint` 基线失败（迁移前已有 2563 errors / 199 warnings，含旧预览 4 个 unused 错误），未扩展修复无关文件。
- 项目约定的 AI metadata 同步脚本执行失败：本机缺少 `/Users/libiqiang/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs`；已同步本知识库与 CHANGELOG。
- 本次为本地代码修复，未部署。
