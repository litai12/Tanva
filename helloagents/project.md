# Tanva — 技术约定（SSOT）

## 目标
- 让新同学能在 30 分钟内跑起来前后端，并理解核心模块边界。
- 对代码现实进行记录：当知识库与代码冲突时，以代码为准并同步回知识库。

## 技术栈
- 前端：React 19 + TypeScript + Vite + Tailwind（含 Radix UI 组件）
- 后端：NestJS（Fastify adapter）+ Prisma + PostgreSQL
- AI/多媒体：`@google/genai` / `@google/generative-ai`、图片处理（background removal）、视频/帧等相关能力

## 仓库结构
- `frontend/`：前端应用（Vite）
- `backend/`：后端服务（NestJS）
- `frontend/docs/`：项目文档（大量中文文档）
- `ai-metadata/`：代码索引（imports/exports/依赖图/特征描述）
- `helloagents/`：本知识库（SSOT）

## 开发约定
### Node / 包管理
- Node.js：建议 `>= 18`
- 包管理：项目内主要使用 `npm`（`frontend/`、`backend/` 各自有 `package.json`）

### 常用命令
- 前端开发：`cd frontend && npm i && npm run dev`
- 前端检查：`cd frontend && npm run lint && npm run build`
- 后端开发：`cd backend && npm i && npm run dev`
- 后端构建：`cd backend && npm run build`

### 资源访问
- 直连 OSS/CDN：默认禁用 `/api/assets/proxy`，使用 `VITE_ASSET_PUBLIC_BASE_URL` 将 `projects/...` 等 key 拼成可访问 URL
- 如需重新启用代理：设置 `VITE_PROXY_ASSETS=true`

### API 前缀与文档
- 后端全局前缀：`/api`
- Swagger：`/api/docs`

### 设计 JSON（强约束）
- `Project.contentJson` / `PublicTemplate.templateData` 只允许保存远程 URL/路径引用；禁止 `data:`/`blob:`/base64 图片等内联内容进入 DB/OSS。
- UI 渲染（画板/图层/缩略图等）：避免直接用 `data:image/*`/裸 base64 做渲染；优先转为 `blob:`（objectURL）或走 `canvas`（参考 `frontend/src/components/ui/SmartImage.tsx`、`frontend/src/hooks/useNonBase64ImageSrc.ts`）。

### Flow / AI 运行约定
- AI Chat 项目内会话只从 `Project.content.aiChatSessions` / `aiChatActiveSessionId` 水合；全局 IndexedDB/localStorage 会话只用于无项目场景，避免切换/新建项目时把旧本地历史串入当前项目。
- 项目内容本地缓存使用 `frontend/src/services/projectCacheStore.ts` 的 IndexedDB（`tanva_project_cache`）：打开项目可先用账号隔离缓存水合，再后台校验远端 `contentVersion/updatedAt`；校验中自动/手动保存需暂停，保存成功写入与云端一致的 sanitized 内容，避免本地运行时字段或旧缓存覆盖远端。切换项目的体感性能还受 Paper `importJSON`、Raster 重建和 Flow hydrate 影响；下拉快速切换应先关闭菜单并延后一拍触发 `projectStore.open()`，Paper 项目切换路径在已提前清空时可跳过导入前的重复 `project.clear()`。
- AI Chat 普通文本请求默认只发送当前输入；只有“继续/调整/再试”等迭代意图才拼接会话历史上下文。Flow Text Chat 节点是独立路径，不继承这个上下文注入策略。
- Flow HTML PPT 节点只持久化多页 HTML/CSS 片段与远程 URL/路径引用；预览必须运行在禁用脚本的 sandbox iframe 中，手写/AI 生成代码需拦截脚本、事件属性、`javascript:`、iframe/object/embed/base，以及 `data:`/`blob:`/base64 图片引用。AI 可按当前页或整套 deck 返回结构化 JSON patch/full replacement，并可读取上游 `text`/`img` 作为图文上下文；非远程图片应在运行时先上传为远程素材再交给模型排版，导出的 HTML deck 需要以分页文档方式呈现，并使用固定设计画布整页缩放来保持预览/导出比例一致，保存前必须通过同一安全校验。
- Flow 生图节点参考图数量统一走 `frontend/src/utils/flowModelProvider.ts`：Fast=3、Pro=11、Ultra=14；节点预览、连接接纳与运行请求必须使用同一上限。
- Flow Prompt 节点的 `@` 图片引用保存为结构化 `data.mentions`：当前工作流引用保存节点/句柄，项目库与个人库引用只保存远程 URL/路径；运行时可合并到生图参考图，但不得把 inline 图片写入设计 JSON。已选引用在 Prompt 输入区以图片 chip 区分展示，删除时应按整个 token 同步清理 mention。
- Flow 视频节点成功后可写入 Global History，但只记录已有远程视频 URL/缩略图引用，不把视频或缩略图内联进设计 JSON。
- Library 历史视频记录支持封面/播放/下载展示；发送或拖拽到画板时必须走 `canvas:insert-video` 视频资产链路，不走图片上传链路。历史图片仍可按远程 URL/可持久化资产引用发送到画板。
- Canvas/Flow 视口同步以性能为优先：触控板/手势缩放通过 RAF 批量提交 `setViewport`；Flow 覆盖层内的滚轮缩放/平移同样要合并到 RAF；项目内容中的 canvas `zoom/pan` 同步需要防抖和同值跳过，避免缩放/平移产生高频 React 内容状态更新。超过 80 节点时 MiniMap 仅在移动/缩放/节点拖拽等交互过程中临时隐藏，交互空闲后恢复；移动/缩放/节点拖拽进入软降级但保留节点内容、按钮、连线和 resize，仅隐藏连接句柄圆点；节点拖拽期间派生数据应跳过 position-only 重算。`GridRenderer` 的初始化兜底不能依赖随 `zoom` 重建的回调，避免绕过缩放重绘防抖。
- 后端 AI 积分请求参数应保留显式 `channelHint`，除非 Banana route/provider 已解析出更明确的供应商通道。
- 画布 AI 图片操作应以当前渲染资源为准；Shift 精确局部修改需要把选区 bounds/比例传入 Chat，并通过 `precise-edit`/`lockToBounds` 在原位显示占位框，高清放大结果应走 `triggerQuickImageUpload` 上画布而不是直接下载。

### 环境变量与敏感信息
- 后端使用 `.env`（见 `backend/src/app.module.ts` 的 `envFilePath` 配置：优先 `backend/.env`，其次 `../.env`）
- 不要提交密钥/凭据（`.gitignore` 已包含 `backend/.env` 等）

## AI Metadata 同步
- 修改代码或文档后，在仓库根目录运行：
  - `node "${CODEX_HOME:-$HOME/.codex}/Skills/ai-metadata-sync/scripts/sync-repo.mjs"`
