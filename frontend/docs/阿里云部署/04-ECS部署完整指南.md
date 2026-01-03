# Tanva ECS 部署完整指南

## 📋 目录

1. [准备工作](#准备工作)
2. [获取ECS信息](#获取ecs信息)
3. [SSH连接ECS](#ssh连接ecs)
4. [执行部署脚本](#执行部署脚本)
5. [配置环境变量](#配置环境变量)
6. [配置SSL证书](#配置ssl证书)
7. [配置DNS](#配置dns)
8. [验证部署](#验证部署)
9. [故障排查](#故障排查)
10. [日常维护](#日常维护)

---

## 准备工作

### 所需信息清单

在开始部署前，请准备以下信息：

- [ ] ECS服务器的**公网IP地址** (如: 47.106.140.227)
- [ ] ECS购买时创建的**密钥对文件** (.pem 或 .ppk)
- [ ] 你要使用的**域名** (如: tai.tanva.tgtai.com)
- [ ] **Google Gemini API Key**
- [ ] **GitHub 仓库 URL** (如果代码在GitHub上)

### 本地准备

```bash
# 确保你的Tanva代码已经提交到Git并推送到远程仓库
cd ~/Documents/Development/dev/Tanva
git status  # 确保没有未提交的更改
git push origin oss  # 推送当前分支到远程
```

---

## 获取ECS信息

### 从阿里云控制台获取ECS信息

1. 打开 [阿里云控制台](https://ecs.console.aliyun.com/)
2. 左侧菜单 → **实例**
3. 找到你购买的ECS实例
4. 记录以下信息：
   - **实例名称**: 用于识别
   - **公网IP**: 用于SSH连接 (如: 47.106.140.227)
   - **实例ID**: 用于参考
   - **操作系统**: 确认是 Ubuntu 22.04 或类似

### 查看安全组规则

1. 点击你的ECS实例
2. 找到 **关联的安全组**
3. 点击安全组进入配置
4. 在 **入站规则** 中，确保允许以下端口：
   - **22** (SSH) - 用于远程连接
   - **80** (HTTP) - 用于Web访问
   - **443** (HTTPS) - 用于安全Web访问
   - **5432** (PostgreSQL) - 可选，仅本地访问

---

## SSH连接ECS

### 方式1: 使用密钥对（推荐）

#### 在macOS/Linux上：

```bash
# 1. 将密钥文件复制到~/.ssh目录
cp ~/Downloads/your-key-pair.pem ~/.ssh/
chmod 600 ~/.ssh/your-key-pair.pem

# 2. 连接到ECS
ssh -i ~/.ssh/your-key-pair.pem ubuntu@47.106.140.227

# 3. 如果连接成功，你会看到:
# Welcome to Ubuntu 22.04.3 LTS ...
# ubuntu@i-bp1...~$
```

#### 在Windows上使用PuTTY：

1. 下载 PuTTYgen
2. 加载你的 .pem 密钥文件
3. 导出为 .ppk 格式
4. 在PuTTY中：
   - Host: `ubuntu@47.106.140.227`
   - Connection → SSH → Auth: 选择你的 .ppk 文件
   - Open (连接)

### 方式2: 使用阿里云Web终端

1. 在ECS实例详情页
2. 点击 **远程连接** → **Web Shell**
3. 使用阿里云web界面的命令行

### 测试连接

连接成功后，运行命令检查系统：

```bash
# 检查Ubuntu版本
lsb_release -a

# 检查空间
df -h

# 检查内存
free -h
```

---

## 执行部署脚本

### 下载并执行自动化脚本

```bash
# 1. 下载部署脚本到ECS
# 方式A: 使用curl从GitHub下载（如果脚本已上传）
curl -O https://raw.githubusercontent.com/your-org/tanva/main/deploy-to-ecs.sh

# 方式B: 本地上传脚本
scp -i ~/.ssh/your-key-pair.pem deploy-to-ecs.sh ubuntu@47.106.140.227:~/

# 2. SSH连接到ECS
ssh -i ~/.ssh/your-key-pair.pem ubuntu@47.106.140.227

# 3. 执行部署脚本（约需15-20分钟）
bash ~/deploy-to-ecs.sh

# 4. 脚本会输出：
#    - PostgreSQL用户密码（重要！保存好）
#    - 数据库配置信息
#    - 下一步操作说明
```

### 脚本做了什么？

脚本自动执行以下步骤：

| 步骤 | 操作 | 时间 |
|------|------|------|
| 1 | 更新系统包 | 2分钟 |
| 2 | 安装Node.js 20 | 2分钟 |
| 3 | 安装PostgreSQL 15 | 2分钟 |
| 4 | 配置PostgreSQL数据库 | 1分钟 |
| 5 | 安装Nginx和PM2 | 1分钟 |
| 6 | 创建应用目录 | <1分钟 |
| 7 | 克隆代码并构建 | 5-8分钟 |
| 8 | 创建环境文件 | 1分钟 |
| 9 | 配置Nginx反向代理 | 1分钟 |
| 10 | 启动PM2服务 | 1分钟 |

---

## 配置环境变量

### 编辑服务端环境文件

```bash
# 打开编辑器
sudo nano /home/ubuntu/tanva/server/.env.production
```

修改以下部分（脚本已生成模板，只需更新关键部分）：

```env
PORT=4000
HOST=0.0.0.0
NODE_ENV=production
DATABASE_URL="postgresql://tanva_user:YOUR_DB_PASSWORD@localhost:5432/tanva?schema=public"
CORS_ORIGIN=https://tai.tanva.tgtai.com,https://www.tai.tanva.tgtai.com
DEFAULT_AI_PROVIDER=gemini
GOOGLE_GEMINI_API_KEY=your_actual_gemini_api_key_here  # 👈 替换为你的API Key
LOG_LEVEL=info
```

保存文件: `Ctrl + O` → `Enter` → `Ctrl + X`

### 编辑前端环境文件

```bash
sudo nano /home/ubuntu/tanva/.env.production
```

```env
VITE_AI_LANGUAGE=zh
VITE_AUTH_MODE=server
VITE_API_BASE_URL=https://your-backend-domain.com  # 👈 替换为你的后端域名（不要包含 /api）
```

保存文件: `Ctrl + O` → `Enter` → `Ctrl + X`

### 验证环境变量

```bash
# 检查服务端环境变量
cat /home/ubuntu/tanva/server/.env.production

# 检查前端环境变量
cat /home/ubuntu/tanva/.env.production
```

---

## 配置SSL证书

### 使用Let's Encrypt（免费）

```bash
# 1. 安装Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 2. 获取SSL证书
# ⚠️ 确保你的域名已解析到ECS公网IP，否则此步会失败
sudo certbot certonly --nginx -d tai.tanva.tgtai.com -d www.tai.tanva.tgtai.com

# 3. 验证证书已创建
ls -la /etc/letsencrypt/live/tai.tanva.tgtai.com/

# 4. 更新Nginx配置
sudo nano /etc/nginx/sites-available/tanva
```

在编辑器中，找到SSL证书部分并更新为实际路径：

```nginx
ssl_certificate /etc/letsencrypt/live/tai.tanva.tgtai.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/tai.tanva.tgtai.com/privkey.pem;
```

同时将所有 `your-domain.com` 替换为 `tai.tanva.tgtai.com`:

```nginx
server_name tai.tanva.tgtai.com www.tai.tanva.tgtai.com;
```

### 设置证书自动续期

```bash
# 测试续期过程（干运行）
sudo certbot renew --dry-run

# 启用自动续期（已默认启用，验证一下）
sudo systemctl enable certbot.timer
sudo systemctl status certbot.timer
```

---

## 配置DNS

### 添加DNS记录到你的域名供应商

登录你的域名供应商的控制台（如阿里云域名服务、Cloudflare等），添加A记录：

| 记录类型 | 主机记录 | 记录值 | TTL |
|---------|---------|--------|-----|
| A | tai | 47.106.140.227 | 600 |
| A | www.tai | 47.106.140.227 | 600 |

**如果你使用的是根域名（@）**：

| 记录类型 | 主机记录 | 记录值 | TTL |
|---------|---------|--------|-----|
| A | @ | 47.106.140.227 | 600 |
| A | www | 47.106.140.227 | 600 |

### 验证DNS生效

```bash
# 在本地运行（可能需要等待几分钟DNS生效）
nslookup tai.tanva.tgtai.com
# 应该返回: 47.106.140.227

dig tai.tanva.tgtai.com
# 应该看到正确的A记录
```

### 如果DNS未立即生效

```bash
# 清除本地DNS缓存（macOS）
sudo dscacheutil -flushcache

# 使用特定的DNS服务器查询
nslookup tai.tanva.tgtai.com 8.8.8.8
```

---

## 验证部署

### 1. 检查服务状态

```bash
# 检查PM2服务
pm2 status
# 应该看到: tanva-server ONLINE

# 检查Nginx
sudo systemctl status nginx
# 应该看到: active (running)

# 检查PostgreSQL
sudo systemctl status postgresql
# 应该看到: active (running)
```

### 2. 测试后端API

```bash
# 测试健康检查端点（通过HTTP，不验证SSL）
curl -v http://localhost:4000/health

# 测试通过HTTPS
curl -v https://tai.tanva.tgtai.com/health
```

### 3. 测试前端访问

```bash
# 在浏览器中打开
https://tai.tanva.tgtai.com
```

应该能看到：
- ✅ 绿色的HTTPS锁🔒
- ✅ Tanva应用加载
- ✅ 没有混合内容警告

### 4. 测试AI功能

1. 打开应用
2. 进入AI聊天
3. 输入: "生成一个美丽的日落"
4. 应该看到工具选择和图像生成

### 5. 检查日志

```bash
# 查看PM2日志
pm2 logs tanva-server
# 或查看完整日志文件
tail -f /home/ubuntu/tanva/server/logs/out.log

# 查看Nginx日志
sudo tail -f /var/log/nginx/error.log
```

---

## 故障排查

### 问题1: SSH连接超时

```bash
# 确保安全组允许SSH (端口22)
# 在阿里云控制台检查安全组规则

# 检查密钥文件权限
ls -la ~/.ssh/your-key-pair.pem
# 应该显示: -rw------- (600权限)

# 如果权限错误，修复它：
chmod 600 ~/.ssh/your-key-pair.pem
```

### 问题2: 应用无法启动

```bash
# 检查日志
pm2 logs tanva-server

# 检查环境变量是否正确
cat /home/ubuntu/tanva/server/.env.production

# 重启服务
pm2 restart tanva-server

# 查看详细错误
pm2 status
```

### 问题3: 数据库连接失败

```bash
# 测试PostgreSQL连接
psql -U tanva_user -d tanva -h localhost

# 检查PostgreSQL状态
sudo systemctl status postgresql

# 检查PostgreSQL日志
sudo tail -f /var/log/postgresql/postgresql-*.log
```

### 问题4: Nginx返回502错误

```bash
# 检查后端是否运行
curl http://localhost:4000/health

# 检查Nginx配置
sudo nginx -t

# 查看Nginx日志
sudo tail -f /var/log/nginx/error.log

# 重启Nginx
sudo systemctl restart nginx
```

### 问题5: SSL证书未生效

```bash
# 验证证书文件存在
ls -la /etc/letsencrypt/live/tai.tanva.tgtai.com/

# 测试SSL连接
openssl s_client -connect localhost:443

# 检查Nginx配置中证书路径是否正确
sudo nano /etc/nginx/sites-available/tanva
```

### 问题6: CORS错误

```bash
# 检查CORS配置
cat /home/ubuntu/tanva/server/.env.production | grep CORS_ORIGIN

# 确保包含你的前端域名，例如：
# CORS_ORIGIN=https://tai.tanva.tgtai.com,https://www.tai.tanva.tgtai.com

# 重启后端
pm2 restart tanva-server
```

---

## 日常维护

### 查看系统资源使用

```bash
# 检查内存使用
free -h

# 检查磁盘使用
df -h

# 检查CPU使用
top
# 按 q 退出
```

### 查看应用日志

```bash
# 实时查看日志
pm2 logs tanva-server --lines 100

# 查看PM2管理的所有日志
pm2 logs

# 保存日志到文件用于分析
pm2 logs tanva-server > app-logs.txt
```

### 更新应用代码

```bash
cd /home/ubuntu/tanva

# 拉取最新代码
git pull origin main

# 重新构建
npm install
npm run build

# 重启应用
pm2 restart tanva-server
```

### 数据库备份

```bash
# 备份数据库
sudo -u postgres pg_dump tanva > tanva-backup-$(date +%Y%m%d-%H%M%S).sql

# 恢复数据库（如果需要）
sudo -u postgres psql tanva < tanva-backup-20231215-120000.sql
```

### 监控服务可用性

```bash
# 使用PM2监控
pm2 monit

# 持续检查健康端点
watch -n 5 'curl -s http://localhost:4000/health | jq .'
```

### 设置日志轮转

```bash
# PM2已配置日志轮转，但可以手动清理旧日志
pm2 flush

# 查看PM2配置
pm2 show tanva-server
```

### 定期更新系统

```bash
# 检查可用更新
sudo apt list --upgradable

# 安装更新（谨慎操作）
sudo apt-get update
sudo apt-get upgrade -y

# 重启ECS（如果需要）
sudo reboot
```

---

## 成功标志 ✅

部署成功的标志：

- [ ] SSH可以正常连接到ECS
- [ ] 命令 `pm2 status` 显示 tanva-server ONLINE
- [ ] `sudo systemctl status nginx` 显示 active (running)
- [ ] `curl https://tai.tanva.tgtai.com` 返回前端HTML
- [ ] 浏览器访问应用显示UI无错误
- [ ] AI聊天功能正常运作
- [ ] 日志中没有ERROR消息
- [ ] 响应时间在合理范围内（<2秒）

---

## 需要帮助？

遇到问题时的排查步骤：

1. 查看 **故障排查** 部分的相应问题
2. 检查所有日志文件
3. 验证所有环境变量和配置文件
4. 确认防火墙/安全组规则
5. 尝试重启相关服务

**保存此文档供日常参考！**
