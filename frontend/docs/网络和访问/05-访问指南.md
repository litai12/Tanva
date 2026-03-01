# 🌐 应用访问全指南

## 当前状态

你的应用现在支持三种访问方式:

```
┌──────────────────────────────────────────────────────────┐
│                   你的开发应用                            │
│   (Tanva AI Gateway - 支持多模型AI图像生成和编辑)        │
└──────────────────────────────────────────────────────────┘
        │                    │                    │
        ├──────────────────┬─┴────────────────┬──┤
        │                  │                  │  │
    本地访问           本地网络            全球网络
    (你的电脑)        (你的局域网)        (互联网)
        │                  │                  │
        ▼                  ▼                  ▼
   ✅ 就绪              ✅ 就绪             🔄 选择方案
   
http://localhost:5173   192.168.2.115:5173   Cloudflare
http://localhost:4000   192.168.2.115:4000   OR Aliyun
                                              OR 其他云
```

---

## 📍 访问地址速查

### 1️⃣ 本地访问 (仅在你的电脑)

```
前端:   http://localhost:5173
后端:   http://localhost:4000
API:    http://localhost:4000/api/public/ai/*
```

**启动方式**:
```bash
# 终端1: 后端
cd server && npm run dev

# 终端2: 前端
npm run dev
```

---

### 2️⃣ 本地网络访问 (同局域网的其他PC)

```
前端:   http://192.168.2.115:5173
后端:   http://192.168.2.115:4000
API:    http://192.168.2.115:4000/api/public/ai/*
```

**在其他PC上**:
```bash
# 在浏览器打开
http://192.168.2.115:5173

# 或直接调用API
curl http://192.168.2.115:4000/api/public/ai/providers
```

✅ **已配置完成** - 见 `LOCAL_NETWORK_SETUP.md`

---

### 3️⃣ 全球网络访问 (互联网上的任何人)

选择你想要的方案:

#### 方案A: Cloudflare Tunnel (推荐快速验证)

```
✅ 成本:    完全免费
⚡ 速度:    中等 (取决于Cloudflare节点)
⏱️  时间:    5分钟部署
🔗 地址:    https://随机.trycloudflare.com (免费版)
            https://你的域名.com ($20/年付费版)

快速开始:
bash setup-cloudflare-tunnel.sh
```

✅ **可立即部署** - 见 `OUTSIDE_LAN_ACCESS_OPTIONS.md`

---

#### 方案B: Aliyun ECS (推荐长期生产)

```
✅ 成本:    ¥50-100/月
⚡ 速度:    快速 (国内最优)
⏱️  时间:    2-4小时部署
🔗 地址:    https://tai.tanva.tgtai.com (已有)

步骤:
1. 准备ECS服务器
2. 按照 ALIYUN_DEPLOYMENT_GUIDE.md 部署
3. 配置DNS
4. 访问https://tai.tanva.tgtai.com
```

✅ **详细指南** - 见 `ALIYUN_DEPLOYMENT_GUIDE.md`

---

#### 方案C: 其他云服务

```
选项                成本        难度      国内速度
──────────────────────────────────────────────
DigitalOcean      $5-12/月    ⭐⭐     中
Namecheap VPS     $1.44/月    ⭐⭐⭐   慢
腾讯云CVM         ¥50-100/月  ⭐⭐⭐   快
AWS               $5-12/月    ⭐⭐⭐⭐ 中
Heroku            $7+/月      ⭐       中 (仅前端)
```

✅ **详细对比** - 见 `OUTSIDE_LAN_DECISION_GUIDE.md`

---

## 🎯 我应该选哪个方案?

**如果你...**

| 场景 | 建议 | 时间 | 成本 |
|------|------|------|------|
| 想立即验证可行性 | Cloudflare Tunnel | 5分钟 | ¥0 |
| 要给客户演示 | Cloudflare Tunnel | 5分钟 | ¥0 |
| 需要正式上线 | Aliyun | 2-4h | ¥50+/月 |
| 需要长期稳定 | Aliyun | 2-4h | ¥50+/月 |
| 想学习部署 | Aliyun (深度) 或 DigitalOcean (简单) | 1-4h | ¥$ |
| 想最低成本 | Cloudflare免费版 | 5分钟 | ¥0 |
| 需要自定义域名 | Cloudflare付费($20/yr) 或 Aliyun | 5分钟或4h | $20/yr或¥50+/月 |

---

## 📋 快速开始清单

### 今天可做 (5分钟)

```bash
# 1. 验证本地网络访问
curl http://192.168.2.115:5173

# 2. 部署到Cloudflare (可选)
bash setup-cloudflare-tunnel.sh

# 3. 分享URL给任何人
# → 他们可以从任何地方访问你的应用！
```

### 本周可做 (2-4小时)

```bash
# 按照 ALIYUN_DEPLOYMENT_GUIDE.md
# 1. 准备ECS服务器
# 2. SSH连接服务器
# 3. 安装Node.js和PostgreSQL
# 4. 部署应用
# 5. 配置Nginx和SSL
# 6. 配置DNS
# → https://tai.tanva.tgtai.com 可访问！
```

---

## 📚 相关文档

| 文档 | 说明 |
|------|------|
| `LOCAL_NETWORK_SETUP.md` | 本地网络配置详解 (当前已部署) |
| `NETWORK_QUICK_START.md` | 本地网络快速参考 |
| `OUTSIDE_LAN_ACCESS_OPTIONS.md` | 外网访问方案详解 |
| `OUTSIDE_LAN_DECISION_GUIDE.md` | 选择决策指南 |
| `ALIYUN_DEPLOYMENT_GUIDE.md` | Aliyun完整部署指南 |
| `setup-cloudflare-tunnel.sh` | Cloudflare快速部署脚本 |
| `COMPLETE_ACCESS_GUIDE.md` | 全面总结指南 |
| `EDIT_IMAGE_GUIDE.md` | AI图像编辑API文档 |

---

## 🚀 推荐流程

```
Day 1: 快速验证
├─ 使用Cloudflare Tunnel
├─ 5分钟内获得公网URL
└─ 分享给客户看效果 ✅

Day 2-3: 准备生产环境
├─ 部署到Aliyun
├─ 2-4小时配置完成
└─ 启用HTTPS和自动备份 ✅

Day 4+: 维护和优化
├─ 监控应用状态
├─ 定期备份数据
└─ 根据需求扩展 ✅
```

---

## 🎉 你现在可以做什么

✅ 在本地电脑完整使用应用
✅ 在局域网内分享给同事
✅ 5分钟内获得全球公网URL (Cloudflare)
✅ 2-4小时内部署到生产环境 (Aliyun)
✅ 支持多种AI模型 (Gemini, OpenAI, Claude等 - 已架构)
✅ AI生成图像、编辑图像、分析图像

---

## 💬 需要帮助?

### 本地网络问题
→ 见 `LOCAL_NETWORK_SETUP.md` 的故障排查

### 选择部署方案
→ 见 `OUTSIDE_LAN_DECISION_GUIDE.md`

### Cloudflare部署
→ 运行 `bash setup-cloudflare-tunnel.sh`

### Aliyun部署
→ 按照 `ALIYUN_DEPLOYMENT_GUIDE.md` 逐步操作

### API调用问题
→ 见 `EDIT_IMAGE_GUIDE.md`

---

## 📞 技术支持链接

- Cloudflare文档: https://developers.cloudflare.com/tunnels
- Aliyun ECS: https://www.aliyun.com/product/ecs
- Aliyun文档: https://help.aliyun.com
- Node.js: https://nodejs.org
- NestJS: https://nestjs.com
- Gemini API: https://ai.google.dev

---

**最后更新**: 2025-10-23
**状态**: ✅ 本地网络已就绪，外网访问有多种方案可选
