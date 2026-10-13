# 画布交互与头像修复发布（2026-10-13）

## 范围与代码

- `d82e0436`：眼睛按钮可配置快捷键（默认 Tab）、账号头像鉴权代理读取及失败兜底、头像保存前解码校验。
- `a18b67b5dee44798120182e8e854892730fdf839`：参考 TapCanvasPro 的背景色盘，支持预置色、实时选色、HEX、明暗主题独立本机偏好及重置；补齐 Paper/Flow 背景和网格、色盘事件隔离。
- 两个代码提交已推送 `origin/main`。仅发布前端，无数据库迁移、后端重启或生产生成任务。
- 发布源码由 `git archive a18b67b5 frontend` 创建，复用本机依赖，使用已提交生产环境配置和 `GITHUB_SHA` 构建。未纳入工作区图片对比节点等未提交改动；FlowOverlay 仅新增待连线 Escape 的快捷键保护一行。

## 验证

- 干净发布副本：20 项单测，以及快捷键、头像、背景色盘三组真实组件浏览器回归全部通过。
- 头像回归拦截测试 API，覆盖直连/历史 key、403 后鉴权代理、原远程 URL 持久化、损坏响应拒绝替换、旧图保留及首字兜底；未使用真实账号改动用户头像。
- 背景回归使用真实 Paper 和 React Flow，覆盖绘制像素、关闭网格后改色并重开、点/线/十字网格、主题与刷新记忆、重置、HEX/色相/色盘和键盘/滚轮隔离。
- `npm run build` 通过，新增核心模块定向 ESLint 与 `git diff --check` 通过。全量 lint 仍有已知仓库基线 `2556 errors / 199 warnings`；指定元数据同步脚本缺失，未宣称这两项通过。

## 101 发布与公网验收

- 2026-10-13 06:49（America/Los_Angeles）部署。服务目录 `/www/wwwroot/tanvas.cn/frontend/dist`。
- 发布目录 `/opt/tanva-releases/canvas-controls-20261013-a18b67b5/`，回退备份 `/opt/tanva-backups/canvas-controls-20261013-a18b67b5/frontend-dist/`。
- 部署锁内核对源码提交、干净状态、旧版本与入口哈希；验证压缩包内 48 文件 SHA-256 后备份并逐文件原子替换，最后切换 `index.html` 和 `version.json`，保留旧 hash 资源。
- 本地构建、服务器暂存、线上目录 48 文件哈希一致。公网 HTML、`/assets/index-C-mCmbde.js`、`/assets/index-fLRJQtuo.css` 与构建哈希一致。
- 公网 `version.json.commitSha=a18b67b5dee4`、`/api/health.status=ok`，上一版 `/assets/index-BMMCP-O3.js` 仍可访问。发布目录保留 `deployment.json` 和 `public-acceptance.json` 回执。
- 公网验收是实际静态资源与健康检查；功能交互验收来自同一提交的隔离源码浏览器回归，不冒充真实生产账号交互。
