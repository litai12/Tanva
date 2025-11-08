# Tanva - 专业绘图与AI创作平台

基于 React + TypeScript 的现代化专业绘图与 AI 创作平台，内置项目/认证、自动保存、OSS 直传与多模态 AI 生成能力。

## 快速开始

### 安装依赖
```bash
npm install
```

### 启动前后端（开发）
```bash
# 后端（NestJS + Prisma）
cd server && npm install && npm run dev

# 前端（React + Vite）
cd .. && npm run dev
```

### 构建生产版本
```bash
npm run build
```

## 主要功能

- 🎨 专业绘图（Paper.js 画布、图层与工具栏）
- 🤖 多模态 AI（文本生成图像、编辑、融合、分析）
- 🧠 提示词优化（独立 Demo：`/app?prompt-demo`）
- 💾 自动保存与版本（手动保存与状态指示）
- ☁️ 阿里云 OSS 直传与 JSON 读写（演示页：`/oss`）
- 🔐 登录注册与受保护路由（Cookie+JWT）
- 📦 项目系统（创建、打开、内容读写、回退机制）

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui
- **绘图**: Paper.js + Canvas API
- **状态管理**: Zustand
- **AI集成**: Google Gemini API（gemini-2.5-flash-image-preview / gemini-2.0-flash）
- **后端**: NestJS 10 + Fastify + Prisma (PostgreSQL) + Swagger
- **认证**: Cookie + JWT（访问令牌与刷新令牌）
- **存储**: 阿里云 OSS（直传签名、JSON 读写、公网地址）

## 文档

详细文档请查看 `docs/` 目录：

- [项目概述](./docs/01-项目概述.md)
- [使用说明（当前系统）](./docs/02-使用说明.md)
- [节点模式指南](./docs/03-节点模式指南.md)
- [AI 系统文档](./docs/04-AI系统文档.md)
- [Gemini API 文档](./docs/14-Gemini-API文档.md)
- [服务器端说明](./docs/Server-后端功能说明.md)
- [自动保存与版本管理](./docs/18-自动保存与版本管理.md)
- [认证与项目系统](./docs/17-认证与项目系统.md)
- [OSS 上传与资源管理](./docs/19-OSS上传与资源管理.md)
- [提示词优化功能说明](./docs/20-提示词优化功能说明.md)
- [图像历史与缓存系统](./docs/21-图像历史与缓存系统.md)

## 许可证

开源许可证（具体待定）

---

*更多信息请参阅详细文档*
