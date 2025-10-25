# 生产环境配置使用指南

## 📋 概述

本项目已准备好**开发环境**和**生产环境**两套独立的配置文件，使用不同的命名区分：

- **开发环境**: `.env.local`、`.env`、`server/.env`
- **生产环境**: `.env.production`、`.env.production`、`server/.env.production`

## 🔄 配置文件结构

```
项目根目录/
├── .env                      # 开发环境 - 根目录（脚本用）
├── .env.production           # ⭐ 生产环境 - 根目录
├── .env.local                # 开发环境 - 前端配置
├── server/
│   ├── .env                  # 开发环境 - 后端配置
│   └── .env.production       # ⭐ 生产环境 - 后端配置
```

## 🎯 各环境用途说明

### 开发环境配置

| 文件 | 用途 | 说明 |
|------|------|------|
| `.env.local` | 前端本地开发 | localhost、局域网IP、代理路由 |
| `.env` | 根目录脚本 | 演示页面、测试脚本用 |
| `server/.env` | 后端本地开发 | 本地数据库、弱密钥、localhost CORS |

**特点**：
- 使用本地数据库 (localhost:5432)
- 允许多个本地来源 (localhost、局域网 IP)
- 日志级别为 `debug`
- JWT 密钥为占位符

### 生产环境配置

| 文件 | 用途 | 说明 |
|------|------|------|
| `.env.production` | 前端生产构建 | 生产域名、HTTPS、生产 API 路由 |
| `.env.production` | 根目录脚本 | 生产脚本和工具使用 |
| `server/.env.production` | 后端生产运行 | 生产数据库、强密钥、生产域名 CORS |

**特点**：
- 使用云/远程数据库
- 只允许生产域名
- HTTPS 强制开启
- JWT 密钥为强随机值
- 日志级别为 `info`

## 📝 生产环境部署步骤

### 1. 准备生产密钥

生成新的强随机密钥（不要使用示例值）：

```bash
# 生成 JWT Access Secret
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"

# 生成 JWT Refresh Secret
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"

# 生成 Cookie Secret
node -e "console.log('COOKIE_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
```

### 2. 更新生产数据库凭据

编辑 `server/.env.production`，替换数据库连接字符串：

```ini
DATABASE_URL="postgresql://tanva_user:your_strong_password@your-db-host:5432/tanva?schema=public"
COST_TRACKING_DATABASE_URL="postgresql://tanva_user:your_strong_password@your-db-host:5432/tanva_cost_tracking?schema=public"
```

### 3. 配置生产域名

替换以下配置中的 `tai.tanva.tgtai.com`：

**前端** (`.env.production`):
```ini
VITE_API_BASE=https://your-production-domain.com/api
VITE_API_URL=https://your-production-domain.com
```

**后端** (`server/.env.production`):
```ini
COOKIE_DOMAIN=your-production-domain.com
CORS_ORIGIN=https://your-production-domain.com
OSS_CDN_HOST=your-production-domain.com
```

### 4. 配置 OSS 凭据（如需隔离）

如果生产需要使用独立的 OSS 存储：

```ini
OSS_BUCKET=your-prod-bucket-name
OSS_ACCESS_KEY_ID=your-prod-access-key-id
OSS_ACCESS_KEY_SECRET=your-prod-access-key-secret
```

### 5. 部署前验证清单

- [ ] 生成了新的 JWT 和 Cookie 密钥
- [ ] 更新了生产数据库凭据
- [ ] 设置了正确的生产域名
- [ ] 配置了生产 OSS（如需隔离）
- [ ] 测试了数据库连接
- [ ] 测试了 OSS 连接
- [ ] 确认没有将生产密钥提交到版本库

### 6. 构建和部署

```bash
# 前端构建（自动加载 .env.production）
npm run build

# 后端部署
cd server

# 使用生产环境变量启动
NODE_ENV=production npm start

# 或使用 PM2 等进程管理
pm2 start npm --name "tanva-server" -- start -- --env-file=.env.production
```

### 7. 部署后验证

```bash
# 检查健康状态
curl https://your-production-domain.com/api/health

# 测试登陆 API
curl -X POST https://your-production-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"13900000100","password":"LoginTest123"}'

# 检查日志
tail -f /var/log/tanva-server.log
```

## 🔐 安全建议

### ✅ 必做事项

1. **不提交生产密钥到版本库**
   ```bash
   # 添加到 .gitignore
   echo "server/.env.production" >> .gitignore
   echo ".env.production" >> .gitignore
   ```

2. **在 CI/CD 中注入敏感信息**
   - 使用 GitHub Secrets 或类似机制
   - 在部署时动态注入 `.env.production`
   - 不要硬编码密钥

3. **定期轮换密钥**
   - 定期生成新的 JWT 和 Cookie 密钥
   - 重启服务以加载新密钥
   - 保留审计日志

4. **监控和告警**
   - 设置错误日志告警
   - 监控认证失败次数
   - 追踪敏感 API 调用

### ⚠️ 避免事项

- ❌ 不要在代码中硬编码生产密钥
- ❌ 不要将 `.env.production` 提交到版本库
- ❌ 不要在不安全的通道中传输密钥
- ❌ 不要重复使用开发密钥
- ❌ 不要在客户端代码中暴露 API 密钥

## 📊 环境变量对比表

### 前端配置对比

| 变量 | 开发环境 (.env.local) | 生产环境 (.env.production) |
|------|------|------|
| `VITE_API_BASE` | `/api` (代理) | `https://domain/api` |
| `VITE_API_URL` | `http://localhost:5173` | `https://domain` |
| `VITE_AUTH_MODE` | `server` | `server` |
| `VITE_AI_LANGUAGE` | `zh` | `zh` |

### 后端配置对比

| 变量 | 开发环境 (server/.env) | 生产环境 (server/.env.production) |
|------|------|------|
| `DATABASE_URL` | localhost:5432 | Cloud DB host |
| `NODE_ENV` | (未设置) | `production` |
| `JWT_ACCESS_SECRET` | `replace-with-...` | 强随机值 |
| `COOKIE_SECURE` | `false` | `true` |
| `COOKIE_DOMAIN` | `localhost` | `domain.com` |
| `CORS_ORIGIN` | 多个本地来源 | 单个生产域名 |
| `LOG_LEVEL` | `debug` | `info` |
| `OSS_*` | 开发桶 | 生产桶（可选隔离） |

## 🆘 常见问题

### Q: 忘记了生产密钥怎么办？

A: 重新生成新密钥，但需要重新登陆所有用户（因为旧 JWT 会失效）。

### Q: 如何在本地测试生产环境配置？

A: 使用 `.env.production` 文件并设置 `NODE_ENV=production`：

```bash
# 前端
npm run build && npm run preview

# 后端
NODE_ENV=production npm start
```

### Q: 开发和生产环境可以共用数据库吗？

A: **不推荐**，最好使用独立的数据库以避免数据混污。如必须共用，应创建独立的 Schema。

### Q: 如何处理生产环境 API 密钥轮换？

A: 使用蓝绿部署或金丝雀发布，逐步推送新密钥。

## 📚 相关文档

- [环境配置速查表](./environment-config.md) - 详细配置参考
- [部署指南](./部署指南/) - 完整部署步骤
- [故障排除](./部署指南/README.md) - 常见问题解决

## 📞 支持

如有问题，请参考：

1. `environment-config.md` - 详细配置文档
2. 服务日志 - `tail -f /var/log/tanva-server.log`
3. API 健康检查 - `GET /api/health`

---

**最后提醒**: 生产环境部署前，请务必完成上述所有验证步骤！🚀
