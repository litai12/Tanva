# 全局历史打开崩溃与预览缩放修复（2026-10-22）

## 根因与修改

- 101 PM2 前端错误上报在 UTC 2026-10-23 01:51–01:52 记录四次相同 `NotFoundError: removeChild`。线上 `index-DCLUqjv9.js:40642:17581 / 18671` 对应 `button → ImageGrid → GlobalImageHistoryPage`。
- 加载更多按钮原来在裸文本与 `Loader2 + 裸文本` 之间切换；浏览器翻译替换文本节点后，React 移除旧节点时崩溃。全局历史挂载在 `document.body` 的 Portal 未继承画布翻译隔离。
- 历史/详情弹层增加 `translate="no"` 和 `notranslate`，加载文案使用稳定的 `span`；保留列表、原图片远程引用和用户操作。
- 对照 TapCanvasPro `apps/web/src/ui/PreviewModal.tsx` 和相同版本 `react-zoom-pan-pinch@4.0.3`，两项目原来均为 `wheel.step=0.006`。smooth 模式按 `step × abs(deltaY)` 计算增量，100px 滚轮会增加 0.6 倍。Tanva 将其细化为 `0.001`，实测 1.000→1.100，反向回到 1.000。按钮/键盘 `0.18`、缩放范围、旋转与拖拽行为保留。

## 验证

- 真实图片预览组件浏览器回归通过，包括 100px 滚轮速度、非中心鼠标锚点误差 <1px、拖拽、复位、旋转、图库切换和事件隔离。
- 真实 Flow 节点图库入口浏览器回归通过。
- `node scripts/verifyGlobalHistoryBrowser.mjs` 挂载真实历史页、store、API client，以本地 GET fixture 验证图片解码/详情、Escape、加载前后强制文本替换、分页和关闭重开。原实现准确复现线上 `removeChild`，修复后通过；没有操作生产历史记录。
- 修改组件定向 ESLint 为 0 errors / 4 条原有 Hook warnings，脚本语法和 `git diff --check` 通过。全量 ESLint 仍有仓库基线 2556 errors / 198 warnings。本机约定的 AI metadata 同步脚本缺失（`MODULE_NOT_FOUND`），知识库人工同步。
- 工作区 `npm run build` 通过；发布使用 `git archive dcc041ad frontend` 创建隔离源码，并以 `GITHUB_SHA` 生成带提交号的正式构建，TypeScript/Vite 通过。

## 101 发布

- 代码 `dcc041add5ed29a7654c07d5ba7d7b454dc4d609` 已提交推送，101 源码同步至该版本。2026-10-22 19:12（America/Los_Angeles；UTC 2026-10-23 02:12）发布完成。
- 仅更新前端静态资源。发布目录 `/opt/tanva-releases/history-preview-20261022-dcc041ad/`，回退备份 `/opt/tanva-backups/history-preview-20261022-dcc041ad/frontend-dist/`。部署锁内核对源码和旧入口、校验构建包，逐文件原子替换，最后切换 `index.html` 和 `version.json`，保留旧 hash 资源。
- 本地构建、101 暂存与线上目录 48 个文件 SHA-256 全部一致。公网 `https://tanvas.cn/`、`/assets/index-Bfg0uJCg.js`、`/assets/index-B9xCGxLI.css`、`/version.json` 与构建哈希一致；版本 `commitSha=dcc041add5ed`，内外网 `/api/health.status=ok`，旧 `/assets/index-DCLUqjv9.js` 仍可访问。
- 发布目录保存构建包、清单、`deployment.json` 和 `public-acceptance.json`。功能回归来自真实源码组件与本地 fixture；线上验收为实际静态资源/版本/健康核验。不重启后端，不更改数据库或历史数据，不重跑生成任务。
