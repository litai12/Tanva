# Sora2 Video Generator Test Page

## Overview

一个独立的测试页面，用于测试 Sora2 视频生成 API（通过 Banana147 模型供应商）。

## 访问方式

在应用 URL 中添加 `sora2-test` 查询参数：

```
http://localhost:5173/?sora2-test=true
# 或使用 hash
http://localhost:5173/#sora2-test=true
```

## 功能特性

### 1. API 密钥管理
- 输入你的 Sora2 API 密钥 (sk-ERFNr...)
- 密钥仅存储在浏览器内存中，不会保存到本地存储
- 支持密钥验证反馈

### 2. 视频生成模式
- **流式模式（Streaming）**：实时接收响应块，适合长时间处理
- **非流式模式（Non-streaming）**：等待完整响应，适合快速反馈

### 3. 输入选项

#### 视频提示词（Prompt）
描述你要生成的视频内容。示例：
- 中文：`一只狗在草地上快速奔跑，背景是公园`
- 英文：`A dog running fast on a grass field with a park in the background`

#### 可选：参考图像（Reference Image）
提供一个图像 URL 作为参考，API 可以基于这个图像生成视频。

#### 宽高比提示
在提示词末尾添加宽高比提示来控制生成视频的比例：
- `横屏` 或 `landscape` - 宽屏 (16:9)
- `竖屏` 或 `portrait` - 竖屏 (9:16)
- `16:9`, `9:16`, `4:3` - 精确指定宽高比

### 4. 响应处理

#### 流式响应
- 实时显示生成过程中的内容片段
- 响应长度实时更新
- 自动滚动到最新内容

#### 统计信息
- **Response Length**: 当前接收到的响应总字符数
- **Status**: 处理状态（Idle/Processing/Ready）

## API 详情

### 端点
```
POST https://api1.147ai.com/v1/chat/completions
```

### 请求格式
```json
{
  "model": "sora-2-reverse",
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "你的视频提示词"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "图像URL (可选)"
          }
        }
      ]
    }
  ]
}
```

### 认证
使用 Bearer Token 在 Authorization Header 中：
```
Authorization: Bearer sk-ERFNrFQLBnJNbLxaIVixcLzyc3bpIeIdbzWrYMJFm42djtXr
```

## 关键文件

### 服务文件
- **`src/services/sora2Service.ts`** - Sora2 API 服务封装
  - `generateVideoStream()` - 流式视频生成
  - `generateVideo()` - 非流式视频生成
  - 完整的错误处理和流处理逻辑

### 页面组件
- **`src/pages/Sora2Test.tsx`** - Sora2 测试页面
  - API 密钥管理
  - 提示词和图像 URL 输入
  - 流式/非流式模式切换
  - 响应展示和错误处理

### 应用集成
- **`src/App.tsx`** - 添加了 Sora2Test 页面路由

## 使用流程

1. **启动应用**
   ```bash
   npm run dev
   ```

2. **访问测试页面**
   - 在浏览器中打开：`http://localhost:5173/?sora2-test=true`

3. **输入 API 密钥**
   - 将 `sk-ERFNrFQLBnJNbLxaIVixcLzyc3bpIeIdbzWrYMJFm42djtXr` 复制到密钥输入框

4. **配置生成参数**
   - 选择流式或非流式模式
   - 输入视频提示词
   - （可选）输入参考图像 URL

5. **点击"Generate Video"按钮**
   - 等待响应完成
   - 查看实时流式输出（如果选择流式模式）

6. **查看结果**
   - 响应内容显示在右侧面板
   - 统计信息实时更新
   - 错误信息和成功提示会显示在顶部

## 错误处理

页面会显示详细的错误信息，包括：
- **API_KEY_NOT_SET** - 未设置 API 密钥
- **HTTP_XXX** - HTTP 错误码
- **NETWORK_ERROR** - 网络连接错误
- **Other errors** - 流处理或其他错误

## 示例提示词

### 简单示例
- `A white cat sleeping on a sunny windowsill 16:9`
- `美丽的日出，海浪轻轻拍打沙滩 16:9`

### 高级示例
- `A professional cinematic shot of a person running through a forest, high quality 4K, 横屏`
- `带有特效的城市夜景，霓虹灯闪烁，竖屏`

## 注意事项

1. **API 密钥安全**
   - 不要在生产代码中硬编码 API 密钥
   - 仅在测试页面中使用此密钥

2. **响应时间**
   - 大型视频生成可能需要较长时间
   - 流式响应会实时显示进度

3. **浏览器兼容性**
   - 支持现代浏览器（Chrome, Firefox, Safari, Edge）
   - 需要支持 ReadableStream API（用于流处理）

## 文档参考

详见 `/docs/sora2.md` - 完整的 OpenAPI 规范
