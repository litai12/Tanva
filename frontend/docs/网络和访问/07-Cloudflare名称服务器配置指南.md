# 🔧 Cloudflare 名称服务器配置指南

## 问题说明

当你在 Cloudflare 添加域名 `tgtai.com` 时，如果看到 **"名称服务器无效"** 的错误提示，这是因为：

- ✅ 域名 `tgtai.com` 在阿里云注册/管理
- ❌ 但域名的名称服务器（DNS服务器）仍然指向阿里云
- ⚠️ Cloudflare 需要将名称服务器改为 Cloudflare 提供的服务器，才能管理该域名的 DNS

---

## 🎯 解决方案

需要将域名的名称服务器从阿里云改为 Cloudflare 提供的名称服务器。

---

## 📋 操作步骤

### 步骤 1: 在 Cloudflare 获取名称服务器地址

1. 登录 Cloudflare Dashboard: https://dash.cloudflare.com/
2. 选择你的账户（如果显示 `1547702388@qq.com`）
3. 点击域名 `tgtai.com`
4. 在左侧菜单找到 **"DNS"** 或 **"Overview"**
5. 在页面顶部或右侧，你会看到类似这样的名称服务器地址：

```
名称服务器示例：
- xxx.ns.cloudflare.com
- yyy.ns.cloudflare.com
```

**重要**: 记下这两个完整的名称服务器地址（通常是 `xxx.ns.cloudflare.com` 和 `yyy.ns.cloudflare.com` 格式）

---

### 步骤 2: 在阿里云修改名称服务器

1. **登录阿里云控制台**
   - 访问: https://dc.console.aliyun.com/
   - 使用你的阿里云账号登录

2. **进入域名管理**
   - 在控制台搜索 "域名" 或 "Domain"
   - 点击 **"域名"** → **"域名列表"**
   - 找到 `tgtai.com` 域名

3. **修改名称服务器**
   - 点击 `tgtai.com` 域名
   - 找到 **"DNS 修改"** 或 **"修改 DNS"** 或 **"名称服务器"** 选项
   - 点击 **"修改"** 或 **"编辑"**

4. **填写 Cloudflare 的名称服务器**
   - 删除现有的阿里云名称服务器（通常是 `dns1.hichina.com` 和 `dns2.hichina.com`）
   - 添加 Cloudflare 提供的两个名称服务器：
     ```
     名称服务器 1: xxx.ns.cloudflare.com
     名称服务器 2: yyy.ns.cloudflare.com
     ```
   - 点击 **"保存"** 或 **"确认"**

---

### 步骤 3: 等待 DNS 传播

修改名称服务器后，需要等待 DNS 传播生效：

- ⏱️ **通常需要**: 几分钟到 24 小时
- ✅ **一般情况**: 大多数情况下 1-2 小时内生效
- 🔍 **检查方法**: 
  - 在 Cloudflare Dashboard 中，状态会从 "名称服务器无效" 变为 "Active"
  - 或者使用在线工具检查: https://www.whatsmydns.net/

---

## ⚠️ 重要注意事项

### 1. 修改名称服务器的影响

修改名称服务器后：
- ✅ Cloudflare 将完全管理你的域名 DNS
- ✅ 你可以在 Cloudflare 添加/修改 DNS 记录（A、CNAME、MX 等）
- ⚠️ **阿里云的 DNS 记录将不再生效**
- ⚠️ 如果域名下有邮件服务或其他服务，需要在 Cloudflare 重新配置 DNS 记录

### 2. 如果域名正在使用中

如果你的域名 `tgtai.com` 或子域名（如 `tai.tanva.tgtai.com`）正在使用：

1. **先记录现有 DNS 记录**
   - 在阿里云 DNS 管理中，记录所有现有的 DNS 记录
   - 包括 A 记录、CNAME 记录、MX 记录等

2. **修改名称服务器后，在 Cloudflare 重新添加这些记录**
   - 登录 Cloudflare Dashboard
   - 进入 `tgtai.com` → **DNS** → **Records**
   - 添加所有之前存在的 DNS 记录

### 3. 子域名配置

如果你使用子域名（如 `tai.tanva.tgtai.com`）：
- 修改主域名 `tgtai.com` 的名称服务器后
- 所有子域名的 DNS 解析都会由 Cloudflare 管理
- 需要在 Cloudflare 添加相应的 DNS 记录

---

## 🔍 验证配置是否成功

### 方法 1: 在 Cloudflare Dashboard 检查

1. 登录 Cloudflare Dashboard
2. 选择 `tgtai.com` 域名
3. 查看状态：
   - ✅ **成功**: 状态显示为 "Active"（绿色）
   - ❌ **失败**: 仍然显示 "名称服务器无效"（红色）

### 方法 2: 使用命令行检查

```bash
# 检查名称服务器
dig NS tgtai.com

# 应该显示 Cloudflare 的名称服务器（xxx.ns.cloudflare.com 和 yyy.ns.cloudflare.com）
```

### 方法 3: 使用在线工具

访问: https://www.whatsmydns.net/#NS/tgtai.com

输入域名 `tgtai.com`，选择 "NS" 记录类型，查看全球 DNS 服务器是否都已更新为 Cloudflare 的名称服务器。

---

## 🚀 配置完成后

名称服务器配置成功后，你可以：

1. **使用 Cloudflare Tunnel**
   ```bash
   cloudflared tunnel route dns tanva-app tai.tanva.tgtai.com
   ```

2. **在 Cloudflare 管理 DNS 记录**
   - 添加 A 记录、CNAME 记录等
   - 配置 SSL/TLS 证书（自动）
   - 使用 Cloudflare CDN 加速

3. **使用 Cloudflare 的其他功能**
   - DDoS 防护
   - 页面规则
   - 缓存优化
   - 等等

---

## ❓ 常见问题

### Q1: 修改名称服务器后，网站无法访问？

**A**: 这是因为 DNS 记录还没有在 Cloudflare 中配置。解决方法：
1. 登录 Cloudflare Dashboard
2. 进入 DNS → Records
3. 添加之前存在的所有 DNS 记录（特别是 A 记录和 CNAME 记录）

### Q2: 需要多长时间生效？

**A**: 
- 最快: 几分钟
- 一般: 1-2 小时
- 最长: 24-48 小时（很少见）

### Q3: 可以改回阿里云的名称服务器吗？

**A**: 可以。在阿里云域名管理中，将名称服务器改回阿里云的即可。但这样 Cloudflare 的功能将无法使用。

### Q4: 修改名称服务器会影响备案吗？

**A**: 
- 修改名称服务器**不会影响**域名备案状态
- 但如果你使用 Cloudflare 的 CDN，可能需要考虑备案要求
- 建议咨询阿里云客服确认具体政策

### Q5: 免费版 Cloudflare 支持自定义域名吗？

**A**: 
- ✅ **支持**: 免费版完全支持自定义域名
- ✅ **功能**: 包括 DNS 管理、SSL 证书、CDN 等
- ⚠️ **限制**: 某些高级功能需要付费版

---

## 📞 需要帮助？

如果遇到问题：

1. **Cloudflare 支持**: https://support.cloudflare.com/
2. **阿里云支持**: 在阿里云控制台提交工单
3. **检查日志**: 查看 Cloudflare Dashboard 中的错误信息

---

## 📝 快速检查清单

- [ ] 在 Cloudflare 获取名称服务器地址
- [ ] 在阿里云修改域名的名称服务器
- [ ] 等待 DNS 传播（1-2 小时）
- [ ] 在 Cloudflare Dashboard 验证状态变为 "Active"
- [ ] 在 Cloudflare 重新添加所有 DNS 记录（如果需要）
- [ ] 测试域名访问是否正常

---

**最后更新**: 2024年

