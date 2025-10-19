# 🚨 Veo 3.1 API 配额超出问题排查指南

## ❌ 当前问题

**错误信息：** `The quota has been exceeded`

**含义：** 你的 Google API 配额已用完

---

## 🔧 解决方案

### 方案 1️⃣：检查 Google Cloud 配额（推荐）

#### Step 1: 访问 Google Cloud 控制台
```
https://console.cloud.google.com/
```

#### Step 2: 检查配额使用情况
1. 左侧菜单 → **APIs & Services** → **Quotas**
2. 搜索 "Generative AI"
3. 查看当前使用情况和限制

#### Step 3: 查看计费信息
1. 左侧菜单 → **Billing**
2. 检查账户余额和支付方式
3. 确认是否已启用付费

---

### 方案 2️⃣：等待配额重置

Google API 配额通常在以下时间重置：
- **每天 00:00 UTC** - 重置每日配额
- **每周一 00:00 UTC** - 重置每周配额
- **月初 00:00 UTC** - 重置每月配额

**等待时间：** 取决于你的配额周期

---

### 方案 3️⃣：升级到付费账户

如果仍在免费试用期：

1. **访问 Google Cloud Billing**
   ```
   https://console.cloud.google.com/billing
   ```

2. **添加付费方式**
   - 点击"链接计费账户"
   - 添加信用卡/借记卡
   - 启用计费

3. **申请更高配额**（可选）
   - 访问 Quotas 页面
   - 选择要增加的配额
   - 点击"Edit Quotas"
   - 申请更高限制

---

## 📊 当前日志分析

```
[18:04:09] ERROR: ❌ 警告: The quota has been exceeded.
```

**这表示：**
- ✅ API Key 配置正确
- ✅ API 连接成功
- ❌ 但已超出配额限制

---

## 💡 测试建议

### 临时解决方案
在配额重置前，可以：

1. **等待配额重置**
   - 查看你的配额周期
   - 等待自动重置

2. **使用其他 API Key**
   - 如果有多个项目，尝试其他 Key
   - 检查是否有其他项目有剩余配额

3. **联系 Google Support**
   - 访问：https://support.google.com/
   - 请求临时配额增加

---

## 🔍 检查清单

- [ ] 访问 Google Cloud 控制台
- [ ] 检查当前配额使用百分比
- [ ] 查看配额周期（每日/每周/每月）
- [ ] 检查计费账户是否已启用
- [ ] 确认支付方式是否有效
- [ ] （可选）申请更高的配额限制

---

## 📞 快速参考

| 项目 | 链接 |
|------|------|
| Google Cloud Console | https://console.cloud.google.com/ |
| API 配额管理 | https://console.cloud.google.com/quotas |
| 计费管理 | https://console.cloud.google.com/billing |
| Google Support | https://support.google.com/ |

---

## ⏰ 下一步

### 立即可做：
1. ✅ 检查配额剩余情况
2. ✅ 了解配额周期
3. ✅ 查看计费账户状态

### 配额重置后：
1. ✅ 刷新页面
2. ✅ 重新运行测试
3. ✅ 所有测试应该通过

---

## 💰 费用估算

**Veo 3.1 API 定价：**
- 按使用量计费
- 成功生成计费，失败不计费
- 价格因地区而异（通常 $0.10-0.30 / 生成）

**预计成本（运行所有测试）：**
- 6 个测试 × ~$0.15 = **~$0.90**

---

## 🎯 完整恢复流程

### 当配额重置后：

```bash
# 1. 刷新浏览器
Cmd/Ctrl + Shift + R (硬刷新)

# 2. 访问测试页面
http://localhost:5173/veo-test

# 3. 检查 API 状态
应该显示：✅ API 密钥已正确配置

# 4. 运行测试
点击"运行所有测试"

# 5. 所有测试应通过
结果应显示：PASS ✅
```

---

**配额重置后，你的测试就可以继续了！⏳**

需要帮助检查配额吗？告诉我你看到的数字！
