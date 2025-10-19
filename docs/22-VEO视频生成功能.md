# VEO 3.1 视频生成功能文档

## 目录
1. [项目概述](#项目概述)
2. [快速开始](#快速开始)
3. [核心功能](#核心功能)
4. [API 配置](#api-配置)
5. [技术架构](#技术架构)
6. [功能测试](#功能测试)
7. [错误处理](#错误处理)
8. [常见问题](#常见问题)

---

## 项目概述

### 什么是 VEO 3.1？

VEO 3.1 是 Google 最新的 AI 视频生成模型，通过 Gemini 2.0 API 提供。它能够根据文本描述生成高质量的视频内容。

### 功能特性

- ✅ **AI 视频生成**：根据提示词生成 4-8 秒视频
- ✅ **多分辨率支持**：支持 720p 和 1080p
- ✅ **视频扩展**：可扩展现有视频时长
- ✅ **状态管理**：完整的视频生成状态跟踪
- ✅ **错误诊断**：详细的错误信息和调试日志

### 项目结构

```
src/
├── services/
│   └── veoVideoService.ts        # VEO 视频生成服务
├── stores/
│   └── videoStore.ts              # 视频状态管理 (Zustand)
├── components/
│   ├── VeoVideoGenerator.tsx       # 视频生成组件
│   └── flow/nodes/
│       └── TextChatNode.tsx        # 文本聊天节点
├── pages/
│   └── VeoTest.tsx                # 功能测试页面
├── types/
│   └── video.ts                   # 视频相关类型定义
└── utils/
    └── veoTestUtils.ts            # 测试工具函数
```

---

## 快速开始

### 前置条件

- Node.js 16+
- npm 或 yarn
- Google Cloud 账户
- Gemini API Key

### 设置步骤

#### 1. 获取 API Key

```bash
# 访问 Google Cloud Console
# https://console.cloud.google.com/apis/credentials

# 创建服务账户或 API 密钥
# 确保启用 Gemini 2.0 API
```

#### 2. 配置环境变量

```bash
# 项目根目录创建 .env.local
VITE_GOOGLE_GEMINI_API_KEY=your_api_key_here
```

#### 3. 启动项目

```bash
npm install
npm run dev
```

#### 4. 访问测试页面

```
http://localhost:5173/veo-test
```

### 示例代码

```typescript
import { veoVideoService } from '@/services/veoVideoService';
import type { VideoGenerateRequest } from '@/types/video';

// 生成视频
const request: VideoGenerateRequest = {
  prompt: '一只可爱的柯基犬在草地上奔跑',
  duration: 4,
  resolution: '720p'
};

const result = await veoVideoService.generateVideo(request);
if (result.success) {
  console.log('视频生成成功:', result.data);
} else {
  console.error('错误:', result.error?.message);
}
```

---

## 核心功能

### 1. 视频生成 (generateVideo)

生成 AI 视频的核心功能。

**参数**：
```typescript
interface VideoGenerateRequest {
  prompt: string;           // 视频描述（必填）
  duration?: 4 | 6 | 8;     // 时长（秒），默认 8
  resolution?: '720p' | '1080p';  // 分辨率，默认 720p
  seed?: number;            // 随机种子（可选）
}
```

**返回值**：
```typescript
interface AIServiceResponse<VideoGenerationResult> {
  success: boolean;
  data?: VideoGenerationResult;
  error?: AIError;
}

interface VideoGenerationResult {
  id: string;               // 视频 ID
  videoUrl: string;         // 视频 URL
  prompt: string;           // 原始提示词
  model: string;            // 使用的模型
  duration: number;         // 实际时长（秒）
  resolution: string;       // 分辨率
  createdAt: Date;          // 创建时间
  status: 'completed' | 'processing' | 'failed';
  metadata: {
    processingTime: number;
    [key: string]: any;
  };
}
```

**使用示例**：
```typescript
const result = await veoVideoService.generateVideo({
  prompt: '一个宁静的森林小径，阳光透过树叶洒下',
  duration: 6,
  resolution: '1080p'
});

if (result.success) {
  console.log('视频 URL:', result.data?.videoUrl);
  console.log('生成耗时:', result.data?.metadata.processingTime, 'ms');
}
```

### 2. 视频扩展 (extendVideo)

扩展现有视频的时长。

**参数**：
```typescript
interface VideoExtendRequest {
  sourceVideoId: string;         // 源视频 ID
  extensionSeconds: number;      // 扩展时长（秒）
  extensionPrompt?: string;      // 扩展提示词（可选）
}
```

**使用示例**：
```typescript
const result = await veoVideoService.extendVideo({
  sourceVideoId: 'video-123',
  extensionSeconds: 5,
  extensionPrompt: '继续这个场景...'
});
```

### 3. 状态管理 (getVideoStatus, pollVideoStatus)

获取视频生成状态。

**状态类型**：
```typescript
interface VideoGenerationStatus {
  videoId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'unknown';
  progress: number;              // 进度百分比 (0-100)
  resultUrl?: string;            // 结果 URL
  error?: string;                // 错误信息
  createdAt: Date;
  updatedAt: Date;
}
```

**轮询示例**：
```typescript
// 轮询视频状态（最多等待 10 分钟）
const success = await veoVideoService.pollVideoStatus(videoId, 600000);
if (success) {
  const status = veoVideoService.getVideoStatus(videoId);
  console.log('视频完成:', status.resultUrl);
}
```

### 4. 服务健康检查 (isAvailable)

检查 API 是否可用。

```typescript
const available = veoVideoService.isAvailable();
if (!available) {
  console.error('API 密钥未配置或初始化失败');
}
```

---

## API 配置

### Google Gemini API 设置

#### 1. 创建 Google Cloud 项目

```bash
# 访问 Google Cloud Console
https://console.cloud.google.com/

# 创建新项目
# 项目名称: Tanva VEO Video Generation
```

#### 2. 启用必要 API

- Gemini API
- Vision API (可选)
- Storage API (可选)

#### 3. 创建 API 密钥

```bash
# 导航到 APIs & Services > Credentials
# 点击 "Create Credentials" > "API Key"
# 复制密钥
```

#### 4. 配置环境变量

```bash
# .env.local
VITE_GOOGLE_GEMINI_API_KEY=your_key_here
```

### 模型配置

当前使用模型：**veo-3.1-generate-preview**

```typescript
// src/services/veoVideoService.ts
private readonly VIDEO_MODEL = 'veo-3.1-generate-preview';
```

### 配额管理

- 默认配额：100 次请求/分钟
- 需要付费升级以获得更高配额
- 查看配额：Google Cloud Console > Quotas

### 成本估算

- 基础生成：约 $0.05-0.10 / 视频
- 扩展：额外 $0.05-0.10 / 秒
- 具体价格参考：https://ai.google.dev/pricing

---

## 技术架构

### VeoVideoService 类

核心服务类，处理所有视频生成逻辑。

**主要方法**：

```typescript
class VeoVideoService {
  // 初始化 API 客户端
  private initializeClient(): void

  // 生成视频
  async generateVideo(request: VideoGenerateRequest): Promise<AIServiceResponse<VideoGenerationResult>>

  // 扩展视频
  async extendVideo(request: VideoExtendRequest): Promise<AIServiceResponse<VideoGenerationResult>>

  // 获取视频状态
  getVideoStatus(videoId: string): VideoGenerationStatus

  // 轮询视频状态
  async pollVideoStatus(videoId: string, maxDuration: number): Promise<boolean>

  // 检查服务可用性
  isAvailable(): boolean

  // 获取所有任务
  getAllVideoTasks(): Map<string, VideoTask>

  // 清理过期任务
  cleanupOldTasks(ageThreshold: number): void

  // 提取视频 URL
  private extractVideoUrl(response: any): string | null

  // 提取元数据
  private extractMetadata(response: any): Record<string, any>
}
```

### 状态管理 (Zustand Store)

使用 Zustand 管理全局视频状态。

**主要状态**：

```typescript
interface VideoState {
  videos: VideoGenerationResult[];           // 所有生成的视频
  currentGeneratingVideoId: string | null;   // 当前生成中的视频 ID
  videoStatuses: Map<string, VideoGenerationStatus>;
  progressEvents: VideoProgressEvent[];      // 进度事件日志
  error: string | null;                      // 错误信息
  isLoading: boolean;                        // 加载状态
}
```

**使用示例**：

```typescript
import { useVideoStore } from '@/stores/videoStore';

export function MyComponent() {
  const { generateVideo, videos, isLoading, error } = useVideoStore();

  const handleGenerate = async () => {
    await generateVideo({
      prompt: '...',
      duration: 4
    });
  };

  return (
    <>
      <button onClick={handleGenerate} disabled={isLoading}>
        生成视频
      </button>
      {error && <p className="error">{error}</p>}
      <ul>
        {videos.map(video => (
          <li key={video.id}>
            <video src={video.videoUrl} />
            <p>{video.prompt}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
```

### 类型定义

**video.ts 文件内容**：

```typescript
// 视频生成请求
export interface VideoGenerateRequest {
  prompt: string;
  duration?: 4 | 6 | 8;
  resolution?: '720p' | '1080p';
  seed?: number;
}

// 视频扩展请求
export interface VideoExtendRequest {
  sourceVideoId: string;
  extensionSeconds: number;
  extensionPrompt?: string;
}

// 视频生成结果
export interface VideoGenerationResult {
  id: string;
  videoUrl: string;
  prompt: string;
  model: string;
  duration: number;
  resolution: string;
  createdAt: Date;
  status: 'completed' | 'processing' | 'failed';
  metadata: Record<string, any>;
}

// 视频生成状态
export interface VideoGenerationStatus {
  videoId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'unknown';
  progress: number;
  resultUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// 进度事件
export interface VideoProgressEvent {
  videoId: string;
  phase: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  timestamp: number;
}

// 列表项
export interface VideoListItem extends VideoGenerationResult {}

// 错误类型
export interface AIError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: Date;
}

// API 响应格式
export interface AIServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: AIError;
}
```

---

## 功能测试

### 访问测试页面

启动开发服务器后，访问：

```
http://localhost:5173/veo-test
```

### 测试项目

测试页面包含 6 个测试项目：

#### 1️⃣ 基础视频生成
- 生成一个 4 秒的 720p 视频
- 验证基本功能是否工作
- 预期结果：✅ 视频生成成功

#### 2️⃣ 分辨率测试
- 测试 720p 和 1080p 分辨率
- 验证不同分辨率输出质量
- 预期结果：✅ 两个分辨率都成功

#### 3️⃣ 时长测试
- 测试 4 秒、6 秒、8 秒三种时长
- 验证时长参数是否生效
- 预期结果：✅ 所有时长都成功

#### 4️⃣ 视频扩展
- 扩展已生成的视频
- 验证扩展功能是否正常
- 预期结果：✅ 视频扩展成功

#### 5️⃣ 状态管理
- 检查视频状态追踪
- 验证进度百分比
- 预期结果：✅ 状态管理正常

#### 6️⃣ 错误处理
- 测试无效输入处理
- 验证错误消息准确性
- 预期结果：✅ 错误正确处理

### 运行测试

#### 单个测试
点击对应的"开始测试"按钮。

#### 运行所有测试
点击"运行所有测试"按钮，按顺序执行所有测试。

### 日志查看

**日志标签页**：
- 显示实时执行日志
- 颜色编码：✅ 成功（绿色）、❌ 失败（红色）、ℹ️ 信息（灰色）
- 支持日志复制

### 测试结果解读

| 状态 | 含义 | 处理方式 |
|------|------|--------|
| ✅ PASS | 测试通过 | 继续使用 |
| ❌ FAIL | 测试失败 | 检查错误信息 |
| ⚠️ PARTIAL | 部分通过 | 检查失败部分 |
| ❌ ERROR | 异常错误 | 查看日志详情 |
| ⏭️ SKIP | 测试跳过 | 先完成前置条件 |

---

## 错误处理

### 常见错误代码

#### 1. CLIENT_NOT_INITIALIZED
**原因**：API 密钥未正确配置
**解决**：
```bash
# 检查 .env.local
cat .env.local | grep VITE_GOOGLE_GEMINI_API_KEY

# 重启开发服务器
npm run dev
```

#### 2. INVALID_API_KEY
**原因**：API 密钥格式错误或过期
**解决**：
- 重新生成 API 密钥
- 验证密钥格式正确
- 检查密钥权限

#### 3. QUOTA_EXCEEDED
**原因**：API 配额已用完
**解决**：
```bash
# 升级到付费账户
# 访问 Google Cloud Console
# https://console.cloud.google.com/billing

# 查看配额使用情况
# https://console.cloud.google.com/quotas
```

#### 4. REQUEST_TIMEOUT
**原因**：请求超时（默认 5 分钟）
**解决**：
- 简化提示词内容
- 重试请求
- 检查网络连接

#### 5. MODEL_NOT_AVAILABLE
**原因**：模型不可用或不存在
**解决**：
```typescript
// 检查模型名称
console.log('使用的模型:', veoVideoService.VIDEO_MODEL);

// 确认模型在白名单中
// veo-3.1-generate-preview
```

#### 6. BILLING_REQUIRED
**原因**：需要配置付费账户
**解决**：
1. 访问 Google Cloud Console
2. 启用结算账户
3. 设置付款方式

### 错误日志示例

```typescript
// 错误时的完整诊断信息
❌ 完整的错误对象: {
  code: "QUOTA_EXCEEDED",
  message: "API usage quota exceeded",
  details: {...},
  timestamp: Date
}

❌ 视频生成失败: {
  错误: "API usage quota exceeded",
  耗时: "2341ms",
  视频ID: "abc123"
}
```

### 调试技巧

**启用详细日志**：
```javascript
// 浏览器控制台
// 所有日志都会打印到 console
// 搜索关键词：🎬、✅、❌ 等

// 导出日志
const logs = document.querySelectorAll('[data-log]');
console.save(logs, 'veo-debug.log');
```

**网络请求追踪**：
```javascript
// 打开 DevTools 的 Network 标签
// 搜索 "generateContent" 请求
// 检查请求体和响应
```

---

## 常见问题

### Q1: 如何获取 API Key？

**A**:
1. 访问 https://console.cloud.google.com/
2. 创建新项目
3. 启用 Gemini API
4. 在 Credentials 中创建 API Key
5. 复制密钥到 `.env.local`

### Q2: 为什么视频生成失败？

**A**: 检查以下几点：
- ✅ API Key 是否正确配置
- ✅ 是否已启用结算
- ✅ 提示词是否为空
- ✅ 时长参数是否为 4、6 或 8
- ✅ 分辨率是否为 720p 或 1080p

### Q3: 生成一个视频需要多长时间？

**A**:
- 平均时间：30-60 秒
- 最长时间：5 分钟（超时限制）
- 受以下因素影响：
  - 提示词复杂度
  - 服务器负载
  - 网络延迟

### Q4: 可以自定义视频长度吗？

**A**:
- 原生支持：4、6、8 秒
- 扩展方式：使用 `extendVideo` 方法
- 最大长度：理论上无限，受成本限制

### Q5: 如何保存生成的视频？

**A**:
```typescript
// 获取视频 URL
const url = video.videoUrl;

// 方式 1: 直接访问
window.open(url);

// 方式 2: 下载
const a = document.createElement('a');
a.href = url;
a.download = 'video.mp4';
a.click();

// 方式 3: 上传到存储服务
await uploadToCloudStorage(url);
```

### Q6: 支持多语言提示词吗？

**A**: 是的，支持多语言，包括：
- 中文
- 英文
- 日文
- 韩文
- 等多种语言

### Q7: 生成的视频可以重复使用吗？

**A**:
- 视频 URL 是永久的
- 可以多次使用同一 URL
- 建议备份重要视频

### Q8: 如何处理 BILLING_REQUIRED 错误？

**A**:
1. 访问 Google Cloud Console
2. 导航到 Billing
3. 创建计费账户
4. 添加付款方式
5. 等待 5-10 分钟激活

### Q9: 提示词有长度限制吗？

**A**:
- 建议长度：< 500 字符
- 最大长度：5000 字符
- 过长的提示词可能降低生成质量

### Q10: 可以使用种子参数重复生成相同视频吗？

**A**:
```typescript
// 使用相同的种子重复生成
const result1 = await generateVideo({
  prompt: '...',
  seed: 12345
});

const result2 = await generateVideo({
  prompt: '...',
  seed: 12345  // 相同的种子
});

// result1 和 result2 应该生成类似的视频
```

---

## 性能优化

### 缓存策略

```typescript
// 缓存生成结果
const videoCache = new Map<string, VideoGenerationResult>();

async function generateVideoWithCache(request: VideoGenerateRequest) {
  const cacheKey = `${request.prompt}-${request.duration}-${request.resolution}`;

  if (videoCache.has(cacheKey)) {
    return videoCache.get(cacheKey);
  }

  const result = await veoVideoService.generateVideo(request);
  if (result.success && result.data) {
    videoCache.set(cacheKey, result.data);
  }

  return result;
}
```

### 并发控制

```typescript
// 使用队列控制并发数量
class VideoQueue {
  private queue: (() => Promise<any>)[] = [];
  private running = 0;
  private maxConcurrent = 3;

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const fn = this.queue.shift();
    if (fn) {
      await fn();
    }
    this.running--;
    this.process();
  }
}
```

---

## 相关文档

- [Google GenAI API 规范](07-Google-GenAI-API规范.md)
- [Gemini API 文档](14-Gemini-API文档.md)
- [AI 系统文档](04-AI系统文档.md)
- [节点模式指南](03-节点模式指南.md)

---

## 更新记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2025-10-19 | 1.0.0 | 初始版本，完成 VEO 3.1 集成 |

---

## 支持和反馈

### 报告问题

1. 收集错误日志
2. 记录复现步骤
3. 提交 Issue

### 获取帮助

- 查看本文档常见问题部分
- 检查浏览器控制台日志
- 联系技术支持团队

---

**最后更新**：2025-10-19
**维护者**：Tanva 开发团队
