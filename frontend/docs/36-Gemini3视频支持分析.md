# Gemini 3 视频支持分析

## 概述

Gemini 3 是 Google 推出的多模态 AI 模型，**支持视频输入和处理**。本文档分析 Gemini 3 的视频支持能力、所需格式和实现方式。

## 视频支持能力

### ✅ 支持的功能

1. **视频内容理解**：能够分析视频内容、理解场景和动作
2. **视频描述**：可以生成视频的文字描述
3. **视频问答**：能够回答关于视频内容的问题
4. **快速动作捕捉**：具备高帧率理解能力，能捕捉快速动作
5. **长时间视频处理**：支持在长时间视频中合成叙述和精确定位特定细节

### 支持的视频格式

根据官方信息，Gemini 3 支持以下主流视频格式：

| 格式 | 扩展名 | MIME Type |
|------|--------|-----------|
| MP4 | `.mp4` | `video/mp4` |
| MOV | `.mov` | `video/quicktime` |
| AVI | `.avi` | `video/x-msvideo` |
| MPEG | `.mpeg`, `.mpg` | `video/mpeg` |
| 3GP | `.3gp` | `video/3gpp` |
| FLV | `.flv` | `video/x-flv` |

**推荐格式**：`MP4` (H.264 编码) 是最兼容和推荐的格式。

## API 调用格式

### 基本格式

Gemini API 使用 `inlineData` 格式传递视频，类似于图像处理：

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: 'YOUR_API_KEY' });

// 视频分析示例
const response = await ai.models.generateContent({
  model: 'gemini-3-pro', // 或 'gemini-3-pro-image-preview'
  contents: [
    { text: '请分析这个视频的主要内容' },
    {
      inlineData: {
        mimeType: 'video/mp4',
        data: base64VideoData // Base64 编码的视频数据（不包含 data: 前缀）
      }
    }
  ],
  config: {
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
    ]
  }
});
```

### 视频数据格式要求

#### 1. Base64 编码

视频必须转换为 Base64 编码：

```typescript
// 方式1：从 File/Blob 转换
async function videoToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // 移除 data:video/mp4;base64, 前缀
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 方式2：从 URL 下载后转换
async function videoUrlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return videoToBase64(new File([blob], 'video.mp4', { type: 'video/mp4' }));
}
```

#### 2. Data URL 格式（需要处理）

如果使用 Data URL 格式，需要提取 Base64 部分：

```typescript
function extractBase64FromDataUrl(dataUrl: string): string {
  // 格式：data:video/mp4;base64,<base64-data>
  const match = dataUrl.match(/^data:video\/[\w.+-]+;base64,(.+)$/i);
  if (!match) {
    throw new Error('Invalid video data URL format');
  }
  return match[1];
}
```

#### 3. MIME Type 识别

```typescript
function getVideoMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mpeg': 'video/mpeg',
    'mpg': 'video/mpeg',
    '3gp': 'video/3gpp',
    'flv': 'video/x-flv',
  };
  return mimeTypes[extension || ''] || 'video/mp4';
}
```

## 文件大小限制

### 当前项目限制

根据项目代码分析，当前实现中有以下限制：

```typescript
// 从 gemini-pro.provider.ts 中可以看到
const MAX_BASE64_SIZE = 20 * 1024 * 1024; // 20MB (base64)
// 实际文件大小约为 15MB
```

### Gemini API 限制

- **建议视频大小**：< 100MB（实际文件）
- **Base64 编码后**：< 133MB（base64 字符串）
- **视频时长**：建议 < 2 分钟（取决于分辨率和编码）

⚠️ **注意**：视频文件通常较大，需要确保：
1. 视频压缩（降低分辨率或码率）
2. 分片处理（如果视频过长）
3. 使用合适的编码格式（H.264 通常压缩率较高）

## 实现建议

### 1. 扩展 normalizeFileInput 方法

当前项目的 `normalizeFileInput` 方法只支持图像和 PDF，需要扩展以支持视频：

```typescript
// 在 gemini-pro.provider.ts 中扩展
private normalizeFileInput(fileInput: string, context: string): { data: string; mimeType: string } {
  // ... 现有代码 ...
  
  // 添加视频支持
  if (trimmed.startsWith('data:video/')) {
    const match = trimmed.match(/^data:(video\/[\w.+-]+);base64,(.+)$/i);
    if (!match) {
      throw new Error(`Invalid video data URL format for ${context}`);
    }
    const [, mimeType, base64Data] = match;
    return {
      data: base64Data.replace(/\s+/g, ''),
      mimeType: mimeType || 'video/mp4'
    };
  }
  
  // ... 其他代码 ...
}
```

### 2. 添加视频分析接口

```typescript
// 在 ai-provider.interface.ts 中添加
export interface VideoAnalysisRequest {
  videoData: string; // Base64 或 Data URL
  prompt?: string;   // 可选的提示词
}

export interface VideoAnalysisResult {
  description: string;
  details?: {
    scenes?: string[];
    objects?: string[];
    actions?: string[];
  };
}

// 在 IAIProvider 接口中添加
analyzeVideo(request: VideoAnalysisRequest): Promise<AIProviderResponse<VideoAnalysisResult>>;
```

### 3. 视频压缩工具函数

```typescript
// 视频压缩建议（前端）
async function compressVideo(file: File, maxSizeMB: number = 15): Promise<Blob> {
  // 使用 canvas 或 WebCodecs API 压缩视频
  // 或者使用 FFmpeg.wasm 进行客户端压缩
  // 这里需要根据实际需求实现
  return file; // 占位符
}
```

## 使用示例

### 完整示例：视频分析

```typescript
import { GoogleGenAI } from '@google/genai';

class VideoAnalysisService {
  private ai: GoogleGenAI;
  
  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async analyzeVideo(videoFile: File, prompt?: string): Promise<string> {
    // 1. 转换为 Base64
    const base64 = await this.videoToBase64(videoFile);
    
    // 2. 获取 MIME Type
    const mimeType = file.type || 'video/mp4';
    
    // 3. 构建请求
    const analysisPrompt = prompt || '请详细分析这个视频的内容，包括场景、动作和主要对象';
    
    const response = await this.ai.models.generateContent({
      model: 'gemini-3-pro',
      contents: [
        { text: analysisPrompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64
          }
        }
      ],
      config: {
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
        ]
      }
    });
    
    return response.text;
  }

  private async videoToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
```

## 注意事项

### 1. 性能考虑

- **大文件处理**：视频文件通常很大，Base64 编码会增加约 33% 的大小
- **内存占用**：处理大视频时注意内存使用
- **网络传输**：考虑使用分片上传或流式处理

### 2. 错误处理

```typescript
try {
  const result = await analyzeVideo(videoFile);
} catch (error) {
  if (error.message.includes('file is too large')) {
    // 提示用户压缩视频
  } else if (error.message.includes('invalid format')) {
    // 提示用户使用支持的格式
  }
}
```

### 3. 模型选择

- `gemini-3-pro`：标准版本，支持视频分析
- `gemini-3-pro-image-preview`：可能也支持视频（需验证）

## 总结

✅ **Gemini 3 支持视频输入**

**关键要点**：
1. 支持的格式：MP4、MOV、AVI、MPEG、3GP、FLV 等
2. 数据格式：Base64 编码，使用 `inlineData` 传递
3. 文件大小：建议 < 15MB（实际文件），Base64 < 20MB
4. MIME Type：必须正确指定，如 `video/mp4`
5. API 格式：与图像处理类似，使用 `inlineData` 结构

**下一步**：
- 扩展 `normalizeFileInput` 方法支持视频格式
- 添加视频分析接口到 AI Provider
- 实现视频压缩功能以处理大文件
- 添加视频上传和处理的 UI 组件

---

*文档创建日期：2025-01-27*  
*基于：Google Gemini API 官方文档和项目代码分析*

