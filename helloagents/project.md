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
- AI Chat 普通文本请求默认只发送当前输入；命中“继续/调整/再试”等迭代意图，或“刚才/之前/上文/上一条/这个/那个/这两个/previous/last”等上下文指代时，才通过 `contextManager.buildContextPrompt` 拼接会话历史。迭代计数与上下文依赖检测是两条独立判定；Auto-mode Agent trace 在上下文依赖命中时也会接收同一份上下文并展示上下文读取步骤。Flow Text Chat 节点不继承这条 AI Chat 上下文注入策略。
- AI Chat Auto/Generate 图片输出数量：底部 `1/2/4/8` 倍数是默认值；当用户输入明确包含“画/生成/做/出 + 两张/3张/多张”等输出数量时，本次请求会用语言解析出的数量覆盖默认倍数，并同步给 Agent trace 展示。不要把“用两张参考图/把两张图融合”误判为输出数量。
- AI Chat 图片生成等待上限为前端任务轮询 15 分钟；消息错误态必须派发 `predictImagePlaceholder/remove`，画布侧 AI 预测占位框也必须带 `createdAt/expiresAt` 并由 `useQuickImageUpload` 定时扫描清理，避免 Paper.js 孤儿占位框长期停在 95%。
- Flow HTML PPT 节点只持久化多页 HTML/CSS 片段与远程 URL/路径引用；预览必须运行在禁用脚本的 sandbox iframe 中，手写/AI 生成代码需拦截脚本、事件属性、`javascript:`、iframe/object/embed/base，以及 `data:`/`blob:`/base64 图片引用。AI 可按当前页或整套 deck 返回结构化 JSON patch/full replacement，并可读取上游 `text`/`img` 作为图文上下文；非远程图片应在运行时先上传为远程素材再交给模型排版。节点当前不自动规划或调用生图链路；需要主视觉/背景/插画等图片时，应通过上游图片节点、素材库或上传素材提供，Run 只负责准备远程图片并交给 PPT 排版模型使用。HTML PPT 风格 preset 以结构化数据维护，应用后写入 deck `themeCss` 与节点 `stylePresetKey`，并参与后续 AI prompt；`Bold 34` 模板一一映射 `zarazhangrui/beautiful-html-templates`，本地保存从上游 `template.html` 转换出的 Tanva-safe 静态 starter deck，并统一带 `author:zarazhangrui` 标签，应用后替换为 1920×1080 真实模板页并写入 `boldTemplateSlug`。AI/模板返回的完整 HTML 文档必须先抽取安全 slide body/style block 转成内部 deck/slide 片段，不能直接作为完整 HTML 持久化。导出的 HTML deck 需要以分页文档方式呈现，并使用固定设计画布整页缩放来保持预览/导出比例一致，保存前必须通过同一安全校验。
- Flow 生图节点参考图数量统一走 `frontend/src/utils/flowModelProvider.ts`：Fast=3、Pro=11、Ultra=14；节点预览、连接接纳与运行请求必须使用同一上限。
- Flow Prompt 节点的 `@` 图片引用保存为结构化 `data.mentions`：新建引用可从工作流、项目库与个人库选择；工作流引用只保存 `flow` 节点/句柄引用，项目库/个人库只保存远程 URL/路径。运行时可合并到生图参考图，但不得把 inline 图片写入设计 JSON。Prompt 的“工作流”来源仅在当前 Prompt 下游节点存在已连接的图片输入时显示，并展示这些下游图片输入对应的当前工作流图片；多 `@` 匹配必须按最长 token 优先，自动候选同步不得覆盖已保存的结构化 ref，也不得在同名 token 对应多个候选时盲绑；工作流多输出必须按 `nodeId + handle` 精确匹配，避免同节点不同图串联；已选引用在 Prompt 输入区以图片 chip 区分展示，删除时应按整个 token 同步清理 mention。
- Flow 视频节点运行时可从连接的 Prompt 节点读取仍存在于文本中的 image mentions 作为虚拟图片输入：物理图片连线优先，`@` 图片只补空位或追加到参考图列表，并在请求 prompt 中追加 token 到参考图序号的映射说明。
- Flow `omniFlashExtVideo` follows APIMart `omni-flash-ext`: `prompt` is required; image inputs are collected only from the `image` handle; single-image mode accepts 1 image, reference mode accepts 1-3 images, and 2+ images must send `generation_type=reference`; video input is collected from the `video` handle and is limited to 1 URL; when a reference video is present, force `videoMode/generation_type=reference` and omit `duration`; valid duration choices without video are 4/6/8/10 seconds. Backend managed routing includes a default `omni-flash-ext` -> `new_api` route so credit preview/deduction does not fall through to Kling 2.6 defaults.
- new-api stores the internal route key as `omni-flash-ext`, but APIMart upstream is case-sensitive and must receive `model=Omni-Flash-Ext`; production PostgreSQL data repair lives in `new-api/patches/2026-06-17/001-fix-omni-flash-ext-apimart-data.sql`, with a non-runner SQLite companion at `new-api/patches/2026-06-17/001-fix-omni-flash-ext-apimart-data.sqlite` for local `one-api.db`.
- Seedance 2.0 `reference_images`/全能参考模式必须把图片作为 `reference_image` 参考媒体处理，不得与 `first_frame`/`last_frame` 角色混用；若 new-api 兼容层返回首尾帧与参考媒体混用错误，后端会退回 Ark 官方 `content`/role 直连任务。
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
