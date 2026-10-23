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

## 101 发布

仅发布前端，使用隔离源码构建、完整文件 SHA-256 核验和旧版备份，保留旧 hash 资源，最后切换入口。不重启后端，不更改数据库。发布完成后在此补充提交、回执目录和公网验收结果。
