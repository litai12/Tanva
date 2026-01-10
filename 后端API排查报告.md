# 后端API可用性排查报告

## 排查时间
2026年1月9日

## 问题总结

### ❌ 后端服务未运行

**问题原因：**
1. **缺少环境变量 `DATABASE_URL`**
   - 后端启动时抛出错误：`PrismaClientInitializationError: error: Environment variable not found: DATABASE_URL`
   - Prisma schema 配置需要 PostgreSQL 数据库连接字符串

2. **后端服务启动失败**
   - 端口 4000 未被占用，说明服务未成功启动
   - 健康检查端点 `/api/health` 无法访问

## 详细排查结果

### 1. 服务状态检查

```bash
# 检查端口占用
lsof -ti:4000
# 结果：端口4000未被占用

# 测试健康检查端点
curl http://localhost:4000/api/health
# 结果：连接失败（服务未运行）
```

### 2. 日志分析

从 `logs/backend.log` 中发现：

```
PrismaClientInitializationError: error: Environment variable not found: DATABASE_URL.
Validation Error Count: 1
```

**关键信息：**
- 后端使用 NestJS + Fastify
- 数据库：PostgreSQL（通过 Prisma ORM）
- 默认端口：4000
- API 基础路径：`/api`

### 3. 代码分析

**后端配置：**
- 主文件：`backend/src/main.ts`
- 默认端口：4000（可通过 `PORT` 环境变量覆盖）
- API 前缀：`/api`
- 健康检查端点：`GET /api/health`

**数据库配置：**
- Prisma Schema：`backend/prisma/schema.prisma`
- 数据库类型：PostgreSQL
- 连接字符串：通过 `DATABASE_URL` 环境变量配置

**API端点：**
- 文本聊天：`POST /api/ai/text-chat`（需要认证）
- 统一聊天：`POST /api/ai/chat`（需要认证）
- 流式聊天：`POST /api/ai/chat-stream`（需要认证）
- 健康检查：`GET /api/health`（无需认证）

## 解决方案

### 方案1：配置 PostgreSQL 数据库（推荐）

1. **安装 PostgreSQL**（如果未安装）：
   ```bash
   # macOS
   brew install postgresql@14
   brew services start postgresql@14
   
   # 或使用 Docker
   docker run --name tanva-postgres -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tanva -p 5432:5432 -d postgres:14
   ```

2. **创建环境变量文件**：
   ```bash
   cd backend
   # 创建 .env 文件
   cat > .env << EOF
   # 数据库配置
   DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/tanva?schema=public"
   
   # 服务器配置
   PORT=4000
   HOST=0.0.0.0
   NODE_ENV=development
   
   # JWT配置（生成随机字符串）
   JWT_ACCESS_SECRET=your_access_secret_key_here
   JWT_REFRESH_SECRET=your_refresh_secret_key_here
   JWT_ACCESS_TTL=900s
   JWT_REFRESH_TTL=30d
   
   # Cookie配置
   COOKIE_SECRET=your_cookie_secret_here
   
   # CORS配置
   CORS_ORIGIN=http://localhost:5173,http://localhost:3000
   
   # AI配置（可选，但某些功能需要）
   GOOGLE_GEMINI_API_KEY=your_gemini_api_key_here
   EOF
   ```

3. **运行数据库迁移**：
   ```bash
   cd backend
   npx prisma migrate dev
   ```

4. **启动后端服务**：
   ```bash
   npm run dev
   ```

### 方案2：使用 SQLite（快速测试）

如果需要快速测试API而不配置PostgreSQL，可以临时修改 Prisma schema：

1. **修改 `backend/prisma/schema.prisma`**：
   ```prisma
   datasource db {
     provider = "sqlite"
     url      = "file:./dev.db"
   }
   ```

2. **运行迁移**：
   ```bash
   npx prisma migrate dev
   ```

3. **启动服务**：
   ```bash
   npm run dev
   ```

## 验证步骤

### 1. 检查服务是否启动

```bash
# 检查端口
lsof -ti:4000

# 测试健康检查
curl http://localhost:4000/api/health
# 预期响应：{"status":"ok","timestamp":"2026-01-09T..."}
```

### 2. 测试数据库连接

```bash
curl http://localhost:4000/api/health/db
# 预期响应：{"status":"ok","timestamp":"2026-01-09T..."}
```

### 3. 测试API端点（需要认证）

```bash
# 测试文本聊天API（需要JWT token或API Key）
curl -X POST http://localhost:4000/api/ai/text-chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"prompt":"你好"}'
```

## 环境变量清单

后端需要以下环境变量：

### 必需变量
- `DATABASE_URL` - PostgreSQL 连接字符串
- `JWT_ACCESS_SECRET` - JWT访问令牌密钥
- `JWT_REFRESH_SECRET` - JWT刷新令牌密钥
- `COOKIE_SECRET` - Cookie加密密钥

### 可选变量
- `PORT` - 服务器端口（默认：4000）
- `HOST` - 服务器主机（默认：0.0.0.0）
- `CORS_ORIGIN` - CORS允许的来源
- `GOOGLE_GEMINI_API_KEY` - Google Gemini API密钥（AI功能需要）
- `VEO_API_KEY` - VEO视频API密钥（视频功能需要）
- `SORA2_API_KEY` - Sora2视频API密钥（视频功能需要）

## 下一步行动

1. ✅ **立即执行**：创建 `.env` 文件并配置 `DATABASE_URL`
2. ✅ **立即执行**：运行数据库迁移 `npx prisma migrate dev`
3. ✅ **立即执行**：启动后端服务 `npm run dev`
4. ⏳ **后续**：配置 AI API 密钥以启用完整功能
5. ⏳ **后续**：配置 OSS 存储（如果需要文件上传功能）

## 相关文档

- 后端 README：`backend/README.md`
- 部署指南：`frontend/docs/部署指南/`
- API文档：启动后访问 `http://localhost:4000/api/docs`

## 总结

**当前状态：** ❌ 后端API不可用

**主要原因：** 缺少 `DATABASE_URL` 环境变量导致服务无法启动

**解决优先级：** 🔴 高优先级 - 需要立即配置数据库连接

**预计解决时间：** 5-10分钟（如果已有PostgreSQL）或 15-30分钟（需要安装PostgreSQL）
