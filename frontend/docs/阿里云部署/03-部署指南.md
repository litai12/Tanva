# ☁️ Aliyun 部署完整指南

你已有域名 `tai.tanva.tgtai.com` 指向Aliyun，现在让我们完成部署。

---

## 📊 部署流程概览

```
你的本地代码
    ↓
1. 推送到Git (GitHub/GitLab)
    ↓
2. SSH连接到Aliyun服务器
    ↓
3. 克隆代码 + 安装依赖
    ↓
4. 启动应用 (PM2或systemd)
    ↓
5. 配置Nginx反向代理
    ↓
6. 配置SSL证书
    ↓
7. 配置DNS
    ↓
✅ https://tai.tanva.tgtai.com 可访问
```

---

## 🔧 前置条件

你需要:

- [ ] Aliyun ECS服务器 (最低配置: 1核2GB, 按量$3/月起)
- [ ] 服务器操作系统: Ubuntu 20.04 LTS 或 CentOS 7
- [ ] SSH访问权限 (密钥对或密码)
- [ ] 已购买域名 `tai.tanva.tgtai.com`
- [ ] 代码已提交到Git仓库

### 购买ECS (如未购买)

1. 访问 https://www.aliyun.com/product/ecs
2. 选择配置:
   - 地域: 华东2 (上海) 或离你最近的地区
   - 实例: 1核2GB (足够开发/演示)
   - 系统: Ubuntu 20.04 LTS
   - 带宽: 1Mbps (可升级)
3. 购买后获得服务器IP地址和登录凭证

---

## 📝 第1步: 服务器初始化 (首次部署)

### 1.1 SSH连接到服务器

```bash
# 使用密钥对连接
ssh -i /path/to/key.pem root@你的服务器IP

# 或使用密码连接 (按提示输入密码)
ssh root@你的服务器IP
```

### 1.2 更新系统

```bash
sudo apt update
sudo apt upgrade -y
```

### 1.3 安装Node.js

```bash
# 安装Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node --version
npm --version
```

### 1.4 安装PostgreSQL (数据库)

```bash
sudo apt install -y postgresql postgresql-contrib

# 启动PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 验证
sudo -u postgres psql --version
```

### 1.5 创建数据库

```bash
# 以postgres用户连接
sudo -u postgres psql

# 在psql中执行:
CREATE DATABASE tanva;
CREATE USER tanva_user WITH PASSWORD 'strong_password_here';
ALTER ROLE tanva_user SET client_encoding TO 'utf8';
ALTER ROLE tanva_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE tanva_user SET default_transaction_deferrable TO on;
ALTER ROLE tanva_user SET default_transaction_read_only TO off;
GRANT ALL PRIVILEGES ON DATABASE tanva TO tanva_user;
\q  # 退出psql
```

### 1.6 安装Nginx和PM2

```bash
# 安装Nginx
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# 安装PM2 (Node.js进程管理)
sudo npm install -g pm2
pm2 install pm2-auto-pull  # 自动部署插件
```

### 1.7 安装SSL证书工具

```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## 📂 第2步: 部署应用代码

### 2.1 克隆代码

```bash
# 如果使用密钥认证的Git仓库
cd /opt
sudo git clone git@github.com:你的用户名/Tanva.git
sudo chown -R $USER:$USER Tanva
cd Tanva
```

### 2.2 安装依赖

```bash
# 后端依赖
cd server
npm install

# 前端依赖 (回到根目录)
cd ..
npm install
```

### 2.3 配置环境变量

```bash
# 编辑服务器上的 server/.env
cd server
nano .env
```

**必须修改的配置**:

```env
# 数据库
DATABASE_URL="postgresql://tanva_user:strong_password_here@localhost:5432/tanva?schema=public"

# 前端URL (服务器端渲染如需)
DEV_ORIGIN=https://tai.tanva.tgtai.com

# CORS配置 - 仅允许你的域名
CORS_ORIGIN=https://tai.tanva.tgtai.com

# Cookie域名
COOKIE_DOMAIN=tai.tanva.tgtai.com

# JWT密钥 (生成强随机值)
JWT_ACCESS_SECRET=生成一个强密钥
JWT_REFRESH_SECRET=生成另一个强密钥

# 其他保持不变...
```

**生成强密钥的方法**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2.4 构建应用

```bash
# 前端构建
npm run build

# 后端不需要特别构建，Node.js运行TS时需要ts-node
# 或编译为JS
npm run build:backend  # 如果有这个script
```

---

## 🚀 第3步: 启动应用 (PM2)

### 3.1 创建PM2配置文件

```bash
# 根目录创建 ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'tanva-backend',
      script: 'dist/main.js',  // 编译后的入口
      cwd: './server',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
EOF
```

### 3.2 启动应用

```bash
# 第一次启动
pm2 start ecosystem.config.js

# 保存配置 (重启时自动启动)
pm2 save
sudo env PATH=$PATH:/usr/local/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp /home/$USER
```

### 3.3 监控应用

```bash
# 查看应用状态
pm2 status

# 查看日志
pm2 logs tanva-backend

# 重启应用
pm2 restart tanva-backend
```

---

## 🔐 第4步: 配置Nginx反向代理

### 4.1 创建Nginx配置

```bash
# 编辑Nginx配置
sudo nano /etc/nginx/sites-available/tanva
```

**写入以下内容**:

```nginx
upstream tanva_backend {
    server localhost:4000;
}

server {
    listen 80;
    listen [::]:80;
    server_name tai.tanva.tgtai.com;

    # 重定向到HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name tai.tanva.tgtai.com;

    # SSL证书 (稍后配置)
    ssl_certificate /etc/letsencrypt/live/tai.tanva.tgtai.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tai.tanva.tgtai.com/privkey.pem;

    # SSL安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 前端静态文件
    location / {
        root /opt/Tanva/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端API代理
    location /api/ {
        proxy_pass http://tanva_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 超时配置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 120s;
    }
}
```

### 4.2 启用配置

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/tanva /etc/nginx/sites-enabled/tanva

# 删除默认配置
sudo rm /etc/nginx/sites-enabled/default

# 测试Nginx配置
sudo nginx -t

# 重启Nginx
sudo systemctl restart nginx
```

---

## 🔐 第5步: 配置SSL证书 (Let's Encrypt)

### 5.1 申请证书

```bash
# 自动申请并配置
sudo certbot certonly --nginx -d tai.tanva.tgtai.com

# 按提示输入邮箱和同意条款
```

### 5.2 自动更新证书

```bash
# Let's Encrypt证书有效期90天，需要自动更新
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# 测试自动更新
sudo certbot renew --dry-run
```

### 5.3 验证证书

```bash
# 访问你的域名，检查浏览器地址栏是否显示锁标志
# 或使用命令行检查
openssl s_client -connect tai.tanva.tgtai.com:443 -servername tai.tanva.tgtai.com 2>/dev/null | openssl x509 -noout -dates
```

---

## 🌐 第6步: 配置DNS

### 6.1 在Aliyun控制台配置DNS

1. 登录 https://dns.aliyun.com
2. 找到你的域名
3. 添加A记录:
   - 主机记录: `@` 或 `tai`
   - 记录类型: A
   - 记录值: 你的服务器IP
   - TTL: 600

### 6.2 验证DNS

```bash
# 检查DNS是否生效 (可能需要5-10分钟)
nslookup tai.tanva.tgtai.com

# 应该看到你的服务器IP
```

---

## ✅ 第7步: 验证部署

### 7.1 本地验证

从你的电脑执行:

```bash
# 测试HTTPS
curl -I https://tai.tanva.tgtai.com

# 应该返回 200 OK

# 测试后端API
curl https://tai.tanva.tgtai.com/api/public/ai/providers

# 应该返回提供商列表
```

### 7.2 浏览器验证

打开浏览器访问:
```
https://tai.tanva.tgtai.com
```

验证清单:
- [ ] 页面加载成功
- [ ] HTTPS显示为安全 (绿色锁标志)
- [ ] 前端功能正常
- [ ] 后端API响应正常
- [ ] 图像生成/编辑功能工作

---

## 📊 部署后的维护

### 定期任务

```bash
# 查看应用日志
pm2 logs tanva-backend

# 查看系统资源
top

# 数据库备份
sudo -u postgres pg_dump tanva > tanva_backup.sql

# 重启应用
pm2 restart tanva-backend

# 更新代码
cd /opt/Tanva
git pull
npm install
npm run build
pm2 restart tanva-backend
```

### 常见问题

**Q: 数据库连接错误？**
```bash
# 检查PostgreSQL状态
sudo systemctl status postgresql

# 重启PostgreSQL
sudo systemctl restart postgresql
```

**Q: Nginx配置有误？**
```bash
# 检查配置
sudo nginx -t

# 查看错误日志
sudo tail -f /var/log/nginx/error.log
```

**Q: PM2进程崩溃？**
```bash
# 查看日志
pm2 logs tanva-backend --lines 100

# 重启
pm2 restart tanva-backend
```

---

## 💰 成本估算

| 项目 | 成本 |
|------|------|
| ECS (1核2GB) | ¥36/年 (按量计费) |
| 域名 (已有) | 免费 |
| SSL证书 | 免费 (Let's Encrypt) |
| 带宽 (1Mbps) | ¥60/月 |
| **总计** | **约¥100-150/年** |

---

## 🎉 部署完成！

现在 `https://tai.tanva.tgtai.com` 对全球用户可访问！

### 后续改进

- [ ] 配置CDN加速 (Aliyun CDN)
- [ ] 设置自动备份
- [ ] 配置监控告警
- [ ] 添加日志分析
- [ ] 性能优化

