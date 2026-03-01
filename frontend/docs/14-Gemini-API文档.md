# Gemini API 文档

## 官方文档链接

**Gemini API 图像生成文档**：https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn

## 模型信息

- **模型名称**：`gemini-2.5-flash-image-preview`
- **支持语言**：中文、英文等多种语言
- **图像格式**：PNG、JPEG等常见格式

## 支持的功能

### 1. 文本到图像生成（Text-to-Image）
- 根据文本描述生成高质量图像
- 支持复杂和简单的提示词
- 能够创建具有精确细节的图像

### 2. 图像编辑（Image-to-Image）
- 添加或删除图像中的元素
- 修改图像风格
- 执行"语义遮罩"进行部分图像编辑
- 在图像之间进行风格迁移

### 3. 多图融合（Multi-Image Fusion）
- **最多支持3张输入图像**以获得最佳效果
- 可以组合来自多个图像的元素
- 能够从不同的图像创建复合场景
- 适合"创建新场景"
- 可以在图像之间传递设计/纹理
- 融合期间保留原始对象细节

### 4. 图像分析
- 描述图像内容
- 识别图像中的对象
- 分析图像风格和构图

## API调用示例

### Python示例
```python
from google import genai

client = genai.Client(api_key=your_api_key)

# 文本生成图像
response = client.models.generate_content(
    model="gemini-2.5-flash-image-preview",
    contents="A serene landscape with mountains"
)

# 图像编辑/融合
response = client.models.generate_content(
    model="gemini-2.5-flash-image-preview",
    contents=[prompt, image1, image2]
)
```

### JavaScript/TypeScript示例
```typescript
import { GoogleGenAI } from '@google/genai';

const genAI = new GoogleGenAI({ apiKey: 'YOUR_API_KEY' });

// 文本生成图像
const result = await genAI.models.generateContent({
  model: 'gemini-2.5-flash-image-preview',
  contents: 'A beautiful sunset over the ocean'
});

// 多图融合
const result = await genAI.models.generateContent({
  model: 'gemini-2.5-flash-image-preview',
  contents: [
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: base64Image1 } },
    { inlineData: { mimeType: 'image/jpeg', data: base64Image2 } }
  ]
});
```

## 最佳实践

### 提示词技巧

#### 图像生成
- 使用明确的动词：`generate`, `create`, `draw`, `paint`
- 包含风格描述：`realistic`, `cartoon`, `watercolor`, `digital art`
- 指定细节：颜色、光线、构图、氛围

#### 图像融合
- **明确指出要生成新图像**：使用 `Generate a new image` 开头
- 描述如何组合元素：`Combine the cat from image 1 with the background from image 2`
- 指定主场景：`Use image 1 as the main scene and add elements from image 2`

#### 图像编辑
- 清楚描述修改内容：`Remove the car`, `Add a tree`, `Change the sky to sunset`
- 使用位置词：`in the foreground`, `on the left side`, `in the background`

### 常见问题及解决方案

#### 1. "No blended image data found in response"
**原因**：API返回了文本描述而不是图像
**解决方案**：
- 在提示词开头加上 `Generate a new image`
- 确保提示词明确要求生成图像
- 避免使用可能被理解为分析请求的词汇

#### 2. 融合效果不理想
**原因**：提示词不够具体
**解决方案**：
- 明确说明每张图片的用途
- 指定哪张图片作为主场景
- 描述如何融合各个元素

#### 3. 生成速度慢
**原因**：网络延迟或API负载高
**解决方案**：
- 增加超时时间
- 实现重试机制
- 优化图像大小（压缩base64数据）

## 注意事项

1. **水印**：所有生成的图像都包含SynthID水印
2. **图像数量限制**：融合功能最多支持3张输入图像
3. **API配额**：注意API调用限制和费用
4. **内容政策**：遵守Google的内容政策，避免生成不当内容

## 错误代码说明

- `API_KEY_INVALID`：API密钥无效
- `PERMISSION_DENIED`：权限被拒绝
- `QUOTA_EXCEEDED`：配额已用完
- `LOCATION_NOT_SUPPORTED`：地区不支持
- `BILLING_REQUIRED`：需要付费账户

## 更新日志

- 2025-09-10：创建文档，记录Gemini API基本功能和使用方法