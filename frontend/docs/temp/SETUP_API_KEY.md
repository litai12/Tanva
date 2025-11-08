# 🔧 API 密钥配置修复 - 完整指南

## 🎯 问题诊断结果

你的付费账户没有配额的原因已找到：

### 根本原因
代码中有一个**硬编码的默认 API Key** (`AIzaSyAWVrzl5s4JQDhrZN8iSPcxmbFmgEJTTxw`)。

即使你有付费账户，因为环境变量未设置，系统会自动使用这个硬编码的密钥，而这个密钥属于**某个其他账户或已过期的免费层项目**，所以会显示配额已超。

---

## ✅ 修复步骤（5 分钟完成）

### 步骤 1️⃣：获取你的真实 API Key

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. **确认选择的是你的付费项目** - 查看左上角的项目选择器
3. 点击左侧菜单 → **APIs & Services** → **Credentials**（凭据）
4. 在 "API keys" 部分找到你的 API Key（或创建新的）
5. 点击 API Key 查看完整值
6. **复制** 整个 API Key 值

**示例 API Key 格式**：
```
AIzaSyDuU3... (很长的字符串，以 AIzaSy 开头)
```

### 步骤 2️⃣：创建 `.env.local` 文件

1. 在项目根目录创建文件 `.env.local`（与 `package.json` 同级）
2. 打开该文件，添加以下内容：

```bash
# Google Gemini API 密钥（设置你的真实密钥）
VITE_GOOGLE_GEMINI_API_KEY=粘贴_你的_API_Key_在_这_里

# 示例（这是假的，不要用这个）：
# VITE_GOOGLE_GEMINI_API_KEY=AIzaSyABC123XYZ...
```

3. **粘贴你复制的 API Key**
4. 保存文件

**重要**：
- ✅ 这个文件已在 `.gitignore` 中，不会被提交到 Git
- ✅ 只有你的开发机器会有这个文件
- ❌ 不要分享这个密钥给任何人

### 步骤 3️⃣：重启开发服务器

在终端运行：

```bash
# 停止当前服务器 (Ctrl+C)
# 然后重启
npm run dev
```

或者直接杀死进程并重启：

```bash
npm run dev
```

### 步骤 4️⃣：验证修复

1. 打开浏览器控制台 (F12 或 Cmd+Option+I)
2. 查看 Console 标签页
3. 应该看到以下日志：

```
🎬 初始化 Veo 视频服务...
🔑 使用API密钥: 你的_密钥_的_前_10_个字符...
✅ Veo 视频服务初始化成功
📹 当前使用模型: Veo 3.1 Preview (veo-3.1-generate-preview)
```

### 步骤 5️⃣：测试功能

1. 访问 http://localhost:5173/veo-test
2. 点击"运行所有测试"
3. **应该开始生成视频，而不是显示配额错误** ✅

---

## 🔍 验证清单

完成以下所有项来确保配置正确：

```
□ 我已登录 Google Cloud Console
□ 我选择了我的付费项目
□ 我复制了 API Key 的完整值
□ 我创建了 .env.local 文件（项目根目录）
□ 我在 .env.local 中设置了 VITE_GOOGLE_GEMINI_API_KEY
□ 我重启了开发服务器 (npm run dev)
□ 我硬刷新了浏览器 (Cmd/Ctrl + Shift + R)
□ 浏览器控制台显示了正确的密钥前缀
□ 我尝试运行了测试
```

---

## ⚠️ 如果还有问题

### 问题：仍然显示配额错误

**可能原因**：
1. `.env.local` 文件未被读取
   - ✅ 检查文件位置（必须在项目根目录，与 `package.json` 同级）
   - ✅ 检查文件名拼写（必须是 `.env.local`，不是其他名字）

2. 开发服务器未重启
   - ✅ 完全停止开发服务器 (Ctrl+C)
   - ✅ 重新启动 (npm run dev)

3. 使用了错误的项目的 API Key
   - ✅ 验证 API Key 来自付费项目
   - ✅ 确认项目有计费账户已启用

4. API Key 无效或已被禁用
   - ✅ 在 Google Cloud Console 中验证密钥状态
   - ✅ 如果需要，创建新的 API Key

### 问题：`VITE_GOOGLE_GEMINI_API_KEY not found` 警告

**原因**：`VITE_` 前缀变量需要在构建时被读取

**解决**：
1. 确保 `.env.local` 在项目根目录
2. 完全停止并重启开发服务器
3. 看浏览器控制台输出

### 问题：浏览器刷新后密钥消失

**原因**：浏览器缓存了旧的编译文件

**解决**：
```
Windows/Linux: Ctrl + Shift + R
Mac: Cmd + Shift + R
```

---

## 🎓 环境变量原理

### 为什么需要 `.env.local`？

1. **安全性** - API Key 不会被提交到 Git
2. **灵活性** - 不同开发者可以使用自己的密钥
3. **隐私** - 每个人的密钥只在本地保存

### 代码如何读取环境变量？

在 `veoVideoService.ts` 中：

```typescript
const apiKey = import.meta.env.VITE_GOOGLE_GEMINI_API_KEY;
```

Vite 构建工具会在启动时读取 `.env.local` 并注入到代码中。

---

## 📋 快速参考

| 项 | 值 |
|---|---|
| **环境变量名** | `VITE_GOOGLE_GEMINI_API_KEY` |
| **文件位置** | 项目根目录 `.env.local` |
| **获取 API Key** | https://console.cloud.google.com/apis/credentials |
| **测试页面** | http://localhost:5173/veo-test |
| **硬刷新** | Cmd/Ctrl + Shift + R |

---

## 🚀 完成后

修复完成后，你应该能够：

1. ✅ 生成 Veo 3.1 视频而不出现配额错误
2. ✅ 运行所有 6 个测试用例
3. ✅ 看到视频生成的完整日志
4. ✅ 预览和下载生成的视频

---

**现在就开始修复吧！** 💪

有任何问题？查看浏览器控制台的错误信息，它会告诉你具体哪里出问题了。
