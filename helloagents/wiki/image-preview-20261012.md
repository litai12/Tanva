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
- 代码 `7fcf34642cfeb068ebbe29899c7fcd81d15c7e5f` 已推送 `main` 并于 2026-10-12 18:52（America/Los_Angeles）部署 101，仅发布前端静态资源，未重启后端、未执行数据库变更。

## 生产发布记录

- 发布目录：`/opt/tanva-releases/image-preview-20261012-7fcf3464/`，保留构建压缩包、48 文件 SHA-256 清单、发布脚本、`deployment.json` 和 `public-acceptance.json`。
- 回退备份：`/opt/tanva-backups/image-preview-20261012-7fcf3464/frontend-dist/`。发布保留旧 hash 资源，逐文件原子替换，最后切换 `index.html` 与版本清单；本地、暂存和线上 48 个文件哈希一致。
- 公网 `https://tanvas.cn/` 的 HTML、`/assets/index-8t-sE4l2.js`、`/assets/index-CGW4hb0-.css` 与发布构建 SHA-256 一致；`/version.json` 返回 `commitSha=7fcf34642cfe`，`/api/health` 返回 `status=ok`。
- 浏览器交互验收为发布前的真实组件回归；发布后完成公网静态资源与健康验证，未创建或重跑生产生成任务。

## 底部候选数据接入补修

用户线上反馈底部候选栏为空。首次迁移只复用了候选栏 UI，仍由各入口传入旧 `imageCollection`：Nano/GPT 等依赖本机 `imageHistoryStore`，重新打开项目且历史为空时缺少候选；Analyze 与部分参考图预览显式传空数组。此前直接给公共组件填入图片集合的回归未覆盖真实节点入口。

补修按 TapCanvas-pro `previewGallery.ts` 从当前 React Flow 画布读取同层级/同组的真实图片节点，按画布阅读顺序提供候选；预览内切换不回写节点结果或执行生成。明确的四图/多图结果集合继续使用调用方的集合，画布外预览保留原合同。新增回归必须从真实节点双击入口出发，覆盖空本地历史、重新加载项目和组隔离。

- 补修验证：`node --test src/components/flow/flowPreviewGallery.test.ts` 的 7 项测试、公共源码 scoped ESLint、TypeScript 检查及构建通过。
- `node scripts/verifyImagePreviewGalleryBrowser.mjs` 从真实 GPT/Nano 双击和 Analyze 输入预览入口覆盖：空本地历史、同层/同组候选、不同组隔离、非图片排除、点击/左右键/回绕、关闭重开、刷新恢复、Generate4 显式四图集合；切换不修改节点、不发起生成。裁剪候选实际呈现 100×120 Blob，下载 PNG 尺寸同为 100×120。
- 原通用预览回归 `node scripts/verifyImagePreviewBrowser.mjs` 再次通过；已人工查看真实节点候选截图。补修待发布。
