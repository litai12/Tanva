# Tanva 本地 Docker 测试指南

在部署到 Sealos 之前，强烈建议在本地使用 Docker 测试你的应用。

## 前置条件

- Docker 已安装（https://www.docker.com/products/docker-desktop）
- 项目代码已获取
- Node.js 已安装（可选，用于非 Docker 开发）

---

## 方法一：使用 Docker Compose（推荐）

### 步骤 1：创建 docker-compose.yml

在项目根目录创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  # PostgreSQL 数据库
  postgres:
    image: postgres:15-alpine
    container_name: tanva-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: tanva123456
      POSTGRES_DB: tanva
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - tanva-network

  # 后端 API
  backend:
    build:
      context: ./server
      dockerfile: Dockerfile
    container_name: tanva-backend
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PORT: 4000
      HOST: 0.0.0.0
      DATABASE_URL: postgresql://postgres:tanva123456@postgres:5432/tanva?schema=public
      JWT_ACCESS_SECRET: dev-jwt-access-secret-do-not-use-in-production-key-long-enough
      JWT_REFRESH_SECRET: dev-jwt-refresh-secret-do-not-use-in-production-key-long-enough
      JWT_ACCESS_TTL: 900s
      JWT_REFRESH_TTL: 30d
      COOKIE_SECRET: dev-cookie-secret-do-not-use-in-production-key-long-enough
      COOKIE_SECURE: "false"
      COOKIE_SAMESITE: lax
      COOKIE_DOMAIN: localhost
      CORS_ORIGIN: http://localhost:5173
      OSS_REGION: oss-cn-hangzhou
      OSS_BUCKET: your-bucket
      OSS_ACCESS_KEY_ID: test-key-id
      OSS_ACCESS_KEY_SECRET: test-key-secret
    ports:
      - "4000:4000"
    networks:
      - tanva-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/api/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s

  # 前端应用
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
      args:
        VITE_ENV: development
        VITE_GOOGLE_GEMINI_API_KEY: ${VITE_GOOGLE_GEMINI_API_KEY:-dev-key}
        VITE_VIDEO_DEFAULT_DURATION: "8"
        VITE_VIDEO_DEFAULT_RESOLUTION: "720p"
    container_name: tanva-frontend
    depends_on:
      - backend
    ports:
      - "80:80"
    networks:
      - tanva-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 30s
      timeout: 3s
      retries: 3

volumes:
  postgres_data:
    driver: local

networks:
  tanva-network:
    driver: bridge
```

### 步骤 2：启动所有服务

```bash
# 在项目根目录运行
docker-compose up -d

# 查看日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs backend
docker-compose logs postgres
docker-compose logs frontend
```

### 步骤 3：初始化数据库

```bash
# 运行迁移
docker-compose exec backend npx prisma migrate deploy

# 或生成 Prisma client
docker-compose exec backend npx prisma generate
```

### 步骤 4：验证部署

```bash
# 测试后端健康状态
curl http://localhost:4000/api/health

# 测试前端（在浏览器中打开）
# http://localhost

# 测试注册 API
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","password":"Test@123"}'
```

### 步骤 5：停止服务

```bash
# 停止所有容器
docker-compose down

# 停止并删除所有数据（谨慎！）
docker-compose down -v
```

---

## 方法二：手动构建和运行（高级）

### 1. 启动 PostgreSQL

```bash
docker run -d \
  --name tanva-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=tanva123456 \
  -e POSTGRES_DB=tanva \
  -p 5432:5432 \
  -v tanva_postgres_data:/var/lib/postgresql/data \
  postgres:15-alpine

# 等待数据库启动
sleep 10
```

### 2. 构建后端镜像

```bash
cd server
docker build -t tanva-backend:latest .
cd ..
```

### 3. 运行后端容器

```bash
docker run -d \
  --name tanva-backend \
  -p 4000:4000 \
  -e DATABASE_URL="postgresql://postgres:tanva123456@host.docker.internal:5432/tanva?schema=public" \
  -e JWT_ACCESS_SECRET="dev-secret-long-enough" \
  -e JWT_REFRESH_SECRET="dev-secret-long-enough" \
  -e COOKIE_SECRET="dev-secret-long-enough" \
  -e COOKIE_SECURE="false" \
  -e CORS_ORIGIN="http://localhost:5173" \
  --link tanva-postgres \
  tanva-backend:latest
```

### 4. 构建前端镜像

```bash
docker build \
  -t tanva-frontend:latest \
  -f Dockerfile.frontend \
  --build-arg VITE_ENV=development \
  --build-arg VITE_GOOGLE_GEMINI_API_KEY=dev-key \
  .
```

### 5. 运行前端容器

```bash
docker run -d \
  --name tanva-frontend \
  -p 80:80 \
  --link tanva-backend \
  tanva-frontend:latest
```

### 6. 检查容器运行状态

```bash
docker ps
docker logs tanva-backend
docker logs tanva-frontend
```

---

## 故障排查

### 容器无法启动

```bash
# 查看容器日志
docker logs tanva-backend
docker logs tanva-frontend
docker logs tanva-postgres

# 进入容器调试
docker exec -it tanva-backend /bin/sh
docker exec -it tanva-postgres psql -U postgres -d tanva
```

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 测试数据库连接
docker exec tanva-postgres psql -U postgres -d tanva -c "SELECT 1"

# 如果使用 host.docker.internal，在 Linux 上需要特殊处理
# Linux 用户应使用容器网络而不是 host.docker.internal
```

### 端口被占用

```bash
# 查找占用某个端口的进程（macOS/Linux）
lsof -i :4000
lsof -i :5432
lsof -i :80

# Windows
netstat -ano | findstr :4000

# 杀死进程或更改映射端口
# 例如，使用 8080 代替 4000：
docker run -d -p 8080:4000 tanva-backend:latest
```

### 权限问题

```bash
# 如果遇到权限错误，尝试以 root 运行（仅用于开发）
docker run --user root -d tanva-backend:latest
```

---

## 开发工作流

### 本地开发（不使用 Docker）

如果你想在本地开发而不用 Docker，可以：

```bash
# 启动本地 PostgreSQL
# macOS（使用 Homebrew）
brew services start postgresql@15

# 或使用 Docker 只启动数据库
docker run -d \
  --name tanva-postgres-dev \
  -e POSTGRES_PASSWORD=tanva123456 \
  -p 5432:5432 \
  postgres:15-alpine

# 后端开发
cd server
npm install
DATABASE_URL="postgresql://postgres:tanva123456@localhost:5432/tanva?schema=public" npm run dev

# 前端开发（新终端）
npm install
VITE_GOOGLE_GEMINI_API_KEY="your-key" npm run dev
```

### 容器化开发（使用 Docker）

对于完整的容器化开发体验：

```bash
# 只启动 PostgreSQL
docker run -d \
  --name tanva-postgres \
  -e POSTGRES_PASSWORD=tanva123456 \
  -p 5432:5432 \
  postgres:15-alpine

# 本地运行后端（热重载）
cd server
DATABASE_URL="postgresql://postgres:tanva123456@localhost:5432/tanva?schema=public" npm run dev

# 本地运行前端（热重载）
npm run dev
```

---

## 构建和推送镜像到镜像仓库

### 推送到 Docker Hub（可选）

```bash
# 登录 Docker Hub
docker login

# 标记镜像
docker tag tanva-backend:latest yourusername/tanva-backend:latest
docker tag tanva-frontend:latest yourusername/tanva-frontend:latest

# 推送镜像
docker push yourusername/tanva-backend:latest
docker push yourusername/tanva-frontend:latest
```

### 推送到 Sealos Registry（用于 Sealos 部署）

```bash
# 登录 Sealos registry
docker login registry.sealos.app -u your-username -p your-password

# 标记镜像
docker tag tanva-backend:latest registry.sealos.app/your-namespace/tanva-backend:latest
docker tag tanva-frontend:latest registry.sealos.app/your-namespace/tanva-frontend:latest

# 推送
docker push registry.sealos.app/your-namespace/tanva-backend:latest
docker push registry.sealos.app/your-namespace/tanva-frontend:latest
```

---

## 优化建议

### 减小镜像大小

1. **使用多阶段构建**（已在 Dockerfile 中实现）
2. **使用 Alpine 基础镜像**（已在 Dockerfile 中实现）
3. **清理不必要的文件**：
   ```dockerfile
   RUN npm ci --omit=dev && npm cache clean --force
   ```

### 性能优化

1. **启用 Docker BuildKit**：
   ```bash
   DOCKER_BUILDKIT=1 docker build -f server/Dockerfile .
   ```

2. **使用 .dockerignore** 减少构建上下文：
   ```
   node_modules
   dist
   .git
   .env
   .DS_Store
   ```

---

## 清理 Docker 资源

```bash
# 停止所有容器
docker stop $(docker ps -aq)

# 删除所有容器
docker rm $(docker ps -aq)

# 删除所有镜像
docker rmi $(docker images -aq)

# 清理未使用的资源
docker system prune -a --volumes

# 查看磁盘使用
docker system df
```

---

## 检查清单

部署到 Sealos 前的本地测试清单：

- [ ] Docker Desktop 已启动
- [ ] `docker-compose up` 命令成功
- [ ] 所有容器都处于 Running 状态
- [ ] 数据库迁移成功：`docker-compose exec backend npx prisma migrate deploy`
- [ ] 后端健康检查通过：`curl http://localhost:4000/api/health`
- [ ] 前端可在浏览器访问：`http://localhost`
- [ ] 用户注册/登录功能正常工作
- [ ] 环境变量正确配置
- [ ] 没有容器日志错误
- [ ] Dockerfile 构建成功且镜像大小合理

---

## 下一步

✅ 本地测试通过
→ 推送代码到 GitHub
→ 按照 SEALOS_QUICK_START.md 部署到 Sealos

