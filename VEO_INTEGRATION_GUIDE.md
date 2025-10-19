# Google Veo 3.1 视频生成集成指南

## 📋 目录
1. [快速开始](#快速开始)
2. [API 配置](#api-配置)
3. [文件结构](#文件结构)
4. [使用方式](#使用方式)
5. [API 参数说明](#api-参数说明)
6. [示例代码](#示例代码)
7. [常见问题](#常见问题)

---

## 🚀 快速开始

### 1. 获取 API Key

```bash
# 访问 Google AI Studio
https://ai.google.dev/

# 点击 "Get API Key" 获取免费的 API key
# 注意：Veo 3.1 是付费 API，需要绑定付费账户
```

### 2. 配置环境变量

```bash
# 复制 .env.example 到 .env.local
cp .env.example .env.local

# 编辑 .env.local，添加你的 API key
VITE_GOOGLE_GEMINI_API_KEY=your-api-key-here
```

### 3. 在项目中使用

```typescript
import { VeoVideoGenerator } from '@/components/VeoVideoGenerator';

export function App() {
  return <VeoVideoGenerator />;
}
```

---

## 🔧 API 配置

### 文件位置
- **服务层**：`src/services/veoVideoService.ts`
- **类型定义**：`src/types/video.ts`
- **状态管理**：`src/stores/videoStore.ts`
- **UI 组件**：`src/components/VeoVideoGenerator.tsx`

### 关键配置

```typescript
// veoVideoService.ts
private readonly VIDEO_MODEL = 'veo-2-exp'; // Veo 3.1 模型标识
private readonly DEFAULT_TIMEOUT = 300000;  // 5分钟超时
private readonly pollInterval = 2000;       // 2秒轮询间隔
```

---

## 📁 文件结构

```
src/
├── services/
│   └── veoVideoService.ts          # Veo 视频生成服务
├── stores/
│   └── videoStore.ts               # 视频状态管理（Zustand）
├── types/
│   └── video.ts                    # 视频相关类型定义
└── components/
    └── VeoVideoGenerator.tsx        # 视频生成 UI 组件

.env.local                           # 环境变量配置
```

---

## 💻 使用方式

### 方式 1：使用 UI 组件（推荐）

最简单的方式是使用提供的 React 组件：

```typescript
import { VeoVideoGenerator } from '@/components/VeoVideoGenerator';

export function VideoPage() {
  return (
    <div className="container mx-auto">
      <VeoVideoGenerator />
    </div>
  );
}
```

### 方式 2：使用 Zustand Store

如果你想更灵活地集成：

```typescript
import { useVideoStore } from '@/stores/videoStore';

export function CustomComponent() {
  const { generateVideo, videos, isLoading } = useVideoStore();

  const handleGenerate = async () => {
    const success = await generateVideo({
      prompt: '一只猫在公园里散步',
      duration: 8,
      resolution: '720p'
    });

    if (success) {
      console.log('视频生成成功');
    }
  };

  return (
    <div>
      <button onClick={handleGenerate} disabled={isLoading}>
        {isLoading ? '生成中...' : '生成视频'}
      </button>

      {videos.map(video => (
        <div key={video.id}>
          <video src={video.videoUrl} controls />
          <p>{video.prompt}</p>
        </div>
      ))}
    </div>
  );
}
```

### 方式 3：直接使用服务

如果你需要更细粒度的控制：

```typescript
import { veoVideoService } from '@/services/veoVideoService';

// 生成视频
const result = await veoVideoService.generateVideo({
  prompt: '一个沙滩上的日落，波浪轻轻拍打沙滩',
  duration: 8,
  resolution: '1080p'
});

if (result.success) {
  console.log('视频 URL:', result.data?.videoUrl);
  console.log('视频 ID:', result.data?.id);
} else {
  console.error('错误:', result.error?.message);
}

// 扩展视频
const extendResult = await veoVideoService.extendVideo({
  sourceVideoId: 'video-id',
  extensionSeconds: 10,
  extensionPrompt: '继续场景...'
});

// 获取视频状态
const status = veoVideoService.getVideoStatus('video-id');
console.log(`进度: ${status.progress}%`);

// 轮询视频状态
await veoVideoService.pollVideoStatus('video-id');
```

---

## 📖 API 参数说明

### VideoGenerateRequest（视频生成请求）

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | string | ✅ | 视频描述，越详细越好 |
| `duration` | 4 \| 6 \| 8 | ❌ | 视频时长（秒），默认 8 |
| `resolution` | '720p' \| '1080p' | ❌ | 分辨率，默认 720p |
| `seed` | number | ❌ | 随机种子，用于可重复生成 |
| `format` | 'mp4' \| 'webm' | ❌ | 视频格式，默认 mp4 |

### VideoGenerationResult（生成结果）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 视频 ID（UUID） |
| `videoUrl` | string | 视频 URL 或 Base64 数据 |
| `prompt` | string | 原始提示词 |
| `duration` | number | 视频时长（秒） |
| `resolution` | string | 分辨率 |
| `status` | string | 状态：pending \| processing \| completed \| failed |
| `createdAt` | Date | 创建时间 |
| `metadata` | object | 元数据（包括处理时间等） |

### VideoExtendRequest（扩展请求）

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `sourceVideoId` | string | ✅ | 源视频 ID |
| `extensionSeconds` | number | ✅ | 扩展时长（1-140 秒） |
| `extensionPrompt` | string | ❌ | 扩展提示词 |

---

## 💡 示例代码

### 示例 1：生成一个简单视频

```typescript
const { generateVideo } = useVideoStore();

const handleGenerate = async () => {
  const success = await generateVideo({
    prompt: '一只可爱的柯基犬在草地上奔跑',
    duration: 8,
    resolution: '720p'
  });

  if (success) {
    alert('视频生成成功！');
  }
};
```

### 示例 2：生成并扩展视频

```typescript
const { generateVideo, extendVideo, videos } = useVideoStore();

// 首先生成视频
const generateAndExtend = async () => {
  const success = await generateVideo({
    prompt: '日出时的海滩',
    duration: 4
  });

  if (success && videos.length > 0) {
    // 扩展视频
    const videoId = videos[0].id;
    await extendVideo(videoId, 10, '继续日出场景，海浪逐渐增大');
  }
};
```

### 示例 3：监听视频生成进度

```typescript
import { useEffect } from 'react';
import { useVideoStore } from '@/stores/videoStore';

export function VideoProgress() {
  const { videos, progressEvents } = useVideoStore();
  const currentVideo = videos[0];

  useEffect(() => {
    if (currentVideo?.status === 'processing') {
      // 定期检查状态
      const timer = setInterval(() => {
        // 更新进度
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [currentVideo?.status]);

  return (
    <div>
      {currentVideo && (
        <div>
          <p>视频 ID: {currentVideo.id}</p>
          <p>状态: {currentVideo.status}</p>
          <p>提示词: {currentVideo.prompt}</p>
        </div>
      )}
    </div>
  );
}
```

---

## ❓ 常见问题

### Q1: API Key 在哪里获取？
**A:** 访问 https://ai.google.dev/ 点击 "Get API Key"，在 Google AI Studio 中创建新的 API key。

### Q2: Veo 3.1 需要付费吗？
**A:** 是的，Veo 3.1 是付费 API。你需要在 Google Cloud 中绑定付费账户。

### Q3: 视频生成需要多长时间？
**A:** 通常 1-3 分钟，取决于视频时长和分辨率。

### Q4: 支持的最大视频时长是多少？
**A:** 单次生成最多 8 秒，但可以通过 Extend 功能扩展至 148 秒。

### Q5: 如何下载生成的视频？
**A:** 生成完成后，点击下载按钮即可下载视频。

### Q6: 如何处理 API 超时？
**A:**
- 增加超时时间：修改 `DEFAULT_TIMEOUT` 配置
- 检查网络连接
- 尝试生成更短的视频

### Q7: 如何处理错误 "BILLING_REQUIRED"？
**A:** 需要在 Google Cloud 中为 API 绑定付费账户。

### Q8: 可以重复生成相同的视频吗？
**A:** 是的，提供 `seed` 参数可以生成相同或相似的结果。

---

## 🔗 相关链接

- [Google AI Studio](https://ai.google.dev/)
- [Gemini API 文档](https://ai.google.dev/docs)
- [Veo 3.1 文档](https://ai.google.dev/gemini-api/docs/video)
- [Google Cloud 控制台](https://console.cloud.google.com/)

---

## 📝 注意事项

1. **API 配额**：请监控 Google Cloud 中的 API 使用情况
2. **提示词质量**：详细的提示词会产生更好的结果
3. **隐私考虑**：不要在提示词中包含个人隐私信息
4. **速率限制**：Gemini API 可能有速率限制，请合理使用
5. **成本估算**：每个视频生成都会产生成本，请按需使用

---

## 🤝 支持

如有问题，请：
1. 查看 Google AI Studio 的文档
2. 检查 Google Cloud 控制台的日志
3. 在浏览器控制台查看详细的调试信息
