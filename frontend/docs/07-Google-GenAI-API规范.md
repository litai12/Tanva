# Google GenAI API 规范文档

## 概述

本文档基于对 Google AI Studio 官方文档的详细研究，整理了 Google GenAI JavaScript/TypeScript SDK 的关键规范、参数配置和最佳实践。

**最后更新**：2024年12月
**SDK 版本**：`@google/genai` v1.19.0+

## 目录

1. [SDK 安装和初始化](#sdk-安装和初始化)
2. [安全设置配置](#安全设置配置)
3. [API 调用标准格式](#api-调用标准格式)
4. [图像生成参数](#图像生成参数)
5. [最佳实践和注意事项](#最佳实践和注意事项)
6. [错误处理规范](#错误处理规范)
7. [重要限制说明](#重要限制说明)

---

## SDK 安装和初始化

### 安装

```bash
npm install @google/genai
```

### 初始化

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ 
  apiKey: 'YOUR_GEMINI_API_KEY' 
});
```

---

## 安全设置配置

### 支持的安全类别

Google GenAI API 支持以下 5 个安全类别：

| 类别 | 描述 |
|------|------|
| `HARM_CATEGORY_HARASSMENT` | 骚扰内容 |
| `HARM_CATEGORY_HATE_SPEECH` | 仇恨言论 |
| `HARM_CATEGORY_SEXUALLY_EXPLICIT` | 色情内容 |
| `HARM_CATEGORY_DANGEROUS_CONTENT` | 危险内容 |
| `HARM_CATEGORY_CIVIC_INTEGRITY` | 公民诚信 |

### 支持的阈值级别

| 阈值 | 描述 |
|------|------|
| `BLOCK_NONE` | 不阻止任何内容 |
| `BLOCK_ONLY_HIGH` | 仅阻止高概率不安全内容 |
| `BLOCK_MEDIUM_AND_ABOVE` | 阻止中等及以上概率不安全内容 |
| `BLOCK_LOW_AND_ABOVE` | 阻止低等及以上概率不安全内容 |

### 标准配置示例

```typescript
const safetySettings = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
];
```

---

## API 调用标准格式

### 基本调用格式

```typescript
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash-image-preview',
  contents: promptContent,
  config: {
    safetySettings: safetySettings,
    // 其他配置参数...
  }
});
```

### 支持的模型

| 模型名称 | 适用场景 |
|----------|----------|
| `gemini-2.5-flash-image-preview` | 图像生成（实验性） |
| `gemini-2.0-flash` | 文本生成、图像分析 |
| `gemini-pro-vision` | 视觉理解 |

### 内容格式

#### 纯文本内容
```typescript
contents: 'Your text prompt here'
// 或者
contents: [{ text: 'Your text prompt here' }]
```

#### 多模态内容（文本 + 图像）
```typescript
contents: [
  { text: 'Analyze this image' },
  {
    inlineData: {
      mimeType: 'image/jpeg',
      data: base64ImageData // 不包含 data:image/jpeg;base64, 前缀
    }
  }
]
```

---

## 图像生成参数

### 关键发现

⚠️ **重要限制**：`gemini-2.5-flash-image-preview` 模型**不支持**直接的宽高比参数。

- **现状**：该模型始终生成 `1:1` 正方形图像
- **解决方案**：只能通过 prompt 文本描述暗示所需比例

### Imagen API 对比

如需宽高比控制，需使用 Imagen API（Vertex AI）：

```typescript
// Imagen API 支持的宽高比
const supportedAspectRatios = [
  '1:1',    // 正方形（默认）
  '3:4',    // 竖屏全屏
  '4:3',    // 横屏全屏
  '9:16',   // 竖屏
  '16:9'    // 宽屏
];
```

### 提示词优化

虽然无法直接设置宽高比，但可以在 prompt 中添加描述：

```typescript
// 横屏提示
const prompt = "请生成横屏宽屏格式的图像：风景照片";

// 竖屏提示  
const prompt = "请生成竖屏格式的图像：人物肖像";

// 正方形提示
const prompt = "请生成正方形格式的图像：产品展示";
```

---

## 最佳实践和注意事项

### 1. 配置参数分离

✅ **推荐**：使用新的SDK格式，将配置参数分离
```typescript
// 正确的格式
{
  model: 'gemini-2.5-flash-image-preview',
  contents: prompt,
  config: { safetySettings: [...] }
}
```

❌ **避免**：将安全设置直接放在顶层
```typescript
// 不推荐的格式
{
  model: 'gemini-2.5-flash-image-preview',
  contents: prompt,
  safetySettings: [...] // 可能不被识别
}
```

### 2. 错误处理策略

- **网络错误**：实施重试机制（建议3次）
- **安全过滤**：调整安全设置阈值
- **配额限制**：实施请求频率控制

### 3. 性能优化

- **缓存结果**：避免重复相同的请求
- **批处理**：合并多个小请求
- **超时设置**：设置合理的超时时间（推荐60秒）

### 4. 提示词优化

- **具体描述**：使用详细、具体的描述词
- **中文支持**：API对中文prompt支持良好
- **风格指定**：明确指定所需的艺术风格

---

## 错误处理规范

### 常见错误类型

| 错误类型 | 原因 | 解决方案 |
|----------|------|----------|
| `API_KEY_INVALID` | API密钥无效 | 检查密钥配置 |
| `PERMISSION_DENIED` | 权限不足 | 验证API权限 |
| `QUOTA_EXCEEDED` | 配额耗尽 | 等待配额重置或升级 |
| `LOCATION_NOT_SUPPORTED` | 地区不支持 | 使用VPN或联系支持 |
| `BILLING_REQUIRED` | 需要付费账户 | 升级到付费计划 |

### 重试策略

```typescript
const retryableErrors = [
  'network_error',
  'timeout',
  'server_error',
  'temporary_failure'
];

// 建议的重试配置
const retryConfig = {
  maxRetries: 3,
  baseDelay: 2000,  // 2秒
  maxDelay: 6000,   // 6秒
  backoffFactor: 2  // 指数退避
};
```

---

## 重要限制说明

### 1. 图像生成限制

- **分辨率**：固定为 1024x1024 像素
- **格式**：主要支持 PNG 格式
- **宽高比**：仅支持 1:1 正方形
- **水印**：所有生成图像包含 SynthID 水印

### 2. 安全过滤

- **内置保护**：核心安全机制无法完全关闭
- **地区差异**：不同地区的安全策略可能不同
- **内容审查**：生成内容会经过多层安全检查

### 3. API限制

- **请求频率**：存在每分钟请求次数限制
- **文件大小**：上传图像大小限制（通常 < 20MB）
- **并发请求**：同时请求数量有限制

### 4. 模型版本

- **实验性**：图像生成模型仍为实验性功能
- **更新频繁**：API参数和行为可能随版本更新
- **向后兼容**：不保证完全向后兼容

---

## 配置模板

### 完整的API调用模板

```typescript
import { GoogleGenAI } from '@google/genai';

class GenAIService {
  private ai: GoogleGenAI;
  
  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateImage(prompt: string) {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: `请生成图像：${prompt}`,
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
      
      return response;
    } catch (error) {
      console.error('Image generation failed:', error);
      throw error;
    }
  }

  async analyzeImage(imageData: string, prompt?: string) {
    try {
      const analysisPrompt = prompt || '请详细分析这张图片';
      
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [
          { text: analysisPrompt },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: imageData.replace(/^data:image\/[^;]+;base64,/, '')
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
      
      return response;
    } catch (error) {
      console.error('Image analysis failed:', error);
      throw error;
    }
  }
}
```

---

## 总结

本规范文档基于2024年12月的最新官方文档整理，涵盖了Google GenAI JavaScript/TypeScript SDK的关键配置和使用要点。

**关键要点**：
1. 安全设置必须通过 `config.safetySettings` 配置
2. 图像生成模型暂不支持直接宽高比控制
3. 所有安全类别设置为 `BLOCK_NONE` 可最大程度减少内容过滤
4. 实施适当的重试机制对提高API调用成功率至关重要

**建议定期检查**官方文档更新，因为Google GenAI API仍在快速发展中。

---

*文档作者：AI Assistant*  
*基于官方资料整理：Google AI Studio, ai.google.dev*