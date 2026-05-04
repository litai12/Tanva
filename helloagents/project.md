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
- Flow 生图节点参考图数量统一走 `frontend/src/utils/flowModelProvider.ts`：Fast=3、Pro=11、Ultra=14；节点预览、连接接纳与运行请求必须使用同一上限。
- Flow 视频节点成功后可写入 Global History，但只记录已有远程视频 URL/缩略图引用，不把视频或缩略图内联进设计 JSON。
- 后端 AI 积分请求参数应保留显式 `channelHint`，除非 Banana route/provider 已解析出更明确的供应商通道。
- 画布 AI 图片操作应以当前渲染资源为准；Shift 精确局部修改需要把选区 bounds/比例传入 Chat，并通过 `precise-edit`/`lockToBounds` 在原位显示占位框，高清放大结果应走 `triggerQuickImageUpload` 上画布而不是直接下载。

### 环境变量与敏感信息
- 后端使用 `.env`（见 `backend/src/app.module.ts` 的 `envFilePath` 配置：优先 `backend/.env`，其次 `../.env`）
- 不要提交密钥/凭据（`.gitignore` 已包含 `backend/.env` 等）

## AI Metadata 同步
- 修改代码或文档后，在仓库根目录运行：
  - `node "${CODEX_HOME:-$HOME/.codex}/Skills/ai-metadata-sync/scripts/sync-repo.mjs"`
