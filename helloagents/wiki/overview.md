# 项目概述

## Tanva 是什么
Tanva 是一个基于 Paper.js 的专业绘图应用，前端提供画布/流程（Flow）等交互能力，后端提供认证、项目、素材、AI 能力以及积分/管理后台等服务。

## 运行方式（本地开发）
- 前端：`cd frontend && npm i && npm run dev`（默认 `http://localhost:5173`）
- 后端：`cd backend && npm i && npm run dev`（默认 `http://localhost:4000`，API 前缀 `/api`）

## 模块索引
### 前端（`frontend/src`）
- `wiki/modules/frontend-app.md`：应用入口与路由
- `wiki/modules/frontend-canvas.md`：画布与 Paper.js 相关
- `wiki/modules/frontend-flow.md`：Flow/节点编排（ReactFlow）
- `wiki/modules/frontend-services.md`：HTTP/AI 等服务层
- `wiki/modules/frontend-stores.md`：状态管理（Zustand）

### 后端（`backend/src`）
- `wiki/modules/backend-app.md`：启动与全局中间件（Fastify/Nest）
- `wiki/modules/backend-auth.md`：认证与会话
- `wiki/modules/backend-users.md`：用户与账户
- `wiki/modules/backend-projects.md`：项目存储与读写
- `wiki/modules/backend-oss.md`：文件/素材/上传与视频帧
- `wiki/modules/backend-ai.md`：AI 能力（生成/分析/工具选择等）
- `wiki/modules/backend-ai-public.md`：公开 AI API（`/api/public/ai`）
- `wiki/modules/backend-credits.md`：积分与计费
- `wiki/modules/backend-admin.md`：管理后台
- `wiki/modules/backend-invites.md`：邀请码
- `wiki/modules/backend-personal-library.md`：个人素材库
- `wiki/modules/backend-global-image-history.md`：全局图片历史
- `wiki/modules/backend-templates.md`：公共模板
- `wiki/modules/backend-prisma.md`：数据访问层（Prisma）

