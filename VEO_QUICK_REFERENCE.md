# 🚀 Veo 3.1 快速参考卡片

## ⚡ 1 分钟快速开始

```typescript
// 1. 添加路由
import VeoTestPage from '@/pages/VeoTest';
{ path: '/veo-test', element: <VeoTestPage /> }

// 2. 访问测试页面
http://localhost:5173/veo-test

// 3. 点击"运行所有测试"
```

---

## 📊 核心代码文件

| 文件 | 位置 | 用途 |
|------|------|------|
| veoVideoService.ts | src/services/ | 核心服务类 |
| videoStore.ts | src/stores/ | 状态管理 |
| video.ts | src/types/ | 类型定义 |
| VeoVideoGenerator.tsx | src/components/ | UI 组件 |
| VeoTest.tsx | src/pages/ | **测试页面** |
| veoTestUtils.ts | src/utils/ | **测试工具** |

---

## 🧪 6 个测试用例

| # | 名称 | 耗时 | 描述 |
|---|------|------|------|
| 1 | 基础生成 | 60-120s | 4秒、720p 视频 |
| 2 | 分辨率 | 120-180s | 720p/1080p |
| 3 | 时长 | 180-240s | 4/6/8秒 |
| 4 | 扩展 | 60-120s | 视频时长扩展 |
| 5 | 状态 | 5-10s | 状态管理验证 |
| 6 | 错误 | 5-10s | 错误处理验证 |

---

## 📈 测试结果状态

| 状态 | 含义 | 操作 |
|------|------|------|
| ✅ PASS | 通过 | 继续 |
| ❌ FAIL | 失败 | 检查日志 |
| 🔴 ERROR | 错误 | 调试 |
| 🟡 PARTIAL | 部分 | 检查日志 |
| 🔵 SKIP | 跳过 | 满足前置条件 |

---

## 🔑 API Key 配置

```bash
# 1. 获取 API Key
https://ai.google.dev/

# 2. 创建 .env.local
cp .env.example .env.local

# 3. 添加 API Key
VITE_GOOGLE_GEMINI_API_KEY=your-key-here

# 4. 重启开发服务器
npm run dev
```

---

## 🛠️ 测试工具库用法

### MockData
```typescript
MockData.prompts.nature     // 自然风景提示词
MockData.requests.basic     // 基础请求
```

### TestDataGenerator
```typescript
TestDataGenerator.generateVideoRequest()  // 生成请求
TestDataGenerator.generateRandomPrompt()  // 随机提示词
```

### ResultValidator
```typescript
ResultValidator.validateVideoRequest(req)   // 验证请求
ResultValidator.validateVideoResult(res)    // 验证结果
```

### TestExecutor
```typescript
const executor = new TestExecutor();
await executor.runTest('名称', async () => true)
```

---

## 📋 检查清单

- [ ] .env.local 配置正确
- [ ] API 状态显示 ✅
- [ ] 基础生成测试 PASS
- [ ] 分辨率测试 PASS
- [ ] 时长测试 PASS
- [ ] 状态管理测试 PASS
- [ ] 错误处理测试 PASS

---

## 🔗 文件导航

```
项目目录/
├── src/pages/VeoTest.tsx              ← 测试页面
├── src/utils/veoTestUtils.ts          ← 测试工具
├── VEO_TEST_GUIDE.md                  ← 使用指南
├── VEO_TEST_SUMMARY.md                ← 完成总结
├── VEO_QUICK_START.md                 ← 快速开始
├── VEO_INTEGRATION_GUIDE.md            ← 集成文档
└── VEO_EXAMPLES.tsx                   ← 代码示例
```

---

## 🐛 常见问题

### Q: 测试页面在哪里？
A: http://localhost:5173/veo-test

### Q: 所有测试都失败了？
A: 检查 API Key 配置和网络连接

### Q: 怎么复制日志？
A: 在"日志输出"标签页点击"复制日志"

### Q: 哪里可以查看生成的视频？
A: 在"测试结果"标签页

### Q: 测试超时了怎么办？
A: 降低分辨率到 720p 或等待网络恢复

---

## 💡 3 个最常用的功能

### 1. 运行所有测试
```
点击"运行所有测试"按钮
```

### 2. 查看日志
```
打开"日志输出"标签页
```

### 3. 检查结果
```
打开"测试结果"标签页
```

---

## ⏱️ 预计时间

| 步骤 | 耗时 |
|------|------|
| 配置 API Key | 5 分钟 |
| 添加路由 | 2 分钟 |
| 访问测试页面 | 1 分钟 |
| 运行所有测试 | 8-10 分钟 |
| **总计** | **16-18 分钟** |

---

## 📞 快速链接

- 📖 [VEO_QUICK_START.md](./VEO_QUICK_START.md)
- 📚 [VEO_TEST_GUIDE.md](./VEO_TEST_GUIDE.md)
- 🎯 [VEO_INTEGRATION_GUIDE.md](./VEO_INTEGRATION_GUIDE.md)
- 💡 [VEO_EXAMPLES.tsx](./VEO_EXAMPLES.tsx)

---

**现在就开始测试吧！🎬**

访问：http://localhost:5173/veo-test
