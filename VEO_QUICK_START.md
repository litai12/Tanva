# ✅ Google Veo 3.1 快速开始 Checklist

## 🎯 3 分钟快速开始

### Step 1: 获取 API Key （2 分钟）
- [ ] 访问 https://ai.google.dev/
- [ ] 点击 "Get API Key" 按钮
- [ ] 复制生成的 API Key

### Step 2: 配置环境 （1 分钟）
```bash
# 1. 复制环境变量文件
cp .env.example .env.local

# 2. 编辑 .env.local，粘贴你的 API Key
# VITE_GOOGLE_GEMINI_API_KEY=your-api-key-here
```

### Step 3: 在项目中使用 （立即可用）
```typescript
import { VeoVideoGenerator } from '@/components/VeoVideoGenerator';

export function App() {
  return <VeoVideoGenerator />;
}
```

---

## 📦 项目中新增的文件

### 必需文件
- [x] `src/services/veoVideoService.ts` - 视频生成服务
- [x] `src/types/video.ts` - 类型定义
- [x] `src/stores/videoStore.ts` - Zustand store
- [x] `src/components/VeoVideoGenerator.tsx` - UI 组件
- [x] `.env.local` - 环境变量（需要你复制和编辑）

### 文档文件（参考）
- [x] `VEO_INTEGRATION_GUIDE.md` - 完整集成指南
- [x] `VEO_EXAMPLES.tsx` - 5 个使用示例
- [x] `VEO_COMPLETION_SUMMARY.md` - 完成总结
- [x] `VEO_QUICK_START.md` - 本文件

---

## 🚀 验证安装

### 方法 1：检查服务可用性
```typescript
import { veoVideoService } from '@/services/veoVideoService';

console.log('API 可用:', veoVideoService.isAvailable());
```

### 方法 2：测试 API 连接
```typescript
import { veoVideoService } from '@/services/veoVideoService';

const connected = await veoVideoService.testConnection();
console.log('API 连接:', connected ? '✅ 成功' : '❌ 失败');
```

---

## 💻 三种使用方式

### 方式 1️⃣：使用 UI 组件（推荐）
```typescript
import { VeoVideoGenerator } from '@/components/VeoVideoGenerator';

// 就这样添加组件，完成所有功能
<VeoVideoGenerator />
```
**优点：** 开箱即用，包含完整 UI

---

### 方式 2️⃣：使用 Zustand Store
```typescript
import { useVideoStore } from '@/stores/videoStore';

const MyComponent = () => {
  const { generateVideo, videos } = useVideoStore();

  return (
    <button onClick={() => generateVideo({
      prompt: '一只猫在阳光下',
      duration: 8,
      resolution: '720p'
    })}>
      生成视频
    </button>
  );
};
```
**优点：** 灵活，可自定义 UI

---

### 方式 3️⃣：直接调用服务
```typescript
import { veoVideoService } from '@/services/veoVideoService';

// 完全控制
const result = await veoVideoService.generateVideo({
  prompt: '一只狗在公园里奔跑',
  duration: 8,
  resolution: '720p'
});

if (result.success) {
  console.log('视频 URL:', result.data?.videoUrl);
}
```
**优点：** 最细粒度的控制

---

## 🎬 生成你的第一个视频

### 代码示例
```typescript
import { VeoVideoGenerator } from '@/components/VeoVideoGenerator';

export function HomePage() {
  return (
    <div className="min-h-screen">
      <h1>Artboard - Veo 3.1 视频生成</h1>
      <VeoVideoGenerator />
    </div>
  );
}
```

### 步骤
1. 打开应用，找到 VeoVideoGenerator 组件
2. 在"视频描述"框中输入：`一个美丽的日落，海浪拍打沙滩`
3. 选择时长：`8 秒`
4. 选择分辨率：`720p`
5. 点击 `🎬 生成视频` 按钮
6. 等待 1-3 分钟
7. 视频生成完成！🎉

---

## ⚙️ 配置参数说明

### 时长选项
| 时长 | 特点 | 使用场景 |
|------|------|---------|
| **4 秒** | 快速生成 | 快速预览 |
| **6 秒** | 平衡 | 一般使用 |
| **8 秒** | 完整故事 | 推荐使用 |
| **+扩展** | 最长 148 秒 | 长视频 |

### 分辨率选项
| 分辨率 | 特点 | 使用场景 |
|--------|------|---------|
| **720p** | 快速 + 高质量 | 推荐 |
| **1080p** | 最高质量 | 最终产品 |

---

## 🐛 常见问题排查

### Q: "API Key 无效"
**A:**
1. 检查 .env.local 文件是否存在
2. API Key 是否正确复制
3. 重启开发服务器

### Q: "BILLING_REQUIRED"
**A:**
1. 访问 Google Cloud 控制台
2. 检查是否绑定了付费账户
3. 检查账户余额

### Q: "请求超时"
**A:**
1. 检查网络连接
2. 尝试生成更短的视频
3. 等待几分钟后重试

### Q: 视频生成很慢
**A:**
1. 这是正常的！通常需要 1-3 分钟
2. 降低分辨率到 720p
3. 减少视频时长

---

## 📊 文件大小和性能

| 文件 | 大小 | 说明 |
|------|------|------|
| `veoVideoService.ts` | ~18KB | 核心服务 |
| `videoStore.ts` | ~4KB | Zustand store |
| `VeoVideoGenerator.tsx` | ~8KB | UI 组件 |
| `video.ts` | ~3KB | 类型定义 |
| **总计** | ~33KB | 轻量级 |

---

## 🔐 安全建议

### API Key 安全
- ✅ 使用 `.env.local` 存储敏感信息
- ✅ 添加 `.env.local` 到 `.gitignore`
- ❌ 不要在代码中硬编码 API Key
- ❌ 不要提交 `.env.local` 到 Git

### 生产部署
```typescript
// 使用环境变量而不是默认 Key
const apiKey = process.env.VITE_GOOGLE_GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('API Key 未配置');
}
```

---

## 📈 后续优化建议

### Phase 1: 基础功能 ✅（当前）
- [x] 视频生成
- [x] 视频预览
- [x] 视频下载

### Phase 2: 增强功能
- [ ] 视频扩展（已实现，可启用）
- [ ] 批量生成
- [ ] 视频编辑

### Phase 3: 高级功能
- [ ] AI 提示词优化
- [ ] 视频模板
- [ ] 生成历史管理

---

## 🎓 学习资源

### 官方文档
- [Google AI Studio](https://ai.google.dev/)
- [Gemini API 文档](https://ai.google.dev/docs)
- [Veo 3.1 完整文档](https://ai.google.dev/gemini-api/docs/video)

### 本项目文档
- `VEO_INTEGRATION_GUIDE.md` - 详细集成指南
- `VEO_EXAMPLES.tsx` - 5 个完整示例
- `VEO_COMPLETION_SUMMARY.md` - 完成总结

---

## ✨ 功能概览

### 已实现
- ✅ 文本到视频生成
- ✅ 分辨率选择（720p/1080p）
- ✅ 时长选择（4/6/8 秒）
- ✅ 视频预览
- ✅ 视频下载
- ✅ 视频列表管理
- ✅ 错误处理
- ✅ 加载状态管理
- ✅ 视频扩展基础
- ✅ 完整的 TypeScript 支持

### 可选扩展
- 🔲 高级提示词编辑
- 🔲 批量生成管理
- 🔲 视频库存储
- 🔲 分享功能
- 🔲 协作编辑

---

## 🎉 下一步

1. **配置 API Key** → 2 分钟
2. **导入组件** → 1 分钟
3. **生成第一个视频** → 立即开始！

**现在就开始吧！🚀**

```typescript
// 一行代码即可开始
<VeoVideoGenerator />
```

---

## 📞 支持和反馈

如有问题：
1. 查看 `VEO_INTEGRATION_GUIDE.md`
2. 参考 `VEO_EXAMPLES.tsx`
3. 检查浏览器控制台的日志
4. 访问 Google AI Studio 查看 API 限制

**祝你使用愉快！🎬**
