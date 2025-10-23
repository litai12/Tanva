# Build stage
FROM node:20-alpine as builder

WORKDIR /app

# 复制 package files
COPY package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码和 Prisma schema
COPY . .

# 构建应用
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# 安装 dumb-init（优雅处理信号转发）和 curl（用于健康检查）
RUN apk add --no-cache dumb-init curl

# 复制 package files
COPY package*.json ./

# 只安装生产依赖
RUN npm ci --omit=dev

# 复制 Prisma schema（用于运行时）
COPY prisma ./prisma

# 复制构建产物
COPY --from=builder /app/dist ./dist

# 创建非 root 用户（安全最佳实践）
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# 暴露端口
EXPOSE 4000

# 使用 dumb-init 确保正确处理信号（SIGTERM）
ENTRYPOINT ["dumb-init", "--"]

# 启动应用
CMD ["node", "dist/main.js"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:4000/api/health || exit 1
