# 🧪 Veo 3.1 测试页面完整指南

## 📍 访问测试页面

### 方式 1：直接导航
```typescript
// 在你的路由中添加：
import VeoTestPage from '@/pages/VeoTest';

{
  path: '/veo-test',
  element: <VeoTestPage />
}

// 然后访问：
http://localhost:5173/veo-test
```

### 方式 2：从菜单添加链接
```typescript
<Link to="/veo-test" className="...">
  🧪 Veo 测试
</Link>
```

---

## 🎯 测试页面功能

### 1️⃣ API 状态检查
- **位置**：页面顶部
- **功能**：自动检测 API Key 配置
- **状态指示**：
  - ✅ 绿色 - API 配置正确
  - ❌ 红色 - API Key 缺失或无效
  - ⏳ 蓝色 - 正在检查

### 2️⃣ 快速操作
- **运行所有测试** - 依次执行所有测试用例

### 3️⃣ 单个功能测试

#### 测试 1: 基础生成
- **目标**：验证基本的视频生成功能
- **参数**：4 秒、720p
- **验证项**：是否成功生成视频

#### 测试 2: 分辨率
- **目标**：测试不同分辨率输出
- **参数**：720p 和 1080p
- **验证项**：两种分辨率是否都能生成

#### 测试 3: 时长
- **目标**：测试不同时长的视频
- **参数**：4秒、6秒、8秒
- **验证项**：三种时长是否都能生成

#### 测试 4: 视频扩展
- **目标**：验证视频扩展功能
- **前置条件**：至少有一个已生成的视频
- **验证项**：是否能成功扩展视频时长

#### 测试 5: 状态管理
- **目标**：验证视频状态管理逻辑
- **前置条件**：至少有一个已生成的视频
- **验证项**：
  - 视频状态是否正确
  - 进度百分比是否合理
  - 视频列表是否更新

#### 测试 6: 错误处理
- **目标**：验证错误处理机制
- **测试场景**：
  - 空提示词
  - 无效参数
- **验证项**：是否正确捕获和处理错误

---

## 📊 测试结果解读

### 测试状态说明

| 状态 | 含义 | 颜色 | 说明 |
|------|------|------|------|
| **PASS** | 通过 | 🟢 绿色 | 测试成功完成 |
| **FAIL** | 失败 | 🔴 红色 | 测试执行失败 |
| **ERROR** | 错误 | 🔴 红色 | 测试异常 |
| **PARTIAL** | 部分 | 🟡 黄色 | 部分用例失败 |
| **SKIP** | 跳过 | 🔵 蓝色 | 前置条件不满足 |

### 生成的视频列表

显示所有生成的视频信息：
- **视频 ID**
- **提示词**
- **时长** - 视频持续时间
- **分辨率** - 输出分辨率
- **状态** - 生成状态

---

## 🔍 日志输出

### 日志类型

```
[时间] INFO: 信息类消息（蓝色）
[时间] SUCCESS: 成功类消息（绿色）
[时间] ERROR: 错误类消息（红色）
[时间] WARN: 警告类消息（黄色）
```

### 快速复制日志
点击"复制日志"按钮可将所有日志复制到剪贴板，方便问题排查。

---

## 📋 测试工具库使用

### MockData - 测试数据

```typescript
import { MockData } from '@/utils/veoTestUtils';

// 预定义的提示词
const prompt = MockData.prompts.nature;
// 预定义的请求
const request = MockData.requests.basic;
```

### TestDataGenerator - 数据生成器

```typescript
import { TestDataGenerator } from '@/utils/veoTestUtils';

// 生成视频请求
const request = TestDataGenerator.generateVideoRequest({
  prompt: '自定义提示词'
});

// 生成随机提示词
const randomPrompt = TestDataGenerator.generateRandomPrompt();
```

### ResultValidator - 结果验证

```typescript
import { ResultValidator } from '@/utils/veoTestUtils';

// 验证请求
const validation = ResultValidator.validateVideoRequest(request);
if (!validation.valid) {
  console.error(validation.errors);
}

// 验证结果
const resultValidation = ResultValidator.validateVideoResult(result);
```

### TestExecutor - 测试执行器

```typescript
import { TestExecutor } from '@/utils/veoTestUtils';

const executor = new TestExecutor();

// 运行单个测试
const result = await executor.runTest('我的测试', async () => {
  // 测试代码
  return true; // 返回 true/false
});

// 运行多个测试
const results = await executor.runTests([
  { name: '测试1', fn: async () => true },
  { name: '测试2', fn: async () => false }
]);
```

---

## ⚙️ 常见测试场景

### 场景 1: 验证基本功能

1. 打开测试页面
2. 检查 API 状态是否为 ✅
3. 点击"运行所有测试"
4. 等待测试完成
5. 检查结果是否都是 PASS

### 场景 2: 测试特定功能

1. 打开测试页面
2. 点击特定功能的"开始测试"按钮
3. 查看日志输出
4. 检查结果

### 场景 3: 性能测试

1. 打开日志标签页
2. 查看每个测试的耗时
3. 如果耗时过长（>5分钟），检查网络连接

### 场景 4: 错误调试

1. 如果测试失败，查看日志输出
2. 检查错误信息和堆栈跟踪
3. 根据错误类型采取相应的修复措施

---

## 🐛 故障排除

### 问题 1: API 状态显示 ❌

**原因**：API Key 未配置或无效

**解决方案**：
```bash
# 1. 检查 .env.local 文件
cat .env.local

# 2. 确认 API Key 正确
VITE_GOOGLE_GEMINI_API_KEY=your-key-here

# 3. 重启开发服务器
```

### 问题 2: 测试 4（视频扩展）显示 SKIP

**原因**：没有生成的视频可扩展

**解决方案**：
1. 先运行测试 1 或 2 生成视频
2. 再运行测试 4

### 问题 3: 所有测试都失败

**原因**：可能是网络问题或 API 限制

**解决方案**：
1. 检查网络连接
2. 检查 Google Cloud 账户是否有余额
3. 检查 API 是否已启用
4. 查看日志了解具体错误

### 问题 4: 测试超时

**原因**：API 响应过慢

**解决方案**：
1. 降低分辨率到 720p
2. 减少视频时长
3. 等待网络恢复
4. 尝试重新运行

---

## 📈 测试清单

在生产之前，确保通过以下检查：

- [ ] API 状态显示 ✅
- [ ] 基础生成测试 PASS
- [ ] 分辨率测试 PASS
- [ ] 时长测试 PASS
- [ ] 状态管理测试 PASS
- [ ] 错误处理测试 PASS
- [ ] 视频可以正常预览
- [ ] 视频可以正常下载
- [ ] 没有控制台错误

---

## 💡 最佳实践

### 1. 定期运行测试
- 在部署前运行完整测试
- 修改代码后运行相关测试

### 2. 监控 API 配额
- 定期检查 Google Cloud 控制台
- 监控 API 使用量

### 3. 保存测试日志
- 失败时复制日志进行分析
- 对比不同环境的日志

### 4. 性能基准测试
- 记录首次测试的耗时
- 对比后续测试的性能变化

---

## 🔗 相关资源

- 📖 [VEO_QUICK_START.md](./VEO_QUICK_START.md)
- 📚 [VEO_INTEGRATION_GUIDE.md](./VEO_INTEGRATION_GUIDE.md)
- 💡 [VEO_EXAMPLES.tsx](./VEO_EXAMPLES.tsx)
- 🧪 [src/pages/VeoTest.tsx](./src/pages/VeoTest.tsx)
- 🛠️ [src/utils/veoTestUtils.ts](./src/utils/veoTestUtils.ts)

---

## 📞 获取帮助

如果测试遇到问题：

1. **查看日志** - 详细的错误日志通常能指明问题所在
2. **检查配置** - 确保 API Key 和环境变量正确
3. **测试 API** - 在 Google AI Studio 中直接测试 API
4. **查看文档** - 参考集成指南和示例代码

---

**祝测试顺利！🚀**
