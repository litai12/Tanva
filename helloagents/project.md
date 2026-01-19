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

### API 前缀与文档
- 后端全局前缀：`/api`
- Swagger：`/api/docs`

### 设计 JSON（强约束）
- `Project.contentJson` / `PublicTemplate.templateData` 只允许保存远程 URL/路径引用；禁止 `data:`/`blob:`/base64 图片等内联内容进入 DB/OSS。
- UI 渲染（画板/图层/缩略图等）：避免直接用 `data:image/*`/裸 base64 做渲染；优先转为 `blob:`（objectURL）或走 `canvas`（参考 `frontend/src/components/ui/SmartImage.tsx`、`frontend/src/hooks/useNonBase64ImageSrc.ts`）。

### 环境变量与敏感信息
- 后端使用 `.env`（见 `backend/src/app.module.ts` 的 `envFilePath` 配置：优先 `backend/.env`，其次 `../.env`）
- 不要提交密钥/凭据（`.gitignore` 已包含 `backend/.env` 等）

## AI Metadata 同步
- 修改代码或文档后，在仓库根目录运行：
  - `node "${CODEX_HOME:-$HOME/.codex}/Skills/ai-metadata-sync/scripts/sync-repo.mjs"`
