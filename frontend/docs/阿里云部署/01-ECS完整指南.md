# 🚀 Aliyun ECS 完整部署指南

## 快速总结

```
ECS = 云服务器 (自己的云电脑)

你的本地电脑                    Aliyun ECS 云服务器
┌──────────────────────┐      ┌──────────────────────┐
│ Tanva 应用           │      │ Tanva 应用 (复制)    │
│ 运行在这里 (开发)     │      │ 运行在这里 (生产)    │
│                      │ --→  │                      │
│ http://localhost:    │      │ https://tai.tanva... │
│   4000 (后端)        │      │                      │
│   5173 (前端)        │      │                      │
└──────────────────────┘      └──────────────────────┘
     开发环境                        生产环境
     在你电脑上开发                  用户访问这个
```

---

## 第一步: 购买 ECS 服务器 (15分钟)

### 1.1 访问阿里云官网

```
https://www.aliyun.com
→ 选择 "产品" → "计算" → "云服务器 ECS"
→ 点击 "立即购买"
```

### 1.2 选择配置

#### 推荐配置 (适合初期)

```
基础信息:
├─ 地域: 华南 (深圳) ← 国内最优
├─ 可用区: 随意选择
└─ 实例类型: 通用型

计算规格:
├─ vCPU: 2核 ← 足够用
├─ 内存: 2GB
└─ 处理器: Intel Xeon

镜像:
├─ 公共镜像: Ubuntu 22.04 LTS
├─ 磁盘: 40GB SSD ← 足够
└─ 系统盘类型: 高效云盘

存储:
├─ 系统盘: 40GB ✅
└─ 数据盘: 无需添加 (初期)

网络:
├─ VPC: 新建
├─ 子网: 默认
├─ 公网IP: 分配 ✅ (重要!)
├─ 带宽: 1Mbps (按流量计费)
└─ 安全组: 新建

其他:
├─ 购买时长: 1个月
├─ 自动续费: 启用
└─ 密钥对: 新建一个
```

#### 成本预估

```
ECS 2核2GB 费用:
├─ 按月计费: ¥50-80/月
├─ 按年计费: ¥500-700/年 (便宜20%)
└─ 推荐: 先月付, 后年付

总成本:
├─ ECS: ¥50/月
├─ RDS数据库: ¥30/月
├─ OSS存储: ¥5/月
├─ CDN加速: ¥100/月
└─ 总计: ¥185/月
```

### 1.3 付款和获取服务器

```
1. 填写订单信息
2. 支付费用 (支持支付宝)
3. 等待 3-5 分钟
4. 服务器启动完成！

在阿里云控制台看到你的服务器:
控制台 → ECS → 实例列表
你会看到一个名字像 "i-xxxxx" 的实例

重要信息:
✅ 公网 IP (例: 120.123.45.67)
✅ SSH 密钥对文件 (example.pem)
✅ 登录用户: ubuntu
```

---

## 第二步: 配置安全组 (5分钟)

### 2.1 打开必要的端口

```
在阿里云控制台:
ECS → 实例 → 你的实例 → 安全组 → 添加规则

需要开放的端口:
┌─────────┬──────┬──────────────┬─────────────┐
│ 协议    │ 端口 │ 授权对象     │ 说明        │
├─────────┼──────┼──────────────┼─────────────┤
│ SSH     │ 22   │ 0.0.0.0/0    │ SSH登录     │
│ HTTP    │ 80   │ 0.0.0.0/0    │ 网站访问    │
│ HTTPS   │ 443  │ 0.0.0.0/0    │ 安全访问    │
│ TCP     │ 4000 │ 0.0.0.0/0    │ 后端API     │
│ TCP     │ 5173 │ 0.0.0.0/0    │ 前端(可选)  │
└─────────┴──────┴──────────────┴─────────────┘

操作步骤:
1. 选择安全组
2. 点击 "入站规则" → "添加规则"
3. 对每个端口重复 4 次
4. 保存配置
```

---

## 第三步: 连接到服务器 (5分钟)

### 3.1 准备 SSH 密钥

```bash
# Mac/Linux: 密钥已经下载
# 文件名: example.pem

# 设置正确的权限 (很重要!)
chmod 600 ~/Downloads/example.pem

# Windows: 需要转换格式
# 使用 PuTTYgen 或其他工具
```

### 3.2 连接到服务器

```bash
# 查看你的公网IP
# 在阿里云控制台 → ECS 实例列表 → 看公网IP列

# 连接 (Mac/Linux)
ssh -i ~/Downloads/example.pem ubuntu@your-public-ip

# 例子:
ssh -i ~/Downloads/example.pem ubuntu@120.123.45.67

# 如果成功，你会看到:
# ubuntu@iZxxxxx:~$  ← 这表示你已登录到云服务器!

# Windows 用户:
# 使用 PuTTY
# Host: 120.123.45.67
# Port: 22
# Auth: example.ppk (转换后的密钥)
```

---

## 第四步: 安装必要软件 (15分钟)

### 4.1 更新系统

```bash
# 登录到服务器后，运行以下命令

sudo apt-get update
sudo apt-get upgrade -y

# 安装基础工具
sudo apt-get install -y curl git wget htop
```

### 4.2 安装 Node.js (长期支持版本)

```bash
# 下载 Node.js 安装脚本
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# 安装 Node.js
sudo apt-get install -y nodejs

# 验证安装
node --version    # 应该看到 v18.x.x
npm --version     # 应该看到 9.x.x
```

### 4.3 安装 PostgreSQL 数据库

```bash
# 添加 PostgreSQL 官方源
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -

# 安装 PostgreSQL 14
sudo apt-get update
sudo apt-get install -y postgresql-14

# 启动 PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 验证
psql --version   # 应该看到 psql (PostgreSQL) 14.x
```

### 4.4 安装 Nginx (反向代理)

```bash
# 安装 Nginx
sudo apt-get install -y nginx

# 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# 验证
sudo systemctl status nginx  # 应该显示 "active (running)"
```

### 4.5 安装 PM2 (进程管理)

```bash
# 全局安装 PM2
sudo npm install -g pm2

# 设置开机自启
pm2 startup
pm2 save

# 验证
pm2 --version
```

---

## 第五步: 部署应用代码 (30分钟)

### 5.1 克隆代码库

```bash
# 创建应用目录
mkdir -p /opt/tanva
cd /opt/tanva

# 克隆你的代码库 (使用 HTTPS)
git clone https://github.com/yourusername/tanva.git .

# 或使用 SSH (如果配置了 SSH key)
git clone git@github.com:yourusername/tanva.git .

# 验证
ls -la  # 应该看到 server/, package.json 等
```

### 5.2 安装依赖

```bash
# 安装前端依赖
npm install

# 安装后端依赖
cd server
npm install
cd ..
```

### 5.3 创建生产环境配置

```bash
# 创建生产环境文件
nano server/.env.production

# 粘贴以下内容 (修改敏感信息):
```

```env
# 生产环境配置

# 应用
PORT=4000
NODE_ENV=production

# 数据库 (重要: 修改为生产数据库)
DATABASE_URL="postgresql://tanva_user:strong_password@localhost:5432/tanva?schema=public"

# JWT
JWT_SECRET=your-secret-key-here-keep-it-safe

# CORS (只允许你的生产域名)
CORS_ORIGIN=https://tai.tanva.tgtai.com

# AI API
GOOGLE_GEMINI_API_KEY=your-gemini-key-here

# Aliyun OSS (稍后配置)
ALIYUN_ACCESS_KEY=your-access-key
ALIYUN_SECRET_KEY=your-secret-key
ALIYUN_OSS_REGION=oss-cn-shenzhen
ALIYUN_OSS_BUCKET=tai-tanva-ai

# 日志级别
LOG_LEVEL=info
```

### 5.4 创建生产数据库用户

```bash
# 连接到 PostgreSQL
sudo -u postgres psql

# 在 psql 命令行中:
CREATE DATABASE tanva;
CREATE USER tanva_user WITH PASSWORD 'strong_password';
GRANT ALL PRIVILEGES ON DATABASE tanva TO tanva_user;
\q

# 运行数据库迁移
cd /opt/tanva/server
npx prisma migrate deploy

# 验证
npx prisma db seed  # 如果有 seed 脚本

# 看到 "✓ Seeding completed" 表示成功
```

### 5.5 构建前端

```bash
# 在服务器上构建前端
cd /opt/tanva
npm run build

# 验证
ls -la dist/  # 应该看到 index.html 等文件
```

---

## 第六步: 配置 Nginx (20分钟)

### 6.1 创建 Nginx 配置文件

```bash
# 创建配置文件
sudo nano /etc/nginx/sites-available/tanva

# 粘贴以下内容:
```

```nginx
# Tanva 应用的 Nginx 配置

upstream backend {
    server 127.0.0.1:4000;
}

server {
    listen 80;
    server_name tai.tanva.tgtai.com;

    # 重定向 HTTP 到 HTTPS (稍后配置 SSL)
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tai.tanva.tgtai.com;

    # SSL 证书 (稍后配置)
    # ssl_certificate /etc/letsencrypt/live/tai.tanva.tgtai.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/tai.tanva.tgtai.com/privkey.pem;

    # 上传大小限制
    client_max_body_size 100M;

    # 前端静态文件
    location / {
        root /opt/tanva/dist;
        try_files $uri /index.html;
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }

    # 后端 API
    location /api {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 健康检查
    location /api/health {
        proxy_pass http://backend;
        access_log off;
    }
}
```

### 6.2 启用配置

```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/tanva /etc/nginx/sites-enabled/tanva

# 删除默认配置 (可选)
sudo rm /etc/nginx/sites-enabled/default

# 测试配置
sudo nginx -t

# 应该看到: "test is successful"

# 重启 Nginx
sudo systemctl reload nginx
```

---

## 第七步: 配置 SSL/TLS 证书 (10分钟)

### 7.1 安装 Certbot (免费 HTTPS)

```bash
# 安装 Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 获取证书 (使用你的域名)
sudo certbot certonly --nginx -d tai.tanva.tgtai.com

# 按照提示:
# 1. 输入邮箱
# 2. 同意 Let's Encrypt 条款
# 3. 选择是否接收邮件通知

# 成功后你会看到:
# Congratulations! Your certificate has been issued.
# Certificate is saved at: /etc/letsencrypt/live/tai.tanva.tgtai.com/fullchain.pem
```

### 7.2 更新 Nginx 配置使用 SSL

```bash
sudo nano /etc/nginx/sites-available/tanva

# 取消注释这两行:
# ssl_certificate /etc/letsencrypt/live/tai.tanva.tgtai.com/fullchain.pem;
# ssl_certificate_key /etc/letsencrypt/live/tai.tanva.tgtai.com/privkey.pem;

# 保存文件

# 重启 Nginx
sudo systemctl reload nginx
```

### 7.3 自动续期证书

```bash
# Let's Encrypt 证书有效期 90 天
# 设置自动续期

sudo certbot renew --dry-run

# 创建 cron job (每天检查)
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# 验证
sudo systemctl status certbot.timer
```

---

## 第八步: 启动应用 (10分钟)

### 8.1 后端启动 (使用 PM2)

```bash
# 进入项目目录
cd /opt/tanva/server

# 使用 PM2 启动
pm2 start "npm run start:prod" --name "tanva-backend" --env production

# 查看日志
pm2 logs tanva-backend

# 保存 PM2 配置
pm2 save
```

### 8.2 验证后端运行

```bash
# 检查进程
pm2 status

# 应该看到:
# ┌─────────────────┬──────┬───────────┬─────────┐
# │ id │ name        │ mode │ status  │ restart │
# ├─────────────────┼──────┼───────────┼─────────┤
# │ 0  │ tanva-backend │ fork │ online  │ 0       │
# └─────────────────┴──────┴───────────┴─────────┘

# 测试 API
curl http://localhost:4000/api/health

# 应该返回: {"status":"ok"}
```

### 8.3 验证前端访问

```bash
# 在你的电脑上
curl https://tai.tanva.tgtai.com

# 或在浏览器打开
https://tai.tanva.tgtai.com

# 应该看到你的 Tanva 应用!
```

---

## 第九步: 配置域名 DNS (5分钟)

### 9.1 获取服务器 IP

```
在阿里云控制台:
ECS → 实例列表 → 你的实例 → 公网IP

例: 120.123.45.67
```

### 9.2 在域名提供商配置 DNS

```
域名提供商 (例: 阿里云域名, Godaddy 等):
→ 管理 DNS 记录
→ 添加 A 记录:

名称: tai.tanva
类型: A
值: 120.123.45.67 (你的公网IP)
TTL: 300 (默认)

保存
```

### 9.3 验证 DNS

```bash
# 等待 5-10 分钟 DNS 生效

# 验证
nslookup tai.tanva.tgtai.com

# 应该看到:
# Non-authoritative answer:
# Name:   tai.tanva.tgtai.com
# Address: 120.123.45.67
```

---

## 第十步: 监控和维护 (持续)

### 10.1 查看应用状态

```bash
# 连接到服务器
ssh -i ~/Downloads/example.pem ubuntu@120.123.45.67

# 查看 PM2 进程
pm2 status

# 查看日志
pm2 logs tanva-backend

# 查看系统资源
top -p $(pgrep -f "node")

# 查看硬盘使用
df -h
```

### 10.2 常见操作

```bash
# 重启应用
pm2 restart tanva-backend

# 停止应用
pm2 stop tanva-backend

# 启动应用
pm2 start tanva-backend

# 重启 Nginx
sudo systemctl reload nginx

# 查看 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log
```

### 10.3 备份数据

```bash
# 备份数据库
sudo -u postgres pg_dump tanva > ~/tanva_backup_$(date +%Y%m%d).sql

# 备份应用代码和配置
tar -czf ~/tanva_app_backup_$(date +%Y%m%d).tar.gz /opt/tanva

# 下载到本地
# 使用 scp 或其他工具
scp -i ~/Downloads/example.pem ubuntu@120.123.45.67:~/tanva_backup_*.sql ~/backups/
```

---

## 完整部署检查清单

```
☐ 购买 ECS 服务器 (2核2GB)
☐ 配置安全组 (开放 22, 80, 443, 4000 端口)
☐ SSH 连接到服务器
☐ 安装 Node.js 18.x
☐ 安装 PostgreSQL 14
☐ 安装 Nginx
☐ 安装 PM2
☐ 克隆代码库
☐ 安装前后端依赖
☐ 创建 .env.production 配置文件
☐ 创建数据库用户和迁移
☐ 构建前端
☐ 配置 Nginx 反向代理
☐ 安装 SSL 证书 (Certbot)
☐ 启动后端应用 (PM2)
☐ 验证 API 接口
☐ 配置 DNS 记录
☐ 验证网站访问 (HTTPS)
☐ 设置监控告警
☐ 定期备份数据
```

---

## 成本总结

```
月度成本预估:

ECS (2核2GB)        ¥50/月
├─ 计算: ¥45
└─ 带宽: ¥5 (按流量计费)

RDS PostgreSQL     ¥30/月
├─ 高可用双机: ¥30
└─ 40GB 存储

OSS 存储           ¥5/月
├─ 100GB: ¥5
└─ 流量: 另计

CDN 加速           ¥100/月 (可选)
├─ 国内流量: ¥0.2/GB
└─ 假设 500GB/月

其他费用:
├─ 域名: ¥50/年
├─ SSL证书: ¥0 (Let's Encrypt 免费)
└─ 邮件通知: ¥0

═══════════════════════════
总计: ¥185-300/月
═══════════════════════════
```

---

## 故障排除

### 问题: 无法连接到服务器

```bash
# 检查安全组
# 确保 22 端口已开放

# 检查密钥权限
chmod 600 ~/Downloads/example.pem

# 重新尝试连接
ssh -i ~/Downloads/example.pem ubuntu@public-ip -v
```

### 问题: 应用无法启动

```bash
# 查看 PM2 日志
pm2 logs tanva-backend

# 检查环境变量
cat server/.env.production

# 检查端口占用
lsof -i :4000

# 查看 Node.js 版本
node --version
```

### 问题: 访问 HTTPS 显示证书错误

```bash
# 检查 SSL 证书状态
sudo certbot certificates

# 手动更新证书
sudo certbot renew --force-renewal

# 检查 Nginx 配置
sudo nginx -t
```

### 问题: 数据库连接失败

```bash
# 检查 PostgreSQL 状态
sudo systemctl status postgresql

# 测试连接
psql -U tanva_user -d tanva -h localhost

# 查看 PostgreSQL 日志
sudo journalctl -u postgresql -f
```

---

## 下一步

完成部署后:

1. ✅ 访问 `https://tai.tanva.tgtai.com` 验证应用
2. ✅ 测试 AI 功能 (生成图像、编辑等)
3. ✅ 配置 OSS + CDN (见 `OSS_CDN_GUIDE.md`)
4. ✅ 设置监控告警 (阿里云云监控)
5. ✅ 定期备份数据库和代码

推荐学习资料:
- [Nginx 文档](https://nginx.org/en/docs/)
- [PostgreSQL 官方文档](https://www.postgresql.org/docs/)
- [Let's Encrypt 文档](https://letsencrypt.org/docs/)
- [PM2 文档](https://pm2.keymetrics.io/docs/)

祝部署顺利! 🎉
