# 🔍 API 密钥诊断报告

## 🚨 发现的问题

### 问题 1：硬编码的默认 API Key
**位置**: `src/services/veoVideoService.ts` 第 44 行

```typescript
const defaultApiKey = 'AIzaSyAWVrzl5s4JQDhrZN8iSPcxmbFmgEJTTxw';
```

**问题**:
- 这个 API Key 可能来自某个示例项目，不是你的付费账户密钥
- 如果你的环境变量 `VITE_GOOGLE_GEMINI_API_KEY` 未设置，就会使用这个默认值
- 这导致即使你有付费账户，也使用错误的密钥

### 问题 2：配额所有权混淆
即使这个默认密钥的账户是付费的，它也可能是**另一个开发人员的账户**，而不是你的。

---

## ✅ 解决方案

### 步骤 1️⃣：获取你的 API Key

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 确保选择了正确的项目
3. 左侧菜单 → **APIs & Services** → **Credentials**（凭据）
4. 选择或创建 API Key
5. 复制你的 API Key

### 步骤 2️⃣：设置环境变量

创建 `.env.local` 文件（项目根目录）:

```bash
# .env.local
VITE_GOOGLE_GEMINI_API_KEY=你的_API_Key
```

**不要提交到 Git！** 确保 `.env.local` 在 `.gitignore` 中。

### 步骤 3️⃣：移除或注释硬编码密钥

编辑 `src/services/veoVideoService.ts`:

**当前代码**（第 39-45 行）:
```typescript
private initializeClient(): void {
  const apiKey = typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
    : (typeof process !== 'undefined' ? (process as any).env?.VITE_GOOGLE_GEMINI_API_KEY : undefined);

  const defaultApiKey = 'AIzaSyAWVrzl5s4JQDhrZN8iSPcxmbFmgEJTTxw';  // ❌ 删除这行
  const finalApiKey = apiKey || defaultApiKey;  // ❌ 改为只用 apiKey
```

**改为**:
```typescript
private initializeClient(): void {
  const apiKey = typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
    : (typeof process !== 'undefined' ? (process as any).env?.VITE_GOOGLE_GEMINI_API_KEY : undefined);

  // 不再使用硬编码的默认密钥
  const finalApiKey = apiKey;

  if (!finalApiKey) {
    console.error('❌ 错误：Google Gemini API Key 未设置！');
    console.warn('请设置环境变量：VITE_GOOGLE_GEMINI_API_KEY');
    return;
  }
```

---

## 🔐 检查清单

验证你的 API Key 是否正确配置：

- [ ] 访问了 Google Cloud Console
- [ ] 选择了正确的项目（需要是付费项目）
- [ ] 复制了你的 API Key
- [ ] 创建了 `.env.local` 文件
- [ ] 设置了 `VITE_GOOGLE_GEMINI_API_KEY` 环境变量
- [ ] 确认 `.env.local` 在 `.gitignore` 中
- [ ] 重启了开发服务器（npm run dev）
- [ ] 硬刷新浏览器 (Cmd/Ctrl + Shift + R)

---

## 🧪 测试修复

1. **启动应用**
   ```bash
   npm run dev
   ```

2. **打开浏览器控制台** (F12)

3. **检查日志**
   ```
   预期输出：
   🎬 初始化 Veo 视频服务...
   🔑 使用API密钥: 你的_密钥的前10个字符...
   ✅ Veo 视频服务初始化成功
   📹 当前使用模型: Veo 3.1 Preview (veo-3.1-generate-preview)
   ```

4. **访问测试页面**
   ```
   http://localhost:5173/veo-test
   ```

5. **运行测试**
   - 点击"运行所有测试"
   - 应该能看到测试进行（不再显示配额错误）

---

## 🔍 验证 API Key 所有权

确保 API Key 确实属于你的付费账户：

1. 访问 [Google Cloud Billing](https://console.cloud.google.com/billing)
2. 检查是否显示**付费账户已启用** ✅
3. 检查**配额和使用情况**（应该显示可用配额）
4. 验证这是**你的项目**

---

## ⚠️ 常见错误

### "环境变量未读取"
- ❌ 在启动前没有 `.env.local` 文件
- ✅ 解决：创建文件后重启 `npm run dev`

### "仍然显示配额错误"
- ❌ 使用了旧的 API Key（来自免费账户）
- ✅ 解决：获取付费账户项目的新 Key

### "浏览器仍显示旧密钥"
- ❌ 没有硬刷新浏览器
- ✅ 解决：按 Cmd/Ctrl + Shift + R 进行硬刷新

---

## 📋 汇总

| 项目 | 检查 |
|------|------|
| **环境变量** | 设置了 `VITE_GOOGLE_GEMINI_API_KEY`？ |
| **API Key** | 是付费账户项目的密钥？ |
| **开发服务器** | 重启后有读取 `.env.local`？ |
| **浏览器** | 进行了硬刷新？ |
| **代码** | 删除/注释了硬编码的默认值？ |

---

**完成这些步骤后，配额问题应该会解决！** 🎉

如果还有问题，检查 Google Cloud 控制台中该项目的配额使用情况。
