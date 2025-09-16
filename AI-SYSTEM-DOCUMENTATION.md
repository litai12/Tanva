# Tanva AI系统技术文档

## 概述

Tanva集成了先进的AI图像生成和处理技术，基于Google Gemini 2.5 Flash模型提供智能化的图像创作体验。本文档详细介绍AI系统的架构、功能和技术实现。

## AI功能概览

### 🎨 核心AI能力
1. **智能图像生成** - 根据文本描述创建高质量图像
2. **图像编辑与修改** - AI驱动的图像内容修改
3. **多图智能融合** - 将多张图像融合为一个整体
4. **图像内容分析** - 深度理解和描述图像内容
5. **智能对话交互** - 上下文感知的AI助手

### 🧠 智能特性
- **智能工具选择** - AI自动判断用户意图并选择合适的处理方式
- **上下文记忆** - 维护对话历史和图像处理记录
- **迭代优化** - 支持基于前一次结果的持续改进
- **流式响应** - 实时进度反馈和数据流处理

## 技术架构

### AI服务层架构
```
AI Service Layer
├── aiImageService.ts           # 核心AI服务
├── contextManager.ts           # 上下文管理
├── autoScreenshotService.ts    # 自动截图
└── imageUploadService.ts       # 图像上传处理
```

### AI状态管理
```
AI State Management
├── aiChatStore.ts              # AI对话状态
├── 消息历史管理                 # 对话记录
├── 图像状态跟踪                 # 源图像和结果
└── 生成状态控制                 # 进度和错误
```

## 核心组件详解

### 1. AI图像服务 (AIImageService)

#### 主要功能
- **图像生成** (`generateImage`)
- **图像编辑** (`editImage`) 
- **图像融合** (`blendImages`)
- **图像分析** (`analyzeImage`)
- **文本对话** (`generateTextResponse`)
- **智能工具选择** (`selectTool`)

#### 技术实现

```typescript
class AIImageService {
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash-image-preview';
  private readonly DEFAULT_TIMEOUT = 60000;

  // 流式响应处理
  async parseStreamResponse(stream: any, operationType: string): Promise<{
    imageBytes: string | null;
    textResponse: string;
  }>

  // 智能工具选择
  async selectTool(request: ToolSelectionRequest): Promise<AIServiceResponse<ToolSelectionResult>>
}
```

#### 流式响应机制
- **渐进式数据接收** - 分块接收图像和文本数据
- **实时进度更新** - 通过事件系统发送进度信息
- **数据完整性验证** - 确保接收到完整的图像数据
- **错误处理和重试** - 自动处理网络异常和重试

### 2. 智能工具选择系统

#### 两层分类架构
1. **AI意图识别** - 使用Gemini模型理解用户真实意图
2. **逻辑规则判断** - 基于图像数量和状态做最终工具选择

#### 工具选择流程
```
用户输入 → 上下文增强 → AI意图识别 → 逻辑判断 → 工具选择
           ↓
       图像状态分析
           ↓
       fallback机制
```

#### 支持的工具类型
- **generateImage** - 创建新图像
- **editImage** - 编辑单张图像
- **blendImages** - 融合多张图像
- **analyzeImage** - 分析图像内容
- **chatResponse** - 文本对话

### 3. 上下文管理系统 (ContextManager)

#### 核心功能
- **会话管理** - 创建和维护对话会话
- **操作记录** - 跟踪所有AI操作历史
- **图像缓存** - 智能缓存最近生成的图像
- **迭代支持** - 支持基于历史的持续优化

#### 技术实现
```typescript
class ContextManager {
  // 会话状态
  private currentContext: ContextSession | null = null;
  
  // 图像缓存
  private imageCache: {
    imageData: string | undefined;
    imageId: string;
    prompt: string;
  } | null = null;

  // 核心方法
  createSession(): string
  recordOperation(operation: ContextOperation): void
  buildContextPrompt(userInput: string): string
  detectIterativeIntent(input: string): boolean
}
```

### 4. AI对话界面 (AIChatDialog)

#### 界面特性
- **智能历史显示** - 根据对话类型自动显示/隐藏历史
- **多模态交互** - 支持文本、图像的混合输入输出
- **实时进度显示** - 可视化AI处理进度
- **图像预览** - 内置图像全屏预览功能

#### 图像处理模式
- **单图编辑模式** - 上传单张图像进行编辑或分析
- **多图融合模式** - 选择多张图像进行智能融合
- **自动模式切换** - 根据图像数量自动切换处理模式

## AI模型集成

### Google Gemini 2.5 Flash模型

#### 模型特性
- **多模态支持** - 同时处理文本和图像输入
- **流式响应** - 支持实时数据流
- **高质量输出** - 专业级图像生成质量
- **上下文理解** - 强大的语义理解能力

#### API配置
```typescript
// 模型配置
model: 'gemini-2.5-flash-image-preview'  // 图像生成
model: 'gemini-2.0-flash'               // 文本处理和工具选择

// 安全设置
safetySettings: [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  // ... 其他安全类别
]
```

#### 数据格式
```typescript
// 输入格式
contents: [
  { text: prompt },                    // 文本提示
  {
    inlineData: {
      mimeType: 'image/jpeg',
      data: base64ImageData             // Base64图像数据
    }
  }
]

// 输出格式
response: {
  imageBytes: string | null,           // Base64图像数据
  textResponse: string                 // 文本回复
}
```

## 性能优化

### 1. 流式处理优化
- **分块数据处理** - 避免大数据包阻塞
- **渐进式渲染** - 实时显示处理进度
- **内存管理** - 及时释放大图像数据

### 2. 缓存策略
- **图像智能缓存** - 缓存最近生成的图像用于迭代
- **上下文缓存** - 避免重复构建上下文信息
- **API响应缓存** - 相同请求的结果缓存

### 3. 错误处理
- **重试机制** - 自动重试失败的API调用
- **降级处理** - AI失败时使用规则引擎
- **安全过滤** - 防止敏感数据泄漏到日志

### 4. 数据验证
```typescript
// 图像数据验证
private validateImageData(imageData: string, operationType: string): {
  isValid: boolean;
  reason?: string;
  severity?: 'warning' | 'error';
  info?: string;
}

// Base64格式验证
const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

// 图像格式检测
const headerChecks = [
  { format: 'PNG', header: 'iVBORw0KGgo' },
  { format: 'JPEG', header: '/9j/' },
  // ...
];
```

## 智能排版系统

### 画布集成
AI生成的图像自动添加到画布，支持智能排版：

- **生成模式** - 图像添加到画布中央
- **编辑模式** - 在原图像下方添加编辑结果
- **融合模式** - 在第一张源图像下方添加融合结果

### 自动排版算法
```typescript
// 智能排版事件
window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
  detail: {
    imageData: imageDataUrl,
    fileName: fileName,
    operationType: 'generate' | 'edit' | 'blend',
    sourceImageId: sourceImageId,         // 源图像ID
    sourceImages: sourceImageIds          // 多源图像IDs
  }
}));
```

## 安全与隐私

### 数据安全
- **本地处理** - 图像数据仅在必要时传输
- **API密钥保护** - 环境变量管理API密钥
- **日志过滤** - 防止敏感数据进入日志

### 错误处理安全
```typescript
// 安全错误处理
private sanitizeErrorForLogging(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    
    // 检查是否包含Base64数据
    if (message && message.length > 1000 && message.includes('iVBORw0KGgo')) {
      console.warn('⚠️ 检测到Base64图像数据在错误消息中，已过滤');
      return '图像处理失败（错误详情已过滤）';
    }
    
    return message;
  }
  
  return String(error);
}
```

## 成本管理

### API调用优化
- **智能缓存** - 减少重复API调用
- **错误重试限制** - 避免过度重试
- **成本估算** - 基于token使用量估算成本

```typescript
// 成本估算
estimateCost(imageCount: number): number {
  const tokensPerImage = 1290;
  const costPer1MTokens = 30; // $30 per 1M tokens
  return (imageCount * tokensPerImage * costPer1MTokens) / 1000000;
}
```

## 开发指南

### AI功能开发
1. **扩展新的AI功能** - 在`aiImageService.ts`中添加新方法
2. **状态管理** - 在`aiChatStore.ts`中添加相应状态
3. **UI集成** - 在`AIChatDialog.tsx`中添加界面支持

### 测试和调试
```typescript
// API连接测试
async testConnection(): Promise<boolean> {
  try {
    const result = await this.genAI!.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'Hello, this is a connection test.'
    });
    return !!result.text;
  } catch (error) {
    return false;
  }
}
```

### 配置管理
```env
# 环境变量配置
VITE_GOOGLE_GEMINI_API_KEY=your_api_key_here
```

## 故障排除

### 常见问题

1. **API密钥问题**
   - 检查环境变量配置
   - 验证API密钥权限

2. **图像生成失败**
   - 检查网络连接
   - 验证提示词内容
   - 查看API配额

3. **流式响应中断**
   - 检查网络稳定性
   - 调整超时设置
   - 启用重试机制

### 调试工具
- **详细日志** - 完整的API调用日志
- **性能监控** - 处理时间和内存使用
- **错误追踪** - 结构化错误信息

## 未来发展

### 技术路线
- **多模型支持** - 集成更多AI模型
- **本地AI处理** - 支持本地AI模型推理
- **实时协作** - 多用户实时AI创作
- **API扩展** - 支持更多AI服务提供商

### 功能扩展
- **AI辅助绘图** - AI协助矢量图形创建
- **风格迁移** - 艺术风格自动转换
- **智能布局** - AI驱动的页面布局优化
- **创意建议** - 基于内容的创意推荐

---

*最后更新：2025-01-15*