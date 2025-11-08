# 🎨 编辑图像功能 - 完整调用指南

## 📋 功能概述

编辑图像是指修改现有图像的功能,通过 AI 模型(Gemini)对图像进行智能编辑。

### 核心流程

```
用户输入 → 前端API调用 → 后端路由 → Gemini处理 → 返回编辑后的图像
```

---

## 🔗 API 调用方式

### 方式1️⃣: 前端调用 (带身份认证)

#### 调用位置
```typescript
// src/services/aiImageService.ts
async editImage(request: AIImageEditRequest)
```

#### 前端代码示例

```typescript
import { aiImageService } from '@/services/aiImageService';

// 方式1: 使用已有的图像 (Base64)
const result = await aiImageService.editImage({
  prompt: "给这只猫加上帽子",
  sourceImage: "data:image/png;base64,iVBORw0KGgo...", // Base64 格式
  model: "gemini-2.5-flash-image", // 可选
  aspectRatio: "1:1", // 可选: 1:1, 2:3, 3:2, 等
  imageOnly: false // 可选: true 只返回图像,false 返回图像+文本
});

if (result.success) {
  console.log("✅ 图像编辑成功!");
  console.log("编辑后的图像:", result.data.imageData); // Base64
  console.log("AI说明:", result.data.textResponse);
} else {
  console.error("❌ 编辑失败:", result.error.message);
}
```

#### 请求参数详解

```typescript
interface AIImageEditRequest {
  // ✅ 必填
  prompt: string;              // 编辑指令,例:"给猫加上眼镜"
  sourceImage: string;         // 源图像 (Base64 或 data URL)

  // ⚙️ 可选
  model?: string;              // AI模型,默认: gemini-2.5-flash-image
  aspectRatio?: string;        // 长宽比: 1:1 | 2:3 | 3:2 | 3:4 | 4:3 | 等
  outputFormat?: string;       // 输出格式: jpeg | png | webp
  imageOnly?: boolean;         // 仅返回图像(不返回文字说明)
}
```

#### 响应格式

```typescript
interface AIServiceResponse<T> {
  success: boolean;
  data?: {
    id: string;                // 唯一ID
    imageData?: string;        // Base64 编码的图像数据
    textResponse: string;      // AI 的文字说明
    hasImage: boolean;         // 是否包含图像
    prompt: string;            // 原始提示词
    model: string;             // 使用的模型
    createdAt: Date;           // 创建时间
    metadata: {
      outputFormat: string;
      processingTime: number;  // 处理耗时 (毫秒)
    };
  };
  error?: {
    code: string;
    message: string;
    timestamp: Date;
  };
}
```

---

### 方式2️⃣: 公开 API 调用 (无需认证)

#### 调用地址
```
POST http://localhost:4000/api/public/ai/edit
```

#### cURL 示例

```bash
curl -X POST http://localhost:4000/api/public/ai/edit \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "给这只猫加上帽子和眼镜",
    "sourceImage": "data:image/png;base64,iVBORw0KGgo...",
    "model": "gemini-2.5-flash-image",
    "aspectRatio": "1:1",
    "imageOnly": false
  }'
```

#### JavaScript/Fetch 示例

```javascript
const response = await fetch('http://localhost:4000/api/public/ai/edit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt: "给这只猫加上帽子",
    sourceImage: "data:image/png;base64,iVBORw0KGgo...",
    model: "gemini-2.5-flash-image",
    aspectRatio: "1:1"
  })
});

const result = await response.json();
console.log(result);
```

#### Python 示例

```python
import requests
import json

url = "http://localhost:4000/api/public/ai/edit"

payload = {
    "prompt": "给这只猫加上帽子",
    "sourceImage": "data:image/png;base64,iVBORw0KGgo...",
    "model": "gemini-2.5-flash-image",
    "aspectRatio": "1:1"
}

response = requests.post(url, json=payload)
result = response.json()

if result.get('success'):
    print("✅ 编辑成功!")
    print("图像:", result['data']['imageData'][:100] + "...")
    print("说明:", result['data']['textResponse'])
else:
    print("❌ 编辑失败:", result['error']['message'])
```

---

## 🔄 工作流程详解

### 后端处理流程 (3层架构)

```
1️⃣ 路由层 (Controller)
   ↓
   AiPublicController.editImage(request)
   ├─ 验证请求参数
   └─ 调用服务层

2️⃣ 服务层 (Service)
   ↓
   AiPublicService.editImage(request)
   ├─ 调用工厂获取提供商
   └─ 调用提供商层

3️⃣ 提供商层 (Provider)
   ↓
   GeminiProvider.editImage(request)
   ├─ 规范化图像输入
   │  ├─ 转换 Base64/Data URL
   │  └─ 识别 MIME 类型
   ├─ 构建 API 请求
   │  ├─ 设置安全参数
   │  ├─ 配置长宽比
   │  └─ 设置返回格式
   ├─ 调用 Gemini 流式 API
   │  └─ generateContentStream
   ├─ 解析流式响应
   │  ├─ 收集文本块
   │  └─ 合并图像数据块
   └─ 返回结果
```

### 代码执行路径

```
前端调用
  ↓
aiImageService.editImage(request)
  │
  ├─ 1. 构建请求
  │  {
  │    prompt: "给猫加帽子",
  │    sourceImage: "data:image/png;base64,...",
  │    model: "gemini-2.5-flash-image"
  │  }
  │
  ├─ 2. 发送 POST 请求
  │  /api/ai/edit-image (有认证)
  │  或
  │  /api/public/ai/edit (无认证)
  │
  ├─ 3. 后端 AiPublicController
  │  └─ editImage(request)
  │
  ├─ 4. 后端 AiPublicService
  │  └─ editImage(request)
  │
  ├─ 5. 后端 AIProviderFactory
  │  └─ getProvider('gemini-2.5-flash-image')
  │
  ├─ 6. 后端 GeminiProvider.editImage()
  │  ├─ normalizeImageInput(sourceImage)
  │  │  ├─ 检查是否为 data:image/ 格式
  │  │  ├─ 提取 MIME 类型
  │  │  ├─ 提取 Base64 数据
  │  │  └─ 返回 { data, mimeType }
  │  │
  │  ├─ withTimeout() - 120 秒超时
  │  │
  │  ├─ client.models.generateContentStream()
  │  │  ├─ model: "gemini-2.5-flash-image"
  │  │  ├─ contents: [
  │  │  │    { text: "给猫加帽子" },
  │  │  │    { inlineData: {
  │  │  │        mimeType: "image/png",
  │  │  │        data: "iVBORw0KGgo..."
  │  │  │      }}
  │  │  │  ]
  │  │  └─ config: { 安全设置, 长宽比, 返回格式 }
  │  │
  │  └─ parseStreamResponse(stream)
  │     ├─ 遍历流式数据块
  │     ├─ 收集文本部分 (part.text)
  │     ├─ 收集图像数据块 (part.inlineData.data)
  │     ├─ 合并图像块为完整 Base64
  │     └─ 返回 { imageBytes, textResponse }
  │
  ├─ 7. 返回响应
  │  {
  │    success: true,
  │    data: {
  │      imageData: "iVBORw0KGgo...",  // 编辑后的图像
  │      textResponse: "我已经给猫加上了...",
  │      hasImage: true
  │    }
  │  }
  │
  └─ 前端渲染编辑后的图像
```

---

## 🖼️ 图像数据格式详解

### 支持的输入格式

#### 1️⃣ Base64 Data URL (推荐)

```javascript
const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...";

await aiImageService.editImage({
  prompt: "编辑指令",
  sourceImage: dataUrl  // ✅ 直接使用
});
```

#### 2️⃣ 纯 Base64 字符串

```javascript
const base64 = "iVBORw0KGgoAAAANSUhEUg...";

await aiImageService.editImage({
  prompt: "编辑指令",
  sourceImage: base64  // ✅ 自动识别
});
```

#### 3️⃣ 从文件转换

```javascript
// 读取本地文件
const file = inputElement.files[0];
const reader = new FileReader();

reader.onload = async (e) => {
  const dataUrl = e.target.result; // "data:image/png;base64,..."

  const result = await aiImageService.editImage({
    prompt: "编辑指令",
    sourceImage: dataUrl
  });
};

reader.readAsDataURL(file);
```

#### 4️⃣ 从 Canvas 转换

```javascript
const canvas = document.getElementById('myCanvas');
const dataUrl = canvas.toDataURL('image/png');

await aiImageService.editImage({
  prompt: "编辑指令",
  sourceImage: dataUrl
});
```

### 输出格式

所有编辑后的图像均返回 **Base64 编码格式**:

```javascript
// 在浏览器中显示
const img = new Image();
img.src = result.data.imageData;  // "data:image/png;base64,..."
document.body.appendChild(img);

// 保存为文件
const link = document.createElement('a');
link.href = result.data.imageData;
link.download = 'edited-image.png';
link.click();
```

---

## ⚙️ 参数详解

### prompt (编辑指令)

```javascript
// ✅ 好的例子
"给这只猫加上太阳镜"
"把红色的车改成蓝色"
"添加魔法光效到背景"
"让人物微笑"

// ❌ 不好的例子
"编辑"  // 太模糊
"改变"  // 不具体
```

### sourceImage (源图像)

```javascript
// 支持的格式
"data:image/png;base64,..."      // ✅
"data:image/jpeg;base64,..."     // ✅
"iVBORw0KGgoAAAANSUhEUg..."     // ✅ (自动检测格式)

// 不支持
"https://example.com/image.png"  // ❌ (需转换为 Base64)
```

### aspectRatio (长宽比)

```javascript
{
  aspectRatio: "1:1"      // 正方形 (默认)
}
```

可用值:
- `1:1` - 正方形 (1:1)
- `2:3` - 竖长 (2:3)
- `3:2` - 横宽 (3:2)
- `3:4` - 竖长 (3:4)
- `4:3` - 横宽 (4:3)
- `4:5` - 竖长 (4:5)
- `5:4` - 横宽 (5:4)
- `9:16` - 超竖长 (9:16)
- `16:9` - 超横宽 (16:9)
- `21:9` - 电影宽屏 (21:9)

### imageOnly (仅图像模式)

```javascript
{
  imageOnly: false  // (默认) 返回图像 + 文字说明
  imageOnly: true   // 仅返回图像,不返回文字说明
}
```

---

## 🔐 关键技术细节

### 图像规范化 (normalizeImageInput)

```typescript
function normalizeImageInput(imageInput: string, context: string) {
  // 1. 检查是否为空
  if (!imageInput || imageInput.trim().length === 0) {
    throw new Error(`${context} image payload is empty`);
  }

  // 2. 处理 Data URL 格式
  if (imageInput.startsWith('data:image/')) {
    const match = imageInput.match(/^data:(image\/[\w.+-]+);base64,(.+)$/i);
    if (!match) {
      throw new Error(`Invalid data URL format for ${context} image`);
    }
    const [, mimeType, base64Data] = match;
    return {
      data: base64Data.replace(/\s+/g, ''),  // 移除空白字符
      mimeType: mimeType || 'image/png'
    };
  }

  // 3. 处理纯 Base64 格式
  const sanitized = imageInput.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sanitized)) {
    throw new Error(`Unsupported ${context} image format`);
  }

  // 4. 自动检测 MIME 类型
  return {
    data: sanitized,
    mimeType: inferMimeTypeFromBase64(sanitized)
  };
}
```

### MIME 类型检测

```typescript
function inferMimeTypeFromBase64(data: string): string {
  const headerChecks = [
    { prefix: 'iVBORw0KGgo', mime: 'image/png' },     // PNG
    { prefix: '/9j/', mime: 'image/jpeg' },            // JPEG
    { prefix: 'R0lGOD', mime: 'image/gif' },           // GIF
    { prefix: 'UklGR', mime: 'image/webp' },           // WebP
    { prefix: 'Qk', mime: 'image/bmp' }                // BMP
  ];

  for (const check of headerChecks) {
    if (data.startsWith(check.prefix)) {
      return check.mime;
    }
  }

  return 'image/png';  // 默认为 PNG
}
```

### 流式响应解析

```typescript
async function parseStreamResponse(stream: any) {
  let textResponse = '';
  let imageDataChunks: string[] = [];

  // 遍历流式数据块
  for await (const chunk of stream) {
    // chunk 结构:
    // {
    //   candidates: [{
    //     content: {
    //       parts: [
    //         { text: "..." },
    //         { inlineData: { mimeType: "image/png", data: "..." } }
    //       ]
    //     }
    //   }]
    // }

    const parts = chunk.candidates[0].content.parts;

    for (const part of parts) {
      // 收集文本
      if (part.text) {
        textResponse += part.text;
      }

      // 收集图像数据块
      if (part.inlineData?.data) {
        imageDataChunks.push(part.inlineData.data);
      }
    }
  }

  // 合并图像数据块
  const imageBytes = imageDataChunks.join('').replace(/\s+/g, '');

  return {
    imageBytes: imageBytes || null,
    textResponse
  };
}
```

---

## 📊 请求/响应示例

### ✅ 成功案例

#### 请求
```json
{
  "prompt": "给这只猫加上圣诞帽和围巾",
  "sourceImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEA...",
  "aspectRatio": "1:1",
  "imageOnly": false
}
```

#### 响应
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "imageData": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "textResponse": "我已经给猫咪加上了一顶漂亮的圣诞帽和温暖的围巾。图像已编辑完成！",
    "hasImage": true,
    "prompt": "给这只猫加上圣诞帽和围巾",
    "model": "gemini-2.5-flash-image",
    "createdAt": "2025-10-23T12:00:00Z",
    "metadata": {
      "outputFormat": "png",
      "processingTime": 3500
    }
  }
}
```

### ❌ 失败案例

#### 请求 (缺少 sourceImage)
```json
{
  "prompt": "给猫加帽子"
}
```

#### 响应
```json
{
  "success": false,
  "error": {
    "code": "EDIT_FAILED",
    "message": "edit image payload is empty",
    "timestamp": "2025-10-23T12:00:00Z"
  }
}
```

---

## 🎯 常见用例

### 用例1: 从上传的文件编辑图像

```typescript
async function editUploadedImage() {
  // 1. 获取文件
  const file = document.getElementById('imageInput').files[0];

  // 2. 转换为 Base64
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });

  // 3. 编辑图像
  const result = await aiImageService.editImage({
    prompt: "给人物加上墨镜和帽子",
    sourceImage: dataUrl,
    aspectRatio: "1:1"
  });

  // 4. 显示结果
  if (result.success) {
    const img = new Image();
    img.src = result.data.imageData;
    document.getElementById('output').appendChild(img);
  }
}
```

### 用例2: 从 Canvas 编辑

```typescript
async function editCanvasImage() {
  const canvas = document.getElementById('canvas');
  const dataUrl = canvas.toDataURL('image/png');

  const result = await aiImageService.editImage({
    prompt: "添加艺术效果和炫彩边框",
    sourceImage: dataUrl,
    imageOnly: true  // 只要图像,不要说明
  });

  if (result.success) {
    // 更新 canvas
    const img = new Image();
    img.src = result.data.imageData;
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    };
  }
}
```

### 用例3: 批量编辑

```typescript
async function batchEditImages(images: string[], editPrompt: string) {
  const results = [];

  for (const imageBase64 of images) {
    const result = await aiImageService.editImage({
      prompt: editPrompt,
      sourceImage: imageBase64,
      aspect Ratio: "16:9"
    });

    results.push(result);
  }

  return results;
}
```

---

## ⚡ 性能指标

### 典型性能
- **处理时间**: 3-8 秒
- **超时时间**: 120 秒
- **重试次数**: 最多 3 次

### 影响因素
- 图像大小
- 编辑复杂度
- 服务器负载
- 网络延迟

---

## 🐛 常见问题

### Q1: 图像数据太大怎么办?

```javascript
// 压缩图像后再上传
function compressImage(dataUrl, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
}

// 使用压缩后的图像
const compressedUrl = await compressImage(originalUrl);
const result = await aiImageService.editImage({
  prompt: "编辑指令",
  sourceImage: compressedUrl
});
```

### Q2: 如何保存编辑后的图像?

```javascript
function downloadEditedImage(base64Data, filename = 'edited.png') {
  const link = document.createElement('a');
  link.href = base64Data;
  link.download = filename;
  link.click();
}

// 使用
if (result.success) {
  downloadEditedImage(result.data.imageData, 'my-edited-image.png');
}
```

### Q3: 如何显示编辑进度?

```javascript
// 使用 Promise.race 实现超时检测
const editWithTimeout = async (request, timeoutMs = 5000) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
  );

  const edit = aiImageService.editImage(request);
  return Promise.race([edit, timeout]);
};

try {
  const result = await editWithTimeout(request);
} catch (error) {
  if (error.message === 'Request timeout') {
    console.log("编辑超时,请重试");
  }
}
```

---

## 📚 相关资源

- **前端服务**: `src/services/aiImageService.ts`
- **后端控制器**: `server/src/ai-public/ai-public.controller.ts`
- **后端服务**: `server/src/ai-public/ai-public.service.ts`
- **提供商实现**: `server/src/ai/providers/gemini.provider.ts`
- **类型定义**: `server/src/ai/providers/ai-provider.interface.ts`

---

**最后更新**: 2025-10-23
**API版本**: v1
